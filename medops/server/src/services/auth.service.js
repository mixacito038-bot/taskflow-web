'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/connection');
const { E } = require('../plugins/error');

const PROBE_WINDOW_MS = 2 * 60 * 1000;  // 枚举冷却窗口 2 分钟
const PROBE_MAX = 8;                    // 同一「设备+IP」窗口内失败 ≥8 → 429
const PROBE_IP_MAX = 60;                // 同一 IP 窗口内失败 ≥60 → 429（只拦脚本不停换设备号狂刷）
const FREEZE_FAILS = 5;                 // 连错 5 次冻结
const REFRESH_DAYS = 30;

const nowIso = () => new Date().toISOString();
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

/* ---------- 设备+IP 枚举冷却（不区分账号是否存在） ----------
   ⚠ 旧版设备、IP 各算各的：医院整栋楼共用一个出口 IP，几个人各自输错几次凑满 8 次，
   全院（包括管理员）两分钟内谁都登不上。现在按契约用「设备+IP」组合计数；
   另设一个宽得多的纯 IP 上限，只拦脚本不停换设备号的情况。没带设备号的请求（脚本）按 IP 严格计。 */
function throttleKeys(req) {
  const dev = String(req.headers['x-device-id'] || '').slice(0, 64);
  return [
    { key: dev ? `devip:${dev}|${req.ip}` : `nodev:${req.ip}`, max: PROBE_MAX },
    { key: `ipall:${req.ip}`, max: PROBE_IP_MAX }
  ];
}
function probeCheck(keys) {
  const db = getDb();
  const now = Date.now();
  for (const { key, max } of keys) {
    const r = db.prepare('SELECT * FROM auth_throttle WHERE key = ?').get(key);
    if (!r) continue;
    const ws = Date.parse(r.window_start);
    if (now - ws <= PROBE_WINDOW_MS && r.fail_count >= max) {
      throw E.probe(Math.max(1, Math.ceil((ws + PROBE_WINDOW_MS - now) / 1000)));
    }
  }
}
function probeFail(keys) {
  const db = getDb();
  const now = Date.now();
  for (const { key, max } of keys) {
    const r = db.prepare('SELECT * FROM auth_throttle WHERE key = ?').get(key);
    if (!r || now - Date.parse(r.window_start) > PROBE_WINDOW_MS) {
      db.prepare(`INSERT INTO auth_throttle (key, fail_count, window_start) VALUES (?, 1, ?)
        ON CONFLICT(key) DO UPDATE SET fail_count = 1, window_start = excluded.window_start, blocked_until = NULL`)
        .run(key, new Date(now).toISOString());
    } else {
      const n = r.fail_count + 1;
      const blocked = n >= max ? new Date(Date.parse(r.window_start) + PROBE_WINDOW_MS).toISOString() : r.blocked_until;
      db.prepare('UPDATE auth_throttle SET fail_count = ?, blocked_until = ? WHERE key = ?').run(n, blocked, key);
    }
  }
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
  /* sid（httpOnly Cookie）只给 <img>/下载类 GET 用：带 typ=sid 与设备号，鉴权时要求该设备
     还有有效的 refreshToken —— 退出登录、重置密码、停用账号后随之失效（见 plugins/auth.js） */
  const sid = app.jwt.sign({ sub: String(user.id), typ: 'sid', did: deviceId || '' }, { expiresIn: `${REFRESH_DAYS}d` });
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
  /* ⑥ 成功。不清设备/IP 的失败计数：否则手里有任意一个账号的人，每错 7 次登一次自己的号，
     就能无限试别人的账号。冻结轮次清零：本人已经登上来了，下次输错从 5 分钟重新算。 */
  db.prepare('UPDATE users SET fail_count = 0, freeze_level = 0, frozen_until = NULL, updated_at = ? WHERE id = ?').run(nowIso(), row.id);
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
  /* 先看账号状态：停用时会吊销全部 token，若先走重放分支，停用的人只会看到「登录已失效」，
     还会多出一条虚假的重放审计 */
  const user = app.loadUser(row.user_id);
  if (!user) throw E.unauthorized('登录已失效，请重新登录');
  if (user.status !== 'on') throw E.kicked(401);
  const revokeFamily = () => db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL')
    .run(nowIso(), row.user_id, row.device_id);
  if (row.revoked_at) { // 已吊销 token 被重放 → 吊销该用户该设备全部 token
    revokeFamily();
    audit(row.user_id, 'refresh_replay', `device=${row.device_id}`, req.ip);
    throw E.unauthorized('登录已失效，请重新登录');
  }
  if (Date.parse(row.expires_at) < Date.now()) throw E.unauthorized('登录已过期，请重新登录');
  /* refreshToken 与签发时的设备绑定：换了设备号来换 token，按被盗用处理，整组吊销。
     轮换出来的新 token 始终沿用原设备号 —— 旧版取请求头里的设备号，盗用者换出来的新 token
     落在另一组里，正主重放旧 token 时吊销不到它，盗用者的会话就一直有效。 */
  if (row.device_id && deviceId && deviceId !== row.device_id) {
    revokeFamily();
    audit(row.user_id, 'refresh_device_mismatch', `device=${row.device_id} req=${deviceId}`, req.ip);
    throw E.unauthorized('登录已失效，请重新登录');
  }
  db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').run(nowIso(), row.id);
  const t = issueTokens(app, user, row.device_id);
  return { ...t, user: userJson(user) };
}

function logout(req, { refreshToken }) {
  const db = getDb();
  if (refreshToken) {
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .run(nowIso(), sha256(String(refreshToken)));
  }
}

function revokeAllTokens(userId, exceptDeviceId) {
  if (exceptDeviceId != null) {
    getDb().prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND device_id <> ?')
      .run(nowIso(), userId, exceptDeviceId);
    return;
  }
  getDb().prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .run(nowIso(), userId);
}
/* 该设备上是否还有有效的登录（sid Cookie 鉴权用：退出/重置密码/停用后 sid 随之失效） */
function hasActiveSession(userId, deviceId) {
  return !!getDb().prepare(`SELECT 1 FROM refresh_tokens WHERE user_id = ? AND device_id = ?
    AND revoked_at IS NULL AND expires_at > ? LIMIT 1`).get(userId, deviceId || '', nowIso());
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

function changePassword(req, userId, { oldPassword, newPassword }) {
  const db = getDb();
  if (typeof newPassword !== 'string' || newPassword.length < 6) throw E.badInput('新密码至少 6 位');
  if (newPassword.length > 64) throw E.badInput('新密码最多 64 位');
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row || !bcrypt.compareSync(String(oldPassword || ''), row.password_hash)) {
    throw E.badInput('原密码不正确');
  }
  if (newPassword === oldPassword) throw E.badInput('新密码不能与原密码相同');
  db.prepare('UPDATE users SET password_hash = ?, must_change = 0, updated_at = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), nowIso(), userId);
  /* 改密 = 其它设备上的登录全部失效（怀疑泄露才改密，别人的会话不能还继续有效）；
     当前这台设备保持登录，不用重新输密码 */
  revokeAllTokens(userId, String(req.headers['x-device-id'] || '').slice(0, 64));
  audit(userId, 'change_password', '', req.ip);
}

function audit(userId, action, detail, ip) {
  getDb().prepare('INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId ?? null, action, detail || '', ip || '', nowIso());
}

module.exports = { login, refresh, logout, loginState, changePassword, revokeAllTokens, hasActiveSession,
  frozenRemain, userJson, audit, sha256 };
