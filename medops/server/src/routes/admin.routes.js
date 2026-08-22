'use strict';
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../db/connection');
const { E } = require('../plugins/error');
const authSvc = require('../services/auth.service');
const importSvc = require('../services/import.service');
const exportSvc = require('../services/export.service');
const expirySvc = require('../services/expiry.service');

const nowIso = () => new Date().toISOString();
const ROLES = ['inspector', 'dept', 'equip', 'admin'];

function userJsonRow(db, u) {
  const deptIds = db.prepare('SELECT dept_id FROM user_depts WHERE user_id = ? ORDER BY dept_id').all(u.id).map(r => String(r.dept_id));
  return { id: String(u.id), username: u.username, displayName: u.display_name, role: u.role,
    status: u.status, deptIds, mustChange: !!u.must_change, createdAt: u.created_at };
}
const deptJson = d => ({ id: String(d.id), name: d.name, code: d.code, sort: d.sort, status: d.status });
/* 有效期入参归一化：空串=不适用；日期非法直接报错，避免脏数据静默入库 */
function normExpiry(b, old) {
  const cur = old || {};
  const date = b.expiryDate != null ? String(b.expiryDate).trim() : (cur.expiry_date || '');
  if (date && !expirySvc.isDate(date)) throw E.badInput('有效期日期格式应为 YYYY-MM-DD 且必须是真实存在的日期');
  /* 年份区间：往前挡 <input type="date"> 年份框只输两位（0026-03-15）这类误输入，
     往后挡 2026 手滑成 2062 —— 后者日期合法但会让设备从所有提醒里彻底消失，更危险 */
  if (date && !expirySvc.inRange(date)) {
    throw E.badInput(`有效期年份不合常理（应在 ${expirySvc.MIN_YEAR} 年至今后 ${expirySvc.MAX_AHEAD_YEARS} 年之间），请检查是否录错年份`);
  }
  const note = b.expiryNote != null ? String(b.expiryNote).trim().slice(0, 60) : (cur.expiry_note || '');
  const days = b.remindDays != null ? Math.trunc(+b.remindDays) : (cur.remind_days || 0);
  if (!Number.isFinite(days) || days < 0) throw E.badInput('提醒提前天数必须是 0 或正整数');
  if (b.remindDays != null && !Number.isInteger(+b.remindDays)) throw E.badInput('提醒提前天数必须是整数');
  if (days > 365) throw E.badInput('提醒提前天数最多 365 天');
  return { date, note, days };
}

const deviceJson = v => ({ id: String(v.id), deptId: String(v.dept_id), catName: v.cat_name,
  code: v.code, name: v.name, model: v.model, location: v.location, status: v.status, sort: v.sort,
  expiryDate: v.expiry_date || '', expiryNote: v.expiry_note || '', remindDays: v.remind_days || 0 });
const memberJson = m => ({ id: String(m.id), deptId: String(m.dept_id), name: m.name, title: m.title,
  status: m.status, sort: m.sort });

function setUserDepts(db, userId, deptIds) {
  db.prepare('DELETE FROM user_depts WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT OR IGNORE INTO user_depts (user_id, dept_id) VALUES (?, ?)');
  for (const id of deptIds) {
    if (!db.prepare('SELECT 1 FROM depts WHERE id = ?').get(+id)) throw E.badInput(`科室 ${id} 不存在`);
    ins.run(userId, +id);
  }
}

