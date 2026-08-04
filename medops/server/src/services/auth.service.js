'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/connection');
const { E } = require('../plugins/error');

const PROBE_WINDOW_MS = 2 * 60 * 1000;  // 枚举冷却窗口 2 分钟
const PROBE_MAX = 8;                    // 窗口内失败 ≥8 → 429
const FREEZE_FAILS = 5;                 // 连错 5 次冻结
const REFRESH_DAYS = 30;

const nowIso = () => new Date().toISOString();
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

/* ---------- 设备/IP 枚举冷却（不区分账号是否存在） ---------- */
function throttleKeys(req) {
  const dev = String(req.headers['x-device-id'] || '').slice(0, 64);
  const keys = [`ip:${req.ip}`];
  if (dev) keys.push(`dev:${dev}`);
  return keys;
}
function probeCheck(keys) {
  const db = getDb();
  const now = Date.now();
  for (const key of keys) {
    const r = db.prepare('SELECT * FROM auth_throttle WHERE key = ?').get(key);
    if (!r) continue;
    const ws = Date.parse(r.window_start);
    if (now - ws <= PROBE_WINDOW_MS && r.fail_count >= PROBE_MAX) {
      throw E.probe(Math.max(1, Math.ceil((ws + PROBE_WINDOW_MS - now) / 1000)));
    }
  }
}
function probeFail(keys) {
  const db = getDb();
  const now = Date.now();
  for (const key of keys) {
    const r = db.prepare('SELECT * FROM auth_throttle WHERE key = ?').get(key);
    if (!r || now - Date.parse(r.window_start) > PROBE_WINDOW_MS) {
      db.prepare(`INSERT INTO auth_throttle (key, fail_count, window_start) VALUES (?, 1, ?)
        ON CONFLICT(key) DO UPDATE SET fail_count = 1, window_start = excluded.window_start, blocked_until = NULL`)
        .run(key, new Date(now).toISOString());
    } else {
      const n = r.fail_count + 1;
      const blocked = n >= PROBE_MAX ? new Date(Date.parse(r.window_start) + PROBE_WINDOW_MS).toISOString() : r.blocked_until;
      db.prepare('UPDATE auth_throttle SET fail_count = ?, blocked_until = ? WHERE key = ?').run(n, blocked, key);
    }
  }
}
function probeClear(keys) {
  const db = getDb();
  for (const key of keys) db.prepare('DELETE FROM auth_throttle WHERE key = ?').run(key);
}

/* ---------- 冻结 ---------- */
function frozenRemain(u) {
  if (!u.frozen_until) return 0;
  const remain = Date.parse(u.frozen_until) - Date.now();
  return remain > 0 ? Math.ceil(remain / 1000) : 0;
}

/* ---------- token ---------- */
function newRefreshToken() { return crypto.randomBytes(32).toString('base64url'); } // 43 字符
function issueTokens(app, user, deviceId) {
  const db = getDb();
  const payload = { sub: String(user.id), role: user.role, deptIds: user.deptIds.map(String), dn: user.displayName };
  const accessToken = app.jwt.sign(payload);
  const sid = app.jwt.sign({ ...payload, typ: 'sid' }, { expiresIn: `${REFRESH_DAYS}d` });
  const refreshToken = newRefreshToken();
  db.prepare(`INSERT INTO refresh_tokens (user_id, token_hash, device_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)`)
    .run(user.id, sha256(refreshToken), deviceId || '', new Date(Date.now() + REFRESH_DAYS * 864e5).toISOString(), nowIso());
  return { accessToken, refreshToken, sid };
}
function userJson(user) {
  return {
    id: String(user.id), username: user.username, displayName: user.displayName,
    role: user.role,
    deptId: user.role === 'dept' && user.deptIds.length ? String(user.deptIds[0]) : null,
    deptIds: user.deptIds.map(String), mustChange: !!user.mustChange
  };
}

