'use strict';
/* 操作日志：谁、什么时候、在哪台设备上、对什么、做了什么、改前改后。
   每条都存操作人当时的账号和姓名（快照），账号以后改名或删除，日志照样看得懂。
   日志只增不改：后台没有修改、删除日志的入口（清空数据命令 reset-data 除外，它本身会留一条记录）。 */
const { getDb } = require('../db/connection');
const { STATUS_TEXT } = require('./device-status');

const nowIso = () => new Date().toISOString();
const ROLE_TEXT = { inspector: '巡检员', dept: '护士长', equip: '设备科', admin: '超级管理员' };
const ONOFF = { on: '启用', off: '停用' };
const MODULES = ['账号', '科室', '设备', '签字人', '签字', '登录', '导入', '导出', '系统'];

/* 旧的 action 名 → 模块 / 操作（authSvc.audit 还在用这些名字，统一在这里换算） */
const ACTION_MAP = {
  user_create: ['账号', '新增'], user_patch: ['账号', '修改'], user_delete: ['账号', '删除'],
  user_disable: ['账号', '停用'], user_enable: ['账号', '启用'], user_reset_password: ['账号', '重置密码'], user_unfreeze: ['账号', '解冻'], users_import: ['账号', '批量导入'],
  dept_create: ['科室', '新增'], dept_patch: ['科室', '修改'], dept_disable: ['科室', '停用'], dept_enable: ['科室', '启用'],
  dept_delete: ['科室', '删除'], depts_import: ['科室', '批量导入'], dept_batch_status: ['科室', '批量改状态'], dept_batch_delete: ['科室', '批量删除'],
  device_create: ['设备', '新增'], device_patch: ['设备', '修改'], device_transfer: ['设备', '调拨'], device_delete: ['设备', '删除'],
  devices_import: ['设备', '批量导入'], device_batch_status: ['设备', '批量改状态'], device_batch_delete: ['设备', '批量删除'],
  member_create: ['签字人', '新增'], member_patch: ['签字人', '修改'], member_delete: ['签字人', '删除'],
  sign_void: ['签字', '作废'], sign_day: ['签字', '日签'], sign_week: ['签字', '周签'], sign_month: ['签字', '月签'],
  login: ['登录', '登录'], login_fail: ['登录', '登录失败'], logout: ['登录', '退出登录'], change_password: ['登录', '修改密码'],
  refresh_replay: ['登录', '登录凭证重放（已全部吊销）'], refresh_device_mismatch: ['登录', '登录凭证换设备使用（已拒绝）'],
  import_legacy: ['导入', '历史数据导入'], export_monthly: ['导出', '导出月报'], export_ng: ['导出', '导出异常清单'],
  export_oplog: ['导出', '导出操作日志'], data_reset: ['系统', '清空数据'], ams_restore: ['系统', '资产盘点数据还原'],
};
const FAIL_ACTIONS = new Set(['login_fail', 'refresh_replay', 'refresh_device_mismatch']);

const clip = (v, n) => (v == null ? '' : String(v)).slice(0, n);

/* 写一条日志。
   req：有就从里面取操作人（req.user）、IP、设备号、User-Agent；
   user：没有 req.user 时（登录失败、登录成功那一刻）显式传 {id, username, displayName, role}；
   action：机器可读的动作名（见 ACTION_MAP）；module / op 不传就按 action 换算。
   写日志失败绝不能让业务操作失败：吞掉异常，只在控制台留一句。 */