module.exports = async function adminRoutes(app) {
  await app.register(require('@fastify/multipart'), { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

  const guard = [app.auth, app.requireRole('equip', 'admin')];
  const adminOnly = [app.auth, app.requireRole('admin')];
  const db = () => getDb();

  /* ---------- 用户 ---------- */
  app.get('/api/admin/users', { preHandler: guard }, async () =>
    db().prepare('SELECT * FROM users ORDER BY id').all().map(u => userJsonRow(db(), u)));

  app.post('/api/admin/users', { preHandler: guard }, async req => {
    const { username, password, displayName, role, deptIds } = req.body || {};
    if (!username || typeof username !== 'string') throw E.badInput('缺少 username');
    if (!password || String(password).length < 6) throw E.badInput('密码至少 6 位');
    if (!ROLES.includes(role)) throw E.badInput('role 不正确');
    const list = Array.isArray(deptIds) ? deptIds : [];
    if (role === 'dept' && list.length !== 1) throw E.badInput('dept 角色必须指定恰好 1 个科室');
    if (db().prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw E.conflict('账号已存在');
    const id = db().transaction(() => {
      const uid = db().prepare(`INSERT INTO users (username, password_hash, display_name, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(username, bcrypt.hashSync(String(password), 10), String(displayName || username), role, nowIso(), nowIso())
        .lastInsertRowid;
      setUserDepts(db(), uid, list);
      return uid;
    })();
    authSvc.audit(req.user.id, 'user_create', `username=${username} role=${role}`, req.ip);
    return userJsonRow(db(), db().prepare('SELECT * FROM users WHERE id = ?').get(id));
  });

  app.patch('/api/admin/users/:id', { preHandler: guard }, async req => {
    const u = db().prepare('SELECT * FROM users WHERE id = ?').get(+req.params.id);
    if (!u) throw E.notFound('用户不存在');
    const b = req.body || {};
    db().transaction(() => {
      if (b.displayName != null) db().prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').run(String(b.displayName), nowIso(), u.id);
      if (b.role != null) {
        if (!ROLES.includes(b.role)) throw E.badInput('role 不正确');
        db().prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(b.role, nowIso(), u.id);
      }
      if (Array.isArray(b.deptIds)) setUserDepts(db(), u.id, b.deptIds);
      if (b.status != null) {
        if (!['on', 'off'].includes(b.status)) throw E.badInput('status 不正确');
        db().prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(b.status, nowIso(), u.id);
        if (b.status === 'off') authSvc.revokeAllTokens(u.id); // 禁用即吊销全部 refreshToken
      }
    })();
    authSvc.audit(req.user.id, 'user_patch', `id=${u.id} ${JSON.stringify(b)}`, req.ip);
    return userJsonRow(db(), db().prepare('SELECT * FROM users WHERE id = ?').get(u.id));
  });

  app.post('/api/admin/users/:id/reset-password', { preHandler: guard }, async req => {
    const u = db().prepare('SELECT * FROM users WHERE id = ?').get(+req.params.id);
    if (!u) throw E.notFound('用户不存在');
    const password = crypto.randomBytes(6).toString('base64url');
    db().prepare('UPDATE users SET password_hash = ?, must_change = 1, fail_count = 0, frozen_until = NULL, updated_at = ? WHERE id = ?')
      .run(bcrypt.hashSync(password, 10), nowIso(), u.id);
    authSvc.audit(req.user.id, 'user_reset_password', `id=${u.id}`, req.ip);
    return { password };
  });

  /* ---------- 科室 ---------- */
  app.get('/api/admin/depts', { preHandler: guard }, async () =>
    db().prepare('SELECT * FROM depts ORDER BY sort, id').all().map(deptJson));

  app.post('/api/admin/depts', { preHandler: guard }, async req => {
    const b = req.body || {};
    if (!b.name) throw E.badInput('缺少科室名称');
    if (db().prepare('SELECT 1 FROM depts WHERE name = ?').get(b.name)) throw E.conflict('科室名称已存在');
    const id = db().prepare('INSERT INTO depts (name, code, sort, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(String(b.name), String(b.code || ''), +b.sort || 0, b.status === 'off' ? 'off' : 'on', nowIso()).lastInsertRowid;
    return deptJson(db().prepare('SELECT * FROM depts WHERE id = ?').get(id));
  });

  app.patch('/api/admin/depts/:id', { preHandler: guard }, async req => {
    const d = db().prepare('SELECT * FROM depts WHERE id = ?').get(+req.params.id);
    if (!d) throw E.notFound('科室不存在');
    const b = req.body || {};
    if (b.name != null && b.name !== d.name &&
      db().prepare('SELECT 1 FROM depts WHERE name = ?').get(b.name)) throw E.conflict('科室名称已存在');
    db().prepare('UPDATE depts SET name = ?, code = ?, sort = ?, status = ? WHERE id = ?')
      .run(String(b.name ?? d.name), String(b.code ?? d.code), +(b.sort ?? d.sort),
        ['on', 'off'].includes(b.status) ? b.status : d.status, d.id);
    return deptJson(db().prepare('SELECT * FROM depts WHERE id = ?').get(d.id));
  });

  app.delete('/api/admin/depts/:id', { preHandler: guard }, async req => {
    const id = +req.params.id;
    if (!db().prepare('SELECT 1 FROM depts WHERE id = ?').get(id)) throw E.notFound('科室不存在');
    if (db().prepare('SELECT 1 FROM records WHERE dept_id = ? LIMIT 1').get(id)) {
      throw E.conflict('该科室已有巡检记录，禁止删除，请改为停用');
    }
    /* 设备可以在科室之间调拨，所以"本科室没有巡检记录"不等于"本科室的设备没被巡检过"。
       漏了这一检查，下面 DELETE FROM devices 会撞 record_items 的外键约束，
       事务回滚后用户只拿到一条没有信息量的 500。 */
    const used = db().prepare(`SELECT v.code FROM devices v
      WHERE v.dept_id = ? AND EXISTS (SELECT 1 FROM record_items i WHERE i.device_id = v.id) LIMIT 1`).get(id);
    if (used) {
      throw E.conflict(`该科室的设备「${used.code}」已有巡检记录（可能是从别的科室调拨过来的），禁止删除，请改为停用`);
    }
    db().transaction(() => {
      db().prepare('DELETE FROM members WHERE dept_id = ?').run(id);
      db().prepare('DELETE FROM devices WHERE dept_id = ?').run(id);
      db().prepare('DELETE FROM user_depts WHERE dept_id = ?').run(id);
      db().prepare('DELETE FROM depts WHERE id = ?').run(id);
    })();
    authSvc.audit(req.user.id, 'dept_delete', `id=${id}`, req.ip);
    return { ok: true };
  });

  /* ---------- 设备台账 ---------- */
  app.get('/api/admin/devices', { preHandler: guard }, async req => {
    const { deptId } = req.query;
    const rows = deptId
      ? db().prepare('SELECT * FROM devices WHERE dept_id = ? ORDER BY sort, code').all(+deptId)
      : db().prepare('SELECT * FROM devices ORDER BY dept_id, sort, code').all();
    return rows.map(deviceJson);
  });

  app.post('/api/admin/devices', { preHandler: guard }, async req => {
    const b = req.body || {};
    if (!b.deptId || !b.code || !b.name || !b.catName) throw E.badInput('deptId/catName/code/name 必填');
    if (!db().prepare('SELECT 1 FROM depts WHERE id = ?').get(+b.deptId)) throw E.badInput('科室不存在');
    if (db().prepare('SELECT 1 FROM devices WHERE code = ?').get(String(b.code))) throw E.conflict('设备编码已存在');
    const exp = normExpiry(b);
    const id = db().prepare(`INSERT INTO devices (dept_id, cat_name, code, name, model, location, status, sort,
      expiry_date, expiry_note, remind_days, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(+b.deptId, String(b.catName), String(b.code), String(b.name), String(b.model || ''),
        String(b.location || ''), String(b.status || 'in_use'), +b.sort || 0,
        exp.date, exp.note, exp.days, nowIso(), nowIso()).lastInsertRowid;
    return deviceJson(db().prepare('SELECT * FROM devices WHERE id = ?').get(id));
  });

  app.patch('/api/admin/devices/:id', { preHandler: guard }, async req => {
    const v = db().prepare('SELECT * FROM devices WHERE id = ?').get(+req.params.id);
    if (!v) throw E.notFound('设备不存在');
    const b = req.body || {};
    if (b.code != null && b.code !== v.code &&
      db().prepare('SELECT 1 FROM devices WHERE code = ?').get(String(b.code))) throw E.conflict('设备编码已存在');
    if (b.deptId != null && !db().prepare('SELECT 1 FROM depts WHERE id = ?').get(+b.deptId)) throw E.badInput('科室不存在');
    const exp = normExpiry(b, v);
    db().prepare(`UPDATE devices SET dept_id = ?, cat_name = ?, code = ?, name = ?, model = ?, location = ?,
      status = ?, sort = ?, expiry_date = ?, expiry_note = ?, remind_days = ?, updated_at = ? WHERE id = ?`)
      .run(+(b.deptId ?? v.dept_id), String(b.catName ?? v.cat_name), String(b.code ?? v.code),
        String(b.name ?? v.name), String(b.model ?? v.model), String(b.location ?? v.location),
        String(b.status ?? v.status), +(b.sort ?? v.sort),
        exp.date, exp.note, exp.days, nowIso(), v.id);
    return deviceJson(db().prepare('SELECT * FROM devices WHERE id = ?').get(v.id));
  });

  app.delete('/api/admin/devices/:id', { preHandler: guard }, async req => {
    const id = +req.params.id;
    if (!db().prepare('SELECT 1 FROM devices WHERE id = ?').get(id)) throw E.notFound('设备不存在');
    if (db().prepare('SELECT 1 FROM record_items WHERE device_id = ? LIMIT 1').get(id)) {
      throw E.conflict('该设备已有巡检记录，禁止删除，请改为停用');
    }
    db().prepare('DELETE FROM devices WHERE id = ?').run(id);
    return { ok: true };
  });

  /* 设备导入模板 / 导入 */
  app.get('/api/admin/devices/import-template', { preHandler: guard }, async (req, reply) => {
    const buf = await exportSvc.importTemplateXlsx();
    reply.header('Content-Disposition', 'attachment; filename="devices-template.xlsx"')
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return reply.send(buf);
  });

  app.post('/api/admin/devices/import', { preHandler: guard }, async req => {
    const file = await req.file();
    if (!file) throw E.badInput('缺少上传文件');
    const buf = await file.toBuffer();
    const out = await importSvc.importDevices(buf);
    authSvc.audit(req.user.id, 'devices_import', `created=${out.created} updated=${out.updated} errors=${out.errors.length}`, req.ip);
    return out;
  });

  /* ---------- 签字人名单 ---------- */
  app.get('/api/admin/members', { preHandler: guard }, async req => {
    const { deptId } = req.query;
    const rows = deptId
      ? db().prepare('SELECT * FROM members WHERE dept_id = ? ORDER BY sort, id').all(+deptId)
      : db().prepare('SELECT * FROM members ORDER BY dept_id, sort, id').all();
    return rows.map(memberJson);
  });

  app.post('/api/admin/members', { preHandler: guard }, async req => {
    const b = req.body || {};
    if (!b.deptId || !b.name) throw E.badInput('deptId/name 必填');
    if (!db().prepare('SELECT 1 FROM depts WHERE id = ?').get(+b.deptId)) throw E.badInput('科室不存在');
    if (db().prepare('SELECT 1 FROM members WHERE dept_id = ? AND name = ?').get(+b.deptId, String(b.name))) {
      throw E.conflict('该科室已有同名签字人');
    }
    const id = db().prepare('INSERT INTO members (dept_id, name, title, status, sort) VALUES (?, ?, ?, ?, ?)')
      .run(+b.deptId, String(b.name), String(b.title || ''), b.status === 'off' ? 'off' : 'on', +b.sort || 0).lastInsertRowid;
    return memberJson(db().prepare('SELECT * FROM members WHERE id = ?').get(id));
  });

  app.patch('/api/admin/members/:id', { preHandler: guard }, async req => {
    const m = db().prepare('SELECT * FROM members WHERE id = ?').get(+req.params.id);
    if (!m) throw E.notFound('签字人不存在');
    const b = req.body || {};
    db().prepare('UPDATE members SET name = ?, title = ?, status = ?, sort = ? WHERE id = ?')
      .run(String(b.name ?? m.name), String(b.title ?? m.title),
        ['on', 'off'].includes(b.status) ? b.status : m.status, +(b.sort ?? m.sort), m.id);
    return memberJson(db().prepare('SELECT * FROM members WHERE id = ?').get(m.id));
  });

  app.delete('/api/admin/members/:id', { preHandler: guard }, async req => {
    if (!db().prepare('SELECT 1 FROM members WHERE id = ?').get(+req.params.id)) throw E.notFound('签字人不存在');
    db().prepare('DELETE FROM members WHERE id = ?').run(+req.params.id);
    return { ok: true };
  });

  /* ---------- 作废签字（admin） ---------- */
  app.post('/api/admin/signs/void', { preHandler: adminOnly }, async req => {
    const { type, deptId, key, reason } = req.body || {};
    if (!['day', 'week', 'month'].includes(type)) throw E.badInput('type 必须是 day/week/month');
    if (!deptId || !key || !reason) throw E.badInput('deptId/key/reason 必填');
    const did = +deptId;
    if (type === 'day') {
      const r = db().prepare('SELECT * FROM records WHERE dept_id = ? AND date = ?').get(did, String(key));
      if (!r || !r.sign_at) throw E.notFound('该日无签字');
      db().prepare(`UPDATE records SET sign_name = NULL, sign_title = NULL, sign_opinion = NULL,
        sign_file_id = NULL, sign_at = NULL, updated_at = ? WHERE id = ?`).run(nowIso(), r.id);
    } else if (type === 'week') {
      const r = db().prepare('SELECT * FROM week_signs WHERE dept_id = ? AND week_start = ?').get(did, String(key));
      if (!r) throw E.notFound('该周无签字');
      db().prepare('DELETE FROM week_signs WHERE id = ?').run(r.id);
    } else {
      const r = db().prepare('SELECT * FROM month_signs WHERE dept_id = ? AND month = ?').get(did, String(key));
      if (!r) throw E.notFound('该月无签字');
      db().prepare('DELETE FROM month_signs WHERE id = ?').run(r.id);
    }
    authSvc.audit(req.user.id, 'sign_void', `type=${type} deptId=${did} key=${key} reason=${reason}`, req.ip);
    return { ok: true };
  });

  /* ---------- 历史数据导入（admin） ---------- */
  app.post('/api/admin/import/legacy', {
    preHandler: adminOnly, bodyLimit: 50 * 1024 * 1024
  }, async req => {
    const out = importSvc.importLegacy(req.body);
    authSvc.audit(req.user.id, 'import_legacy', JSON.stringify(out.imported), req.ip);
    return out;
  });

  /* ---------- 审计日志 ---------- */
  app.get('/api/admin/audit', { preHandler: guard }, async req => {
    const { from, to } = req.query;
    const cond = []; const args = [];
    if (from) { cond.push('created_at >= ?'); args.push(from); }
    if (to) { cond.push('created_at <= ?'); args.push(to + (to.length === 10 ? 'T23:59:59.999Z' : '')); }
    return db().prepare(`SELECT * FROM audit_log ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY id DESC LIMIT 1000`)
      .all(...args)
      .map(a => ({ id: String(a.id), userId: a.user_id != null ? String(a.user_id) : null,
        action: a.action, detail: a.detail, ip: a.ip, createdAt: a.created_at }));
  });
};
