'use strict';
const { getDb } = require('../db/connection');
const { E } = require('../plugins/error');
const P = require('./period.service');
const fileSvc = require('./file.service');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(s) {
  if (!DATE_RE.test(String(s)) || P.fmt(P.D(s)) !== s) throw E.badInput('日期格式不正确');
}

/* ---------- 名字一律显示「当前名」 ----------
   巡检人、日签人按账号 ID 关联 users；周签人按签字人名单 ID 关联 members；月签人按账号 ID。
   关联对象不存在（如签字人已从名单删除）时，退回签字当时存下的快照名。 */
const REC_SELECT = `SELECT r.*, iu.display_name AS inspector_live, su.display_name AS sign_user_live
  FROM records r
  LEFT JOIN users iu ON iu.id = r.inspector_id
  LEFT JOIN users su ON su.id = r.sign_user_id`;
const WS_SELECT = `SELECT w.*, m.name AS member_live, m.title AS member_title_live
  FROM week_signs w LEFT JOIN members m ON m.id = w.sign_member_id`;
const MS_SELECT = `SELECT ms.*, u.display_name AS signer_live
  FROM month_signs ms LEFT JOIN users u ON u.id = ms.signed_by`;

/* ---------- record 行 → 契约 JSON（checks/notes 由 record_items 聚合） ---------- */
function recordJson(row, items) {
  const checks = {}, notes = {};
  for (const it of items) {
    checks[String(it.device_id)] = it.result;
    if (it.note) notes[String(it.device_id)] = it.note;
  }
  return {
    id: String(row.id), deptId: String(row.dept_id), date: row.date,
    checks, notes,
    sign: row.sign_at ? {
      name: row.sign_user_live || row.sign_name, title: row.sign_title || '',
      url: `/api/files/${row.sign_file_id}`, opinion: row.sign_opinion || '', at: row.sign_at
    } : null,
    inspectorId: row.inspector_id != null ? String(row.inspector_id) : null,
    inspectorName: row.inspector_live || row.inspector_name || '',
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}
function loadItems(db, recordIds) {
  if (!recordIds.length) return new Map();
  const map = new Map(recordIds.map(id => [id, []]));
  const qs = recordIds.map(() => '?').join(',');
  for (const it of db.prepare(`SELECT * FROM record_items WHERE record_id IN (${qs})`).all(...recordIds)) {
    map.get(it.record_id).push(it);
  }
  return map;
}

function getRecordRow(deptId, date) {
  return getDb().prepare(`${REC_SELECT} WHERE r.dept_id = ? AND r.date = ?`).get(deptId, date);
}

function getRecord(deptId, date) {
  const db = getDb();
  const row = getRecordRow(deptId, date);
  if (!row) return null;
  return recordJson(row, db.prepare('SELECT * FROM record_items WHERE record_id = ?').all(row.id));
}

function listRecords({ deptIds, deptId, from, to }) {
  const db = getDb();
  const cond = []; const args = [];
  if (deptId != null) { cond.push('r.dept_id = ?'); args.push(+deptId); }
  else if (deptIds) { cond.push(`r.dept_id IN (${deptIds.map(() => '?').join(',') || 'NULL'})`); args.push(...deptIds); }
  if (from) { cond.push('r.date >= ?'); args.push(from); }
  if (to) { cond.push('r.date <= ?'); args.push(to); }
  const rows = db.prepare(`${REC_SELECT} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY r.date, r.dept_id`).all(...args);
  const items = loadItems(db, rows.map(r => r.id));
  return rows.map(r => recordJson(r, items.get(r.id) || []));
}

/* 日期可写校验：不能未来、日/周/月任一已签即锁定。
   月锁看「这一天所在的周归哪个月」（P.signMonthOf），与月签覆盖的范围一致；
   按日期本身的月份加锁会把跨月周里属于上个月的几天锁死（见 period.service signMonthOf 注释）。 */
function lockReason(deptId, date) {
  const db = getDb();
  const row = getRecordRow(deptId, date);
  if (row && row.sign_at) return { level: 'day', message: '该日已签字锁定' };
  const wk = P.wkOf(date);
  if (db.prepare('SELECT 1 FROM week_signs WHERE dept_id = ? AND week_start = ?').get(deptId, wk)) {
    return { level: 'week', message: `该日所在的这一周（${wk.slice(5)} 起）已完成周签，记录锁定` };
  }
  const mo = P.signMonthOf(date);
  if (db.prepare('SELECT 1 FROM month_signs WHERE dept_id = ? AND month = ?').get(deptId, mo)) {
    return { level: 'month', message: `该日所属的 ${mo} 已完成月签，记录锁定` };
  }
  return null;
}
function assertWritable(deptId, date, today) {
  if (date > today) throw E.early('不能提前记录未来日期');
  const lk = lockReason(deptId, date);
  if (lk) throw E.locked(lk.message);
  return getRecordRow(deptId, date);
}
/* 停用的科室不再接受巡检录入和日签（停用而不删除，是为了保留历史）。
   要补录停用前漏掉的日子，先在后台把科室改回启用。 */
function assertDeptActive(deptId) {
  const d = getDb().prepare('SELECT name, status FROM depts WHERE id = ?').get(deptId);
  if (!d) throw E.notFound('科室不存在');
  if (d.status !== 'on') throw E.badInput(`科室「${d.name}」已停用，不能再录入巡检；如需补录，请先在后台把科室改回启用`);
}
const MAX_CHECKS = 2000;     // 单科室单日勾选上限（远大于任何科室的设备数），防止超大请求拖垮 SQLite
const MAX_NOTE = 500;

/* PUT /api/records/:deptId/:date —— checks/notes 整体覆盖 */
function putRecord(user, deptId, date, body) {
  const db = getDb();
  assertDate(date);
  deptId = +deptId;
  assertDeptActive(deptId);
  const checks = body && body.checks;
  const notes = (body && body.notes) || {};
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) throw E.badInput('checks 必须是对象');
  if (typeof notes !== 'object' || Array.isArray(notes)) throw E.badInput('notes 必须是对象');
  const today = P.today();
  const row = assertWritable(deptId, date, today);

  /* 键必须是规范的正整数写法：「02」「2.0」经 +k 都会变成 2 并通过校验，
     写入时却按 2 去取值取不到，最后撞 NOT NULL 约束返回 500 */
  const keys = Object.keys(checks);
  if (keys.length > MAX_CHECKS) throw E.badInput('勾选的设备数量异常');
  if (keys.some(k => !/^[1-9]\d{0,9}$/.test(k))) throw E.badInput('设备 id 不正确');
  const devIds = keys.map(Number);
  for (const [k, v] of Object.entries(checks)) {
    if (v !== 'ok' && v !== 'ng') throw E.badInput(`设备 ${k} 巡检结果必须是 ok/ng`);
  }
  if (devIds.length) {
    /* 能勾的设备：本科室在用的设备；以及这条记录里本来就勾过的设备——
       设备当天被调拨/停用后，早上已经做过的巡检照样保留，不会因此让整天都保存不了 */
    const qs = devIds.map(() => '?').join(',');
    const okIds = new Set(db.prepare(`SELECT id FROM devices WHERE dept_id = ? AND status = 'in_use' AND id IN (${qs})`)
      .all(deptId, ...devIds).map(r => r.id));
    if (row) for (const it of db.prepare('SELECT device_id FROM record_items WHERE record_id = ?').all(row.id)) okIds.add(it.device_id);
    for (const id of devIds) {
      if (okIds.has(id)) continue;
      const dv = db.prepare('SELECT code, dept_id, status FROM devices WHERE id = ?').get(id);
      if (!dv) throw E.badInput(`设备 ${id} 不存在`);
      if (dv.dept_id !== deptId) throw E.badInput(`设备「${dv.code}」已不属于该科室（可能刚被调拨），请返回刷新后再勾选`);
      throw E.badInput(`设备「${dv.code}」不是在用状态，不能勾选巡检`);
    }
  }

  const at = P.stamp();
  const tx = db.transaction(() => {
    let rid;
    if (row) {
      db.prepare('UPDATE records SET inspector_id = ?, inspector_name = ?, updated_at = ? WHERE id = ?')
        .run(user.id, user.displayName, at, row.id);
      rid = row.id;
    } else {
      rid = db.prepare(`INSERT INTO records (dept_id, date, inspector_id, inspector_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(deptId, date, user.id, user.displayName, at, at).lastInsertRowid;
    }
    db.prepare('DELETE FROM record_items WHERE record_id = ?').run(rid);
    const ins = db.prepare('INSERT INTO record_items (record_id, device_id, result, note) VALUES (?, ?, ?, ?)');
    for (const id of devIds) ins.run(rid, id, checks[id], checks[id] === 'ng' ? String(notes[id] || '').slice(0, MAX_NOTE) : '');
    return rid;
  });
  const rid = tx();
  return recordJson(db.prepare(`${REC_SELECT} WHERE r.id = ?`).get(rid),
    db.prepare('SELECT * FROM record_items WHERE record_id = ?').all(rid));
}

/* 签字人身份由服务端认定，不再信任前端传来的姓名：
   日签人 = 登录的巡检员本人，月签人 = 登录的设备科账号，周签人必须是本科室签字人名单里的在用成员。 */
function assertSignImage(body) {
  if (!body || typeof body.dataUrl !== 'string' || !body.dataUrl) throw E.badInput('请先手写签名');
}
function resolveWeekSigner(deptId, body) {
  const db = getDb();
  let m = null;
  if (body && body.memberId != null && body.memberId !== '') {
    m = db.prepare('SELECT * FROM members WHERE id = ? AND dept_id = ?').get(+body.memberId, deptId);
  } else if (body && typeof body.name === 'string' && body.name.trim()) {
    m = db.prepare('SELECT * FROM members WHERE dept_id = ? AND name = ?').get(deptId, body.name.trim());
  } else {
    throw E.badInput('请选择签字人');
  }
  if (!m) throw E.badInput('签字人不在本科室的签字人名单中，请联系设备科在「签字人名单」里添加');
  if (m.status !== 'on') throw E.badInput(`签字人「${m.name}」已停用`);
  return m;
}

/* POST /api/records/:deptId/:date/sign —— 日签 */
function signRecord(user, deptId, date, body) {
  const db = getDb();
  assertDate(date);
  deptId = +deptId;
  assertDeptActive(deptId);
  assertSignImage(body);
  const today = P.today();
  const row = assertWritable(deptId, date, today);
  if (!row) throw E.notFound('该日尚无巡检记录，请先提交巡检结果');
  const f = fileSvc.saveSignature(body.dataUrl);
  const at = P.stamp();
  db.prepare(`UPDATE records SET sign_name = ?, sign_title = ?, sign_opinion = ?, sign_file_id = ?,
    sign_user_id = ?, sign_at = ?, updated_at = ? WHERE id = ?`)
    .run(user.displayName, '巡检员', String(body.opinion || ''), f.id, user.id, at, at, row.id);
  return getRecord(deptId, date);
}

/* ---------- 周签 ---------- */
function weekSignJson(row) {
  const live = row.member_live != null;
  return {
    id: String(row.id), deptId: String(row.dept_id), week: row.week_start,
    sign: { name: live ? row.member_live : row.sign_name, title: live ? row.member_title_live : row.sign_title,
      url: `/api/files/${row.sign_file_id}`, opinion: row.sign_opinion, at: row.sign_at },
    stat: { checked: row.stat_checked, ng: row.stat_ng, days: row.stat_days },
    at: row.sign_at
  };
}

function listWeekSigns({ deptIds, deptId, from, to }) {
  const db = getDb();
  const cond = []; const args = [];
  if (deptId != null) { cond.push('w.dept_id = ?'); args.push(+deptId); }
  else if (deptIds) { cond.push(`w.dept_id IN (${deptIds.map(() => '?').join(',') || 'NULL'})`); args.push(...deptIds); }
  /* from 不是周一时对齐到它所在周的周一：否则从周三查，会漏掉这周（周签以周一为键） */
  if (from) { cond.push('w.week_start >= ?'); args.push(DATE_RE.test(String(from)) ? P.wkOf(from) : from); }
  if (to) { cond.push('w.week_start <= ?'); args.push(to); }
  return db.prepare(`${WS_SELECT} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY w.week_start, w.dept_id`)
    .all(...args).map(weekSignJson);
}

/* 该科室某周状态（从库取数后走 period.weekState 纯函数） */
function deptWeekState(deptId, week, today) {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM records WHERE dept_id = ? AND date >= ? AND date <= ?')
    .all(deptId, week, P.addDay(week, 6));
  const items = loadItems(db, rows.map(r => r.id));
  const recs = rows.map(r => {
    const checks = {};
    for (const it of (items.get(r.id) || [])) checks[String(it.device_id)] = it.result;
    return { date: r.date, sign: !!r.sign_at, checks };
  });
  const ws = db.prepare(`${WS_SELECT} WHERE w.dept_id = ? AND w.week_start = ?`).get(deptId, week) || null;
  return P.weekState({ week, today, recs, ws });
}

function signWeek(user, deptId, week, body) {
  const db = getDb();
  deptId = +deptId;
  if (!DATE_RE.test(String(week)) || P.wkOf(week) !== week) throw E.badInput('week 必须是周一日期');
  assertSignImage(body);
  const member = resolveWeekSigner(deptId, body);
  const today = P.today();
  if (week > today) throw E.early('这一周还没开始，不能提前签字');
  const st = deptWeekState(deptId, week, today);
  if (st.locked) throw E.locked('本周已签字');
  if (st.missDue.length) {
    throw E.notReady(`本周还有 ${st.missDue.length} 天没有日签（${st.missDue.map(d => d.slice(5)).join('、')}），补签后才能周签`);
  }
  if (st.future.length) {
    throw E.early(`本周还没结束（还有 ${st.future.length} 天未到），7 天日签全部完成后才能周签`);
  }
  if (!st.ready) throw E.notReady('本周日签未全部完成');
  const f = fileSvc.saveSignature(body.dataUrl);
  const at = P.stamp();
  const id = db.prepare(`INSERT INTO week_signs (dept_id, week_start, sign_name, sign_title, sign_opinion,
    sign_file_id, stat_checked, stat_ng, stat_days, signed_by, sign_member_id, sign_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(deptId, week, member.name, member.title || '', String(body.opinion || ''),
      f.id, st.checked, st.ng, st.signed.length, user.id, member.id, at).lastInsertRowid;
  return weekSignJson(db.prepare(`${WS_SELECT} WHERE w.id = ?`).get(id));
}

/* ---------- 月签 ---------- */
function monthSignJson(row) {
  return {
    id: String(row.id), deptId: String(row.dept_id), month: row.month,
    sign: { name: row.signer_live || row.sign_name, title: row.sign_title, url: `/api/files/${row.sign_file_id}`,
      opinion: row.sign_opinion, at: row.sign_at },
    stat: { checked: row.stat_checked, ng: row.stat_ng, weeks: row.stat_weeks },
    at: row.sign_at
  };
}

function listMonthSigns({ deptIds, deptId, year }) {
  const db = getDb();
  const cond = []; const args = [];
  if (deptId != null) { cond.push('ms.dept_id = ?'); args.push(+deptId); }
  else if (deptIds) { cond.push(`ms.dept_id IN (${deptIds.map(() => '?').join(',') || 'NULL'})`); args.push(...deptIds); }
  if (year) { cond.push("ms.month LIKE ? || '-%'"); args.push(String(year)); }
  return db.prepare(`${MS_SELECT} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY ms.month, ms.dept_id`)
    .all(...args).map(monthSignJson);
}

function deptMonthState(deptId, month, today) {
  const db = getDb();
  const weekSignWeeks = db.prepare('SELECT week_start FROM week_signs WHERE dept_id = ?').all(deptId).map(r => r.week_start);
  const span = P.monthSpan(month);   // 月签覆盖的是归属该月的各周，统计范围与之一致
  const rows = db.prepare('SELECT * FROM records WHERE dept_id = ? AND date >= ? AND date <= ?')
    .all(deptId, span.from, span.to);
  const items = loadItems(db, rows.map(r => r.id));
  const recs = rows.map(r => {
    const checks = {};
    for (const it of (items.get(r.id) || [])) checks[String(it.device_id)] = it.result;
    return { date: r.date, sign: !!r.sign_at, checks };
  });
  const ms = db.prepare(`${MS_SELECT} WHERE ms.dept_id = ? AND ms.month = ?`).get(deptId, month) || null;
  return P.monthState({ month, today, weekSignWeeks, recs, ms });
}

function signMonth(user, deptId, month, body) {
  const db = getDb();
  deptId = +deptId;
  if (!P.isMonth(month)) throw E.badInput('month 格式必须是 YYYY-MM（月份 01–12）');
  if (!db.prepare('SELECT 1 FROM depts WHERE id = ?').get(deptId)) throw E.notFound('科室不存在');
  assertSignImage(body);
  const today = P.today();
  if (month > P.moOf(today)) throw E.early('这个月还没开始，不能提前签字');
  const st = deptMonthState(deptId, month, today);
  if (st.locked) throw E.locked('本月已签字');
  if (st.missDue.length) {
    throw E.notReady(`该月还有 ${st.missDue.length} 周没有周签（${st.missDue.map(w => w.slice(5) + ' 起').join('、')}），科室周签后才能月签`);
  }
  if (st.openWeeks.length) {
    const last = st.openWeeks[st.openWeeks.length - 1];
    throw E.early(`本月还没结束：最后一周（${last.slice(5)} 至 ${P.addDay(last, 6).slice(5)}）周签完成后才能月签`);
  }
  if (!st.ready) throw E.notReady('该月仍有未完成周签的周');
  const f = fileSvc.saveSignature(body.dataUrl);
  const at = P.stamp();
  const id = db.prepare(`INSERT INTO month_signs (dept_id, month, sign_name, sign_title, sign_opinion,
    sign_file_id, stat_checked, stat_ng, stat_weeks, signed_by, sign_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(deptId, month, user.displayName, '设备科', String(body.opinion || ''),
      f.id, st.checked, st.ng, st.weeks.length, user.id, at).lastInsertRowid;
  return monthSignJson(db.prepare(`${MS_SELECT} WHERE ms.id = ?`).get(id));
}

module.exports = {
  REC_SELECT, WS_SELECT, MS_SELECT, lockReason,
  recordJson, getRecord, getRecordRow, listRecords, putRecord, signRecord,
  listWeekSigns, signWeek, deptWeekState,
  listMonthSigns, signMonth, deptMonthState, loadItems
};