/* ---------- 登录（校验顺序严格按契约 §1） ---------- */
function login(app, req, { username, password }) {
  const db = getDb();
  const keys = throttleKeys(req);
  const deviceId = String(req.headers['x-device-id'] || '').slice(0, 64);
  probeCheck(keys); // ① 枚举冷却
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    throw E.badInput('请输入账号和密码');
  }
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row) { // ② 账号不存在（文案与密码错一致）
    probeFail(keys);
    throw E.unauthorized('账号或密码不正确');
  }
  const remain = frozenRemain(row);
  if (remain > 0) throw E.frozen(remain); // ③ 冻结中
  if (row.status !== 'on') throw E.kicked(403); // ④ 已禁用
  if (!bcrypt.compareSync(password, row.password_hash)) { // ⑤ 密码错
    probeFail(keys);
    const fails = row.fail_count + 1;
    if (fails >= FREEZE_FAILS) {
      const level = row.freeze_level + 1;
      const mins = 5 * level; // 5/10/15… 分钟递增，轮次不封顶
      const until = new Date(Date.now() + mins * 60000).toISOString();
      db.prepare('UPDATE users SET fail_count = 0, freeze_level = ?, frozen_until = ?, updated_at = ? WHERE id = ?')
        .run(level, until, nowIso(), row.id);
      throw E.frozen(mins * 60);
    }
    db.prepare('UPDATE users SET fail_count = ?, updated_at = ? WHERE id = ?').run(fails, nowIso(), row.id);
    throw E.unauthorized('账号或密码不正确');
  }
  // ⑥ 成功
  probeClear(keys);
  db.prepare('UPDATE users SET fail_count = 0, frozen_until = NULL, updated_at = ? WHERE id = ?').run(nowIso(), row.id);
  if (deviceId) {
    db.prepare(`INSERT INTO known_devices (device_id, user_id, last_at) VALUES (?, ?, ?)
      ON CONFLICT(device_id, user_id) DO UPDATE SET last_at = excluded.last_at`).run(deviceId, row.id, nowIso());
  }
  const user = app.loadUser(row.id);
  const t = issueTokens(app, user, deviceId);
  audit(row.id, 'login', `device=${deviceId}`, req.ip);
  return { ...t, user: userJson(user) };
}

/* ---------- 刷新（轮换 + 重放吊销） ---------- */
function refresh(app, req, { refreshToken }) {
  const db = getDb();
  if (typeof refreshToken !== 'string' || !refreshToken) throw E.badInput('缺少 refreshToken');
  const deviceId = String(req.headers['x-device-id'] || '').slice(0, 64);
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(sha256(refreshToken));
  if (!row) throw E.unauthorized('登录已失效，请重新登录');
  if (row.revoked_at) { // 已吊销 token 被重放 → 吊销该用户该设备全部 token
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL')
      .run(nowIso(), row.user_id, row.device_id);
    audit(row.user_id, 'refresh_replay', `device=${row.device_id}`, req.ip);
    throw E.unauthorized('登录已失效，请重新登录');
  }
  if (Date.parse(row.expires_at) < Date.now()) throw E.unauthorized('登录已过期，请重新登录');
  const user = app.loadUser(row.user_id);
  if (!user || user.status !== 'on') throw E.kicked(401);
  db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').run(nowIso(), row.id);
  const t = issueTokens(app, user, deviceId || row.device_id);
  return { ...t, user: userJson(user) };
}

function logout(req, { refreshToken }) {
  const db = getDb();
  if (refreshToken) {
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .run(nowIso(), sha256(String(refreshToken)));
  }
}

function revokeAllTokens(userId) {
  getDb().prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .run(nowIso(), userId);
}

/* ---------- 登录状态探测（防枚举） ---------- */
function loginState(req, username) {
  const db = getDb();
  const deviceId = String(req.headers['x-device-id'] || '').slice(0, 64);
  const out = { frozen: false, disabled: false };
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
  if (!row) return out;
  const remain = frozenRemain(row);
  if (remain > 0) { out.frozen = true; out.retryAfter = remain; }
  // 仅当该设备曾成功登录过该账号才返回真实 disabled
  if (deviceId) {
    const known = db.prepare('SELECT 1 FROM known_devices WHERE device_id = ? AND user_id = ?').get(deviceId, row.id);
    if (known) out.disabled = row.status !== 'on';
  }
  return out;
}

function changePassword(userId, { oldPassword, newPassword }) {
  const db = getDb();
  if (typeof newPassword !== 'string' || newPassword.length < 6) throw E.badInput('新密码至少 6 位');
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row || !bcrypt.compareSync(String(oldPassword || ''), row.password_hash)) {
    throw E.badInput('原密码不正确');
  }
  db.prepare('UPDATE users SET password_hash = ?, must_change = 0, updated_at = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), nowIso(), userId);
}

function audit(userId, action, detail, ip) {
  getDb().prepare('INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId ?? null, action, detail || '', ip || '', nowIso());
}

module.exports = { login, refresh, logout, loginState, changePassword, revokeAllTokens, userJson, audit, sha256 };
