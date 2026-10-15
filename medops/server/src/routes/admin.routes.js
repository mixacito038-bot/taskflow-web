'use strict';
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../db/connection');
const { E } = require('../plugins/error');
const authSvc = require('../services/auth.service');
const importSvc = require('../services/import.service');
const exportSvc = require('../services/export.service');
const expirySvc = require('../services/expiry.service');
const P = require('../services/period.service');

const nowIso = () => new Date().toISOString();
const ROLES = ['inspector', 'dept', 'equip', 'admin'];
/* 设备状态只认这四个值。以前任意字符串都收（如「正常」）：设备照样出现在台账里，
   却被巡检清单和有效期提醒（只认 in_use）永久排除，过期了也没人知道 */
const DEVICE_STATUS = ['in_use', 'repair', 'retired', 'scrapped'];
function devStatus(v, fallback) {
  if (v == null || v === '') return fallback;
  if (!DEVICE_STATUS.includes(v)) throw E.badInput(`设备状态「${v}」系统不认识，请在「状态」里重新选择：在用 / 维修中 / 已停用 / 已报废`);
  return v;
}
/* 批量操作的 id 列表：非空、最多 2000 个、正整数，去重 */
function batchIds(list, what) {
  if (!Array.isArray(list) || !list.length) throw E.badInput(`请先勾选${what}`);
  if (list.length > 2000) throw E.badInput('一次最多处理 2000 个');
  const ids = [...new Set(list.map(Number))];
  if (ids.some(n => !Number.isInteger(n) || n <= 0)) throw E.badInput(`${what} id 不正确`);
  return ids;
}
/* 排序号：留空沿用原值；非整数报 400（以前 'abc' 变成 NaN 撞 NOT NULL，返回 500） */
function sortOf(v, fallback) {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || Math.abs(n) > 1e6) throw E.badInput('排序号必须是整数');
  return n;
}
/* 必填文本：去首尾空白后不能为空；不传沿用原值 */
function reqText(v, fallback, label, max = 100) {
  if (v == null) return fallback;
  const t = String(v).trim();
  if (!t) throw E.badInput(`${label}不能为空`);
  if (t.length > max) throw E.badInput(`${label}最多 ${max} 个字`);
  return t;
}