function write({ req, user, action, module, op, target, summary, changes, detail, result }) {
  try {
    const u = user || (req && req.user) || null;
    const [m, o] = ACTION_MAP[action] || ['系统', action];
    const ch = Array.isArray(changes) && changes.length ? JSON.stringify(changes.slice(0, 200)) : null;
    getDb().prepare(`INSERT INTO audit_log (user_id, action, detail, ip, created_at,
        username, user_name, user_role, module, op, target, summary, changes, result, ua, device)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(u && u.id != null ? +u.id : null, action, clip(detail, 4000), clip(req && req.ip, 64), nowIso(),
        u ? clip(u.username, 64) : null, u ? clip(u.displayName ?? u.display_name, 64) : null, u ? u.role || null : null,
        module || m, op || o, clip(target, 300), clip(summary ?? detail, 2000), ch,
        result || (FAIL_ACTIONS.has(action) ? 'fail' : 'ok'),
        clip(req && req.headers && req.headers['user-agent'], 300), clip(req && req.headers && req.headers['x-device-id'], 64));
  } catch (e) {
    console.error('写操作日志失败：', e.message);
  }
}

/* 对比改前改后，只留下变了的字段。fields：[[键, 中文名, 显示函数?], …]；值为数组时按内容比较 */
function diff(before, after, fields) {
  const out = [];
  const same = (a, b) => (Array.isArray(a) || Array.isArray(b)
    ? JSON.stringify([...(a || [])].map(String).sort()) === JSON.stringify([...(b || [])].map(String).sort())
    : String(a ?? '') === String(b ?? ''));
  for (const [k, label, fmt] of fields) {
    const a = before ? before[k] : undefined, b = after ? after[k] : undefined;
    if (before && after && same(a, b)) continue;
    const show = v => (v == null || v === '' || (Array.isArray(v) && !v.length) ? '（空）' : fmt ? fmt(v) : String(v));
    out.push({ f: label, from: before ? show(a) : '', to: after ? show(b) : '' });
  }
  return out;
}

/* 显示用：科室 id → 名称 */
function deptNames(ids) {
  const db = getDb();
  return (ids || []).map(id => (db.prepare('SELECT name FROM depts WHERE id = ?').get(+id) || {}).name || `科室${id}`).join('、');
}
const fmt = {
  role: v => ROLE_TEXT[v] || v,
  onoff: v => ONOFF[v] || v,
  devStatus: v => STATUS_TEXT[v] || v,
  depts: v => deptNames(Array.isArray(v) ? v : [v]),
  dept: v => deptNames([v]),
};
const userLabel = u => `账号 ${u.username}（${u.display_name ?? u.displayName}）`;
const deviceLabel = v => `设备 ${v.code && v.code !== '/' ? v.code + ' ' : ''}${v.name}`;

/* 列表查询（后台「操作日志」页）：按时间倒序，分页。size = 0 表示全部（最多 5000 条） */
function query(f, { page = 1, size = 20 } = {}) {
  const db = getDb();
  const cond = [], args = [];
  if (f.fromIso) { cond.push('created_at >= ?'); args.push(f.fromIso); }
  if (f.toIso) { cond.push('created_at <= ?'); args.push(f.toIso); }
  if (f.module) { cond.push('module = ?'); args.push(f.module); }
  if (f.op) { cond.push('op = ?'); args.push(f.op); }
  if (f.userId) { cond.push('user_id = ?'); args.push(+f.userId); }
  if (f.result) { cond.push('result = ?'); args.push(f.result); }
  if (f.q) {
    cond.push("(target LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' OR user_name LIKE ? ESCAPE '\\' OR changes LIKE ? ESCAPE '\\' OR ip LIKE ? ESCAPE '\\')");
    const like = '%' + String(f.q).replace(/[\\%_]/g, c => '\\' + c) + '%';
    for (let i = 0; i < 7; i++) args.push(like);
  }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_log ${where}`).get(...args).c;
  const lim = size > 0 ? Math.min(size, 500) : 5000;
  const off = size > 0 ? (Math.max(1, page) - 1) * lim : 0;
  const rows = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, lim, off);
  return { total, page: size > 0 ? Math.max(1, page) : 1, size: size > 0 ? lim : 0, capped: size === 0 && total > lim, items: rows.map(json) };
}
function json(a) {
  // 回退到旧版本期间旧代码写的日志没有模块、操作这些列：按 action 补上
  const [m0, o0] = ACTION_MAP[a.action] || ['系统', a.action];
  let changes = [];
  try { changes = a.changes ? JSON.parse(a.changes) : []; } catch { /* 坏数据不影响列表 */ }
  return { id: String(a.id), createdAt: a.created_at, userId: a.user_id != null ? String(a.user_id) : null,
    username: a.username || '', userName: a.user_name || '', userRole: a.user_role || '',
    module: a.module || m0, op: a.op || o0, action: a.action, target: a.target || '',
    summary: a.summary || a.detail || '', detail: a.detail || '', changes, result: a.result || 'ok',
    ip: a.ip || '', ua: a.ua || '', device: a.device || '' };
}
/* 筛选下拉：实际出现过的模块、操作、操作人 */
function meta() {
  const db = getDb();
  return {
    modules: MODULES,
    ops: db.prepare("SELECT module, op, COUNT(*) AS c FROM audit_log WHERE op IS NOT NULL GROUP BY module, op ORDER BY module, c DESC").all()
      .map(r => ({ module: r.module, op: r.op })),
    users: db.prepare(`SELECT user_id AS id, MAX(username) AS username, MAX(user_name) AS name FROM audit_log
      WHERE user_id IS NOT NULL GROUP BY user_id ORDER BY MAX(id) DESC`).all()
      .map(r => ({ id: String(r.id), username: r.username || '', name: r.name || '' })),
  };
}

module.exports = { write, diff, fmt, userLabel, deviceLabel, deptNames, query, meta, ACTION_MAP, ROLE_TEXT };