function userJsonRow(db, u) {
  const deptIds = db.prepare('SELECT dept_id FROM user_depts WHERE user_id = ? ORDER BY dept_id').all(u.id).map(r => String(r.dept_id));
  const frozenSec = authSvc.frozenRemain(u);
  return { id: String(u.id), username: u.username, displayName: u.display_name, role: u.role,
    status: u.status, deptIds, mustChange: !!u.must_change, createdAt: u.created_at,
    // 冻结状态要让管理员看得见、能解：以前列表里看不出谁被冻结了，只能干等或重置密码
    frozenUntil: frozenSec > 0 ? u.frozen_until : null, frozenSec };
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

  /* ---------- 用户 ----------
     设备科可以管理巡检员、护士长、设备科账号；「管理员」账号的创建、修改、重置密码，
     以及授予管理员权限，只能由管理员操作——否则设备科能把自己改成管理员，
     或重置管理员密码直接接管管理员账号。 */
  const assertDeptsExist = ids => {
    for (const id of ids) if (!db().prepare('SELECT 1 FROM depts WHERE id = ?').get(id)) throw E.badInput(`科室 ${id} 不存在`);
  };
  const activeAdminsExcept = id => db().prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'on' AND id <> ?").get(id).c;

  app.get('/api/admin/users', { preHandler: guard }, async () =>
    db().prepare('SELECT * FROM users ORDER BY id').all().map(u => userJsonRow(db(), u)));

  app.post('/api/admin/users', { preHandler: guard }, async req => {
    const { password, displayName, role, deptIds } = req.body || {};
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    if (!username) throw E.badInput('缺少 username');
    if (!password || String(password).length < 6) throw E.badInput('密码至少 6 位');
    if (!ROLES.includes(role)) throw E.badInput('role 不正确');
    if (role === 'admin' && req.user.role !== 'admin') throw E.forbidden('只有管理员可以创建管理员账号');
    const list = (Array.isArray(deptIds) ? deptIds : []).map(Number);
    if (role === 'dept' && list.length !== 1) throw E.badInput('护士长账号必须指定恰好 1 个科室');
    assertDeptsExist(list);
    if (db().prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw E.conflict('账号已存在');
    const id = db().transaction(() => {
      const uid = db().prepare(`INSERT INTO users (username, password_hash, display_name, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(username, bcrypt.hashSync(String(password), 10), String(displayName || '').trim() || username, role, nowIso(), nowIso())
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
    const isAdmin = req.user.role === 'admin';
    if (u.role === 'admin' && !isAdmin) throw E.forbidden('管理员账号只能由管理员修改');
    if (b.role === 'admin' && !isAdmin) throw E.forbidden('只有管理员可以授予管理员权限');
    if (b.role != null && !ROLES.includes(b.role)) throw E.badInput('role 不正确');
    if (b.status != null && !['on', 'off'].includes(b.status)) throw E.badInput('status 不正确');
    if (b.displayName != null && !String(b.displayName).trim()) throw E.badInput('显示名不能为空');
    const nextRole = b.role != null ? b.role : u.role;
    const nextDepts = Array.isArray(b.deptIds) ? b.deptIds.map(Number)
      : db().prepare('SELECT dept_id FROM user_depts WHERE user_id = ?').all(u.id).map(r => r.dept_id);
    // 新建时要求护士长恰好 1 个科室，修改时以前不查，能改出 0 个或多个科室的护士长
    if (nextRole === 'dept' && nextDepts.length !== 1) throw E.badInput('护士长账号必须指定恰好 1 个科室');
    if (Array.isArray(b.deptIds)) assertDeptsExist(nextDepts);
    // 不能把自己锁在门外，也不能让系统没有可用的管理员
    if (u.id === req.user.id && b.status === 'off') throw E.badInput('不能停用自己正在使用的账号');
    if (u.id === req.user.id && b.role != null && b.role !== u.role) throw E.badInput('不能修改自己的角色');
    if (u.role === 'admin' && (b.status === 'off' || (b.role != null && b.role !== 'admin')) && !activeAdminsExcept(u.id)) {
      throw E.badInput('系统至少要保留一个启用的管理员账号');
    }
    db().transaction(() => {
      if (b.displayName != null) db().prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').run(String(b.displayName).trim(), nowIso(), u.id);
      if (b.role != null) db().prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(b.role, nowIso(), u.id);
      if (Array.isArray(b.deptIds)) setUserDepts(db(), u.id, nextDepts);
      if (b.status != null) {
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
    if (u.role === 'admin' && req.user.role !== 'admin') throw E.forbidden('管理员账号的密码只能由管理员重置');
    const password = crypto.randomBytes(6).toString('base64url');
    db().prepare(`UPDATE users SET password_hash = ?, must_change = 1, fail_count = 0, freeze_level = 0,
      frozen_until = NULL, updated_at = ? WHERE id = ?`).run(bcrypt.hashSync(password, 10), nowIso(), u.id);
    // 重置密码 = 让旧会话全部失效：怀疑密码泄露才去重置，对方的登录不能还继续有效
    authSvc.revokeAllTokens(u.id);
    authSvc.audit(req.user.id, 'user_reset_password', `id=${u.id}`, req.ip);
    return { password };
  });

  /* 解冻：密码连错被冻结的账号，确认是本人后直接解除（不改密码）；冻结轮次一并清零 */
  app.post('/api/admin/users/:id/unfreeze', { preHandler: guard }, async req => {
    const u = db().prepare('SELECT * FROM users WHERE id = ?').get(+req.params.id);
    if (!u) throw E.notFound('用户不存在');
    if (u.role === 'admin' && req.user.role !== 'admin') throw E.forbidden('管理员账号只能由管理员解冻');
    db().prepare('UPDATE users SET fail_count = 0, freeze_level = 0, frozen_until = NULL, updated_at = ? WHERE id = ?')
      .run(nowIso(), u.id);
    authSvc.audit(req.user.id, 'user_unfreeze', `id=${u.id}`, req.ip);
    return userJsonRow(db(), db().prepare('SELECT * FROM users WHERE id = ?').get(u.id));
  });

  /* ---------- 科室 ---------- */
  app.get('/api/admin/depts', { preHandler: guard }, async () =>
    db().prepare('SELECT * FROM depts ORDER BY sort, id').all().map(deptJson));

  app.post('/api/admin/depts', { preHandler: guard }, async req => {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) throw E.badInput('缺少科室名称');
    if (db().prepare('SELECT 1 FROM depts WHERE name = ?').get(name)) throw E.conflict('科室名称已存在');
    const id = db().prepare('INSERT INTO depts (name, code, sort, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(name, String(b.code || '').trim(), sortOf(b.sort, 0), b.status === 'off' ? 'off' : 'on', nowIso()).lastInsertRowid;
    return deptJson(db().prepare('SELECT * FROM depts WHERE id = ?').get(id));
  });

  app.patch('/api/admin/depts/:id', { preHandler: guard }, async req => {
    const d = db().prepare('SELECT * FROM depts WHERE id = ?').get(+req.params.id);
    if (!d) throw E.notFound('科室不存在');
    const b = req.body || {};
    const name = b.name != null ? String(b.name).trim() : d.name;
    if (!name) throw E.badInput('科室名称不能为空');
    if (name !== d.name && db().prepare('SELECT 1 FROM depts WHERE name = ?').get(name)) throw E.conflict('科室名称已存在');
    if (b.status != null && !['on', 'off'].includes(b.status)) throw E.badInput('status 不正确');
    db().prepare('UPDATE depts SET name = ?, code = ?, sort = ?, status = ? WHERE id = ?')
      .run(name, String(b.code ?? d.code).trim(), sortOf(b.sort, d.sort), b.status || d.status, d.id);
    if (b.status && b.status !== d.status) authSvc.audit(req.user.id, b.status === 'off' ? 'dept_disable' : 'dept_enable', `id=${d.id} name=${name}`, req.ip);
    return deptJson(db().prepare('SELECT * FROM depts WHERE id = ?').get(d.id));
  });

  /* 科室能不能删：能删返回 null，不能删返回原因（单个删除和批量删除共用） */
  function deptDeleteBlock(id) {
    if (db().prepare('SELECT 1 FROM records WHERE dept_id = ? LIMIT 1').get(id)
      || db().prepare('SELECT 1 FROM week_signs WHERE dept_id = ? LIMIT 1').get(id)
      || db().prepare('SELECT 1 FROM month_signs WHERE dept_id = ? LIMIT 1').get(id)) {
      return '该科室已有巡检或签字记录，禁止删除，请改为停用';
    }
    /* 护士长账号恰好绑定 1 个科室：删了科室它就变成「没有科室的护士长」，登录后什么都看不到 */
    const nurse = db().prepare(`SELECT u.username, u.display_name FROM users u JOIN user_depts ud ON ud.user_id = u.id
      WHERE ud.dept_id = ? AND u.role = 'dept' LIMIT 1`).get(id);
    if (nurse) return `护士长账号「${nurse.display_name}（${nurse.username}）」属于该科室，请先把它改到别的科室或停用后再删除`;
    /* 设备可以在科室之间调拨，所以"本科室没有巡检记录"不等于"本科室的设备没被巡检过"。
       漏了这一检查，删除时会撞 record_items 的外键约束，事务回滚后用户只拿到一条没有信息量的 500。 */
    const used = db().prepare(`SELECT v.code FROM devices v
      WHERE v.dept_id = ? AND EXISTS (SELECT 1 FROM record_items i WHERE i.device_id = v.id) LIMIT 1`).get(id);
    if (used) return `该科室的设备「${used.code}」已有巡检记录（可能是从别的科室调拨过来的），禁止删除，请改为停用`;
    return null;
  }
  /* 删除科室：连同它下面的签字人名单、（没巡检过的）设备、账号的科室关联 */
  function deleteDept(id) {
    db().prepare('DELETE FROM members WHERE dept_id = ?').run(id);
    db().prepare('DELETE FROM devices WHERE dept_id = ?').run(id);
    db().prepare('DELETE FROM user_depts WHERE dept_id = ?').run(id);
    db().prepare('DELETE FROM depts WHERE id = ?').run(id);
  }

  app.delete('/api/admin/depts/:id', { preHandler: guard }, async req => {
    const id = +req.params.id;
    if (!db().prepare('SELECT 1 FROM depts WHERE id = ?').get(id)) throw E.notFound('科室不存在');
    const why = deptDeleteBlock(id);
    if (why) throw E.conflict(why);
    db().transaction(() => deleteDept(id))();
    authSvc.audit(req.user.id, 'dept_delete', `id=${id}`, req.ip);
    return { ok: true };
  });

  /* 科室导入模板 / 导入（按科室名称新增或更新） */
  app.get('/api/admin/depts/import-template', { preHandler: guard }, async (req, reply) => {
    const buf = await exportSvc.deptTemplateXlsx();
    reply.header('Content-Disposition', 'attachment; filename="depts-template.xlsx"')
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return reply.send(buf);
  });

  app.post('/api/admin/depts/import', { preHandler: guard }, async req => {
    const file = await req.file();
    if (!file) throw E.badInput('缺少上传文件');
    const out = await importSvc.importDepts(await file.toBuffer());
    authSvc.audit(req.user.id, 'depts_import', `created=${out.created} updated=${out.updated} errors=${out.errors.length}`, req.ip);
    return out;
  });

  /* 批量处理科室：body { ids:[...], action:'status'|'delete', status?:'on'|'off' }。
     删除同单个删除的规则：用过的（有巡检/签字记录、有护士长账号、设备被巡检过）不删，列在 blocked 里并写明原因 */
  app.post('/api/admin/depts/batch', { preHandler: guard }, async req => {
    const b = req.body || {};
    const ids = batchIds(b.ids, '科室');
    if (!['status', 'delete'].includes(b.action)) throw E.badInput('action 只能是 status / delete');
    if (b.action === 'status' && !['on', 'off'].includes(b.status)) throw E.badInput('请选择要改成的状态（启用 / 停用）');
    const get = db().prepare('SELECT id, name FROM depts WHERE id = ?');
    const out = { updated: [], deleted: [], blocked: [], missing: [] };
    db().transaction(() => {
      for (const id of ids) {
        const d = get.get(id);
        if (!d) { out.missing.push(String(id)); continue; }
        const one = { id: String(d.id), name: d.name };
        if (b.action === 'status') {
          db().prepare('UPDATE depts SET status = ? WHERE id = ?').run(b.status, id);
          out.updated.push(one);
          continue;
        }
        const why = deptDeleteBlock(id);
        if (why) { out.blocked.push({ ...one, reason: why }); continue; }
        deleteDept(id);
        out.deleted.push(one);
      }
    })();
    const names = l => l.map(x => x.name).slice(0, 100).join(',') + (l.length > 100 ? ` 等 ${l.length} 个` : '');
    if (out.updated.length) authSvc.audit(req.user.id, 'dept_batch_status', `status=${b.status} n=${out.updated.length} names=${names(out.updated)}`, req.ip);
    if (out.deleted.length) authSvc.audit(req.user.id, 'dept_batch_delete', `n=${out.deleted.length} names=${names(out.deleted)}`, req.ip);
    return out;
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
    if (!b.deptId) throw E.badInput('请选择所属科室');
    const catName = reqText(b.catName ?? '', '', '设备品类', 40);
    const code = reqText(b.code ?? '', '', '设备编码', 60);
    const name = reqText(b.name ?? '', '', '设备名称', 100);
    if (!db().prepare('SELECT 1 FROM depts WHERE id = ?').get(+b.deptId)) throw E.badInput('科室不存在');
    if (db().prepare('SELECT 1 FROM devices WHERE code = ?').get(code)) throw E.conflict('设备编码已存在');
    const exp = normExpiry(b);
    const id = db().prepare(`INSERT INTO devices (dept_id, cat_name, code, name, model, location, status, sort,
      expiry_date, expiry_note, remind_days, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(+b.deptId, catName, code, name, String(b.model || '').trim(),
        String(b.location || '').trim(), devStatus(b.status, 'in_use'), sortOf(b.sort, 0),
        exp.date, exp.note, exp.days, nowIso(), nowIso()).lastInsertRowid;
    return deviceJson(db().prepare('SELECT * FROM devices WHERE id = ?').get(id));
  });

  app.patch('/api/admin/devices/:id', { preHandler: guard }, async req => {
    const v = db().prepare('SELECT * FROM devices WHERE id = ?').get(+req.params.id);
    if (!v) throw E.notFound('设备不存在');
    const b = req.body || {};
    const code = reqText(b.code, v.code, '设备编码', 60);
    const catName = reqText(b.catName, v.cat_name, '设备品类', 40);
    const name = reqText(b.name, v.name, '设备名称', 100);
    if (code !== v.code && db().prepare('SELECT 1 FROM devices WHERE code = ?').get(code)) throw E.conflict('设备编码已存在');
    if (b.deptId != null && !db().prepare('SELECT 1 FROM depts WHERE id = ?').get(+b.deptId)) throw E.badInput('科室不存在');
    const exp = normExpiry(b, v);
    const deptId = +(b.deptId ?? v.dept_id);
    db().prepare(`UPDATE devices SET dept_id = ?, cat_name = ?, code = ?, name = ?, model = ?, location = ?,
      status = ?, sort = ?, expiry_date = ?, expiry_note = ?, remind_days = ?, updated_at = ? WHERE id = ?`)
      .run(deptId, catName, code, name, String(b.model ?? v.model).trim(), String(b.location ?? v.location).trim(),
        devStatus(b.status, v.status), sortOf(b.sort, v.sort),
        exp.date, exp.note, exp.days, nowIso(), v.id);
    // 调拨留痕：月报按实际巡检记录出行，调拨本身记进审计，事后能查到设备何时从哪调到哪
    if (deptId !== v.dept_id) authSvc.audit(req.user.id, 'device_transfer', `code=${code} from=${v.dept_id} to=${deptId}`, req.ip);
    return deviceJson(db().prepare('SELECT * FROM devices WHERE id = ?').get(v.id));
  });

  /* 巡检过的设备不能删：删了它，历史巡检记录、月报、异常清单里这台设备就没了着落。
     作废签字只撤销签字、不删巡检记录，所以「日签作废了」也照样删不掉——提示里说清楚，
     并给出该怎么做（停用 / 报废：手机端不再列出，历史保留）；管理后台据此提供一键改状态。 */
  app.delete('/api/admin/devices/:id', { preHandler: guard }, async req => {
    const id = +req.params.id;
    const v = db().prepare('SELECT * FROM devices WHERE id = ?').get(id);
    if (!v) throw E.notFound('设备不存在');
    const used = db().prepare(`SELECT COUNT(*) AS n, MAX(r.date) AS last FROM record_items i
      JOIN records r ON r.id = i.record_id WHERE i.device_id = ?`).get(id);
    if (used.n) {
      throw E.conflict(`「${v.code} ${v.name}」有 ${used.n} 天的巡检记录（最近一次 ${used.last}），为保留巡检历史不能删除`
        + '（作废签字只撤销签字，巡检记录仍在）。不再使用请改为「已停用」，已报废请改为「已报废」：'
        + '手机端不再列出这台设备，历史记录和报表照常保留。');
    }
    db().prepare('DELETE FROM devices WHERE id = ?').run(id);
    authSvc.audit(req.user.id, 'device_delete', `code=${v.code} name=${v.name}`, req.ip);
    return { ok: true };
  });

  /* 批量处理：勾选多台设备，一次改状态或删除（导错一批设备时不用一台台点）。
     body { ids:[...], action:'status'|'delete', status? }
     删除同单台规则：巡检过的设备不删（保留历史），列在 blocked 里，后台据此提供一键改停用 / 报废。 */
  app.post('/api/admin/devices/batch', { preHandler: guard }, async req => {
    const b = req.body || {};
    const ids = batchIds(b.ids, '设备');
    if (!['status', 'delete'].includes(b.action)) throw E.badInput('action 只能是 status / delete');
    const status = b.action === 'status' ? devStatus(b.status, null) : null;
    if (b.action === 'status' && !status) throw E.badInput('请选择要改成的状态');
    const get = db().prepare('SELECT id, code, name FROM devices WHERE id = ?');
    const used = db().prepare(`SELECT COUNT(*) AS n, MAX(r.date) AS last FROM record_items i
      JOIN records r ON r.id = i.record_id WHERE i.device_id = ?`);
    const out = { updated: [], deleted: [], blocked: [], missing: [] };
    db().transaction(() => {
      for (const id of ids) {
        const v = get.get(id);
        if (!v) { out.missing.push(String(id)); continue; }
        const one = { id: String(v.id), code: v.code, name: v.name };
        if (status) {
          db().prepare('UPDATE devices SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
          out.updated.push(one);
          continue;
        }
        const u = used.get(id);
        if (u.n) { out.blocked.push({ ...one, days: u.n, last: u.last }); continue; }
        db().prepare('DELETE FROM devices WHERE id = ?').run(id);
        out.deleted.push(one);
      }
    })();
    const codes = l => l.map(x => x.code).slice(0, 100).join(',') + (l.length > 100 ? ` 等 ${l.length} 台` : '');
    if (out.updated.length) authSvc.audit(req.user.id, 'device_batch_status', `status=${status} n=${out.updated.length} codes=${codes(out.updated)}`, req.ip);
    if (out.deleted.length) authSvc.audit(req.user.id, 'device_batch_delete', `n=${out.deleted.length} codes=${codes(out.deleted)}`, req.ip);
    return out;
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
    const name = String(b.name || '').trim();
    if (!b.deptId || !name) throw E.badInput('科室和姓名必填');
    if (!db().prepare('SELECT 1 FROM depts WHERE id = ?').get(+b.deptId)) throw E.badInput('科室不存在');
    if (db().prepare('SELECT 1 FROM members WHERE dept_id = ? AND name = ?').get(+b.deptId, name)) {
      throw E.conflict('该科室已有同名签字人');
    }
    const id = db().prepare('INSERT INTO members (dept_id, name, title, status, sort) VALUES (?, ?, ?, ?, ?)')
      .run(+b.deptId, name, String(b.title || '').trim(), b.status === 'off' ? 'off' : 'on', sortOf(b.sort, 0)).lastInsertRowid;
    return memberJson(db().prepare('SELECT * FROM members WHERE id = ?').get(id));
  });

  app.patch('/api/admin/members/:id', { preHandler: guard }, async req => {
    const m = db().prepare('SELECT * FROM members WHERE id = ?').get(+req.params.id);
    if (!m) throw E.notFound('签字人不存在');
    const b = req.body || {};
    /* 签字人不能换科室：他签过的周签都挂在原科室，换过去会让原科室的历史周签显示成别科室的人。
       以前静默忽略，界面提示保存成功、实际没变。 */
    if (b.deptId != null && +b.deptId !== m.dept_id) {
      throw E.badInput('签字人不能改科室。如果调到了别的科室，请在新科室里新建一位签字人，并把这里的停用');
    }
    const name = String(b.name ?? m.name).trim();
    const title = String(b.title ?? m.title).trim();
    if (!name) throw E.badInput('姓名不能为空');
    if (b.status != null && !['on', 'off'].includes(b.status)) throw E.badInput('status 不正确');
    // 以前不查重，改成同科室已有的名字会撞上数据库唯一约束，接口直接报 500
    if (name !== m.name && db().prepare('SELECT 1 FROM members WHERE dept_id = ? AND name = ? AND id <> ?').get(m.dept_id, name, m.id)) {
      throw E.conflict('该科室已有同名签字人');
    }
    db().transaction(() => {
      db().prepare('UPDATE members SET name = ?, title = ?, status = ?, sort = ? WHERE id = ?')
        .run(name, title, b.status || m.status, sortOf(b.sort, m.sort), m.id);
      /* 历史周签的快照跟着最新姓名走：页面本来就按 ID 显示当前姓名，这里同步快照，
         是为了这个签字人以后被删除时，历史记录仍显示最新姓名而不是早已改掉的旧名。
         同时把升级前签的、还没建立关联的周签（同科室、签的是原姓名）一并关联上。 */
      db().prepare(`UPDATE week_signs SET sign_member_id = ?, sign_name = ?, sign_title = ?
        WHERE dept_id = ? AND (sign_member_id = ? OR (sign_member_id IS NULL AND sign_name = ?))`)
        .run(m.id, name, title, m.dept_id, m.id, m.name);
    })();
    return memberJson(db().prepare('SELECT * FROM members WHERE id = ?').get(m.id));
  });

  app.delete('/api/admin/members/:id', { preHandler: guard }, async req => {
    if (!db().prepare('SELECT 1 FROM members WHERE id = ?').get(+req.params.id)) throw E.notFound('签字人不存在');
    db().prepare('DELETE FROM members WHERE id = ?').run(+req.params.id);
    return { ok: true };
  });

  /* ---------- 作废签字（admin） ---------- */
  app.post('/api/admin/signs/void', { preHandler: adminOnly }, async req => {
    const { type, deptId, key } = req.body || {};
    const reason = String((req.body || {}).reason || '').trim();
    if (!['day', 'week', 'month'].includes(type)) throw E.badInput('type 必须是 day/week/month');
    if (!deptId || !key) throw E.badInput('deptId/key 必填');
    if (!reason) throw E.badInput('请填写作废原因');
    let orig = '';   // 被作废的签字原样写进审计：签字行会被清空/删除，事后要能查到原来是谁、何时签的
    const did = +deptId;
    /* 作废必须「自上而下」：上级签字建立在下级签字之上，且上级签字会锁定下级记录。
       若允许先作废下级（如周签还在时作废日签），就会出现「周签已签、其中一天却没有日签」，
       而那一天又因周签锁定永远补签不了——数据进入无法自愈的矛盾状态。 */
    const monthSigned = m => db().prepare('SELECT 1 FROM month_signs WHERE dept_id = ? AND month = ?').get(did, m);
    const weekSigned = w => db().prepare('SELECT 1 FROM week_signs WHERE dept_id = ? AND week_start = ?').get(did, w);
    if (type === 'day') {
      const r = db().prepare('SELECT * FROM records WHERE dept_id = ? AND date = ?').get(did, String(key));
      if (!r || !r.sign_at) throw E.notFound('该日无签字');
      const w = P.wkOf(r.date);
      if (weekSigned(w)) throw E.locked(`${w} 起的这一周已周签，请先作废周签，再作废这一天的日签`);
      const mo = P.signMonthOf(r.date);   // 这一天所在的周归哪个月，就由哪个月的月签管
      if (monthSigned(mo)) throw E.locked(`这一天所属的 ${mo} 已月签，请先作废月签`);
      orig = `签字人=${r.sign_name} 签字人账号=${r.sign_user_id ?? ''} 时间=${r.sign_at} 签名图=${r.sign_file_id} 意见=${r.sign_opinion || ''}`;
      db().prepare(`UPDATE records SET sign_name = NULL, sign_title = NULL, sign_opinion = NULL,
        sign_file_id = NULL, sign_user_id = NULL, sign_at = NULL, updated_at = ? WHERE id = ?`).run(P.stamp(), r.id);
    } else if (type === 'week') {
      const r = db().prepare('SELECT * FROM week_signs WHERE dept_id = ? AND week_start = ?').get(did, String(key));
      if (!r) throw E.notFound('该周无签字');
      const m = P.moOf(r.week_start);   // 周按周一所在月份归属
      if (monthSigned(m)) throw E.locked(`这一周归属的 ${m} 已月签，请先作废月签，再作废周签`);
      orig = `签字人=${r.sign_name} 名单ID=${r.sign_member_id ?? ''} 时间=${r.sign_at} 签名图=${r.sign_file_id} 统计=台次${r.stat_checked}/异常${r.stat_ng}/天数${r.stat_days}`;
      db().prepare('DELETE FROM week_signs WHERE id = ?').run(r.id);
    } else {
      const r = db().prepare('SELECT * FROM month_signs WHERE dept_id = ? AND month = ?').get(did, String(key));
      if (!r) throw E.notFound('该月无签字');
      orig = `签字人=${r.sign_name} 账号=${r.signed_by ?? ''} 时间=${r.sign_at} 签名图=${r.sign_file_id} 统计=台次${r.stat_checked}/异常${r.stat_ng}/周数${r.stat_weeks}`;
      db().prepare('DELETE FROM month_signs WHERE id = ?').run(r.id);
    }
    authSvc.audit(req.user.id, 'sign_void', `type=${type} deptId=${did} key=${key} reason=${reason} 原签字：${orig}`, req.ip);
    return { ok: true };
  });

  /* ---------- 历史数据导入（admin） ---------- */
  app.post('/api/admin/import/legacy', {
    preHandler: adminOnly, bodyLimit: 50 * 1024 * 1024
  }, async req => {
    // dryRun=1：「先检查」——完整走一遍、整体回滚，不写任何数据
    const dryRun = req.query.dryRun === '1';
    const out = importSvc.importLegacy(req.body, { dryRun });
    if (!dryRun) authSvc.audit(req.user.id, 'import_legacy', JSON.stringify(out.imported), req.ip);
    return out;
  });

  /* ---------- 审计日志 ---------- */
  app.get('/api/admin/audit', { preHandler: guard }, async req => {
    const { from, to } = req.query;
    const cond = []; const args = [];
    /* 审计时间按 UTC 存；按日期筛选时换算成上海的一整天，否则凌晨 0–8 点的操作会落到前一天 */
    const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
    if (from) { cond.push('created_at >= ?'); args.push(isDay(from) ? P.shDayStartIso(from) : String(from)); }
    if (to) { cond.push('created_at <= ?'); args.push(isDay(to) ? P.shDayEndIso(to) : String(to)); }
    return db().prepare(`SELECT * FROM audit_log ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY id DESC LIMIT 1000`)
      .all(...args)
      .map(a => ({ id: String(a.id), userId: a.user_id != null ? String(a.user_id) : null,
        action: a.action, detail: a.detail, ip: a.ip, createdAt: a.created_at }));
  });
};
