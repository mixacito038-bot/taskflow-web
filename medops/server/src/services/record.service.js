'use strict';
const { getDb } = require('../db/connection');
const { E } = require('../plugins/error');
const P = require('./period.service');
const fileSvc = require('./file.service');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function assertDate(s) {
  if (!DATE_RE.test(String(s)) || P.fmt(P.D(s)) !== s) throw E.badInput('日期格式不正确');
}

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
      name: row.sign_name, title: row.sign_title || '',
      url: `/api/files/${row.sign_file_id}`, opinion: row.sign_opinion || '', at: row.sign_at
    } : null,
    inspectorId: row.inspector_id != null ? String(row.inspector_id) : null,
    inspectorName: row.inspector_name || '',
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
  return getDb().prepare('SELECT * FROM records WHERE dept_id = ? AND date = ?').get(deptId, date);
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
  if (deptId != null) { cond.push('dept_id = ?'); args.push(+deptId); }
  else if (deptIds) { cond.push(`dept_id IN (${deptIds.map(() => '?').join(',') || 'NULL'})`); args.push(...deptIds); }
  if (from) { cond.push('date >= ?'); args.push(from); }
  if (to) { cond.push('date <= ?'); args.push(to); }
  const rows = db.prepare(`SELECT * FROM records ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY date, dept_id`).all(...args);
  const items = loadItems(db, rows.map(r => r.id));
  return rows.map(r => recordJson(r, items.get(r.id) || []));
}

/* 日期可写校验：不能未来、日/周/月任一已签即锁定 */
function assertWritable(deptId, date, today) {
  const db = getDb();
  if (date > today) throw E.early('不能提前记录未来日期');
  const row = getRecordRow(deptId, date);
  if (row && row.sign_at) throw E.locked('该日已签字锁定');
  const wk = P.wkOf(date);
  if (db.prepare('SELECT 1 FROM week_signs WHERE dept_id = ? AND week_start = ?').get(deptId, wk)) {
    throw E.locked('该周已完成周签，记录锁定');
  }
  if (db.prepare('SELECT 1 FROM month_signs WHERE dept_id = ? AND month = ?').get(deptId, P.moOf(date))) {
    throw E.locked('该月已完成月签，记录锁定');
  }
  return row;
}

/* PUT /api/records/:deptId/:date —— checks/notes 整体覆盖 */
function putRecord(user, deptId, date, body) {
  const db = getDb();
  assertDate(date);
  deptId = +deptId;
  if (!db.prepare('SELECT 1 FROM depts WHERE id = ?').get(deptId)) throw E.notFound('科室不存在');
  const checks = body && body.checks;
  const notes = (body && body.notes) || {};
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) throw E.badInput('checks 必须是对象');
  if (typeof notes !== 'object' || Array.isArray(notes)) throw E.badInput('notes 必须是对象');
  const today = P.today();
  const row = assertWritable(deptId, date, today);

  const devIds = Object.keys(checks).map(k => +k);
  if (devIds.some(id => !Number.isInteger(id) || id <= 0)) throw E.badInput('设备 id 不正确');
  for (const [k, v] of Object.entries(checks)) {
    if (v !== 'ok' && v !== 'ng') throw E.badInput(`设备 ${k} 巡检结果必须是 ok/ng`);
  }
  if (devIds.length) {
    const qs = devIds.map(() => '?').join(',');
    const okIds = new Set(db.prepare(`SELECT id FROM devices WHERE dept_id = ? AND id IN (${qs})`).all(deptId, ...devIds).map(r => r.id));
    for (const id of devIds) if (!okIds.has(id)) throw E.badInput(`设备 ${id} 不属于该科室`);
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
    for (const id of devIds) ins.run(rid, id, checks[id], String(notes[id] || ''));
    return rid;
  });
  const rid = tx();
  return recordJson(db.prepare('SELECT * FROM records WHERE id = ?').get(rid),
    db.prepare('SELECT * FROM record_items WHERE record_id = ?').all(rid));
}

function assertSignBody(body) {
  if (!body || typeof body.name !== 'string' || !body.name.trim()) throw E.badInput('请填写签字人姓名');
}

/* POST /api/records/:deptId/:date/sign —— 日签 */
function signRecord(user, deptId, date, body) {
  const db = getDb();
  assertDate(date);
  deptId = +deptId;
  assertSignBody(body);
  const today = P.today();
  const row = assertWritable(deptId, date, today);
  if (!row) throw E.notFound('该日尚无巡检记录，请先提交巡检结果');
  const f = fileSvc.saveSignature(body.dataUrl);
  const at = P.stamp();
  db.prepare(`UPDATE records SET sign_name = ?, sign_title = ?, sign_opinion = ?, sign_file_id = ?,
    sign_at = ?, updated_at = ? WHERE id = ?`)
    .run(body.name.trim(), String(body.title || ''), String(body.opinion || ''), f.id, at, at, row.id);
  return getRecord(deptId, date);
}

/* ---------- 周签 ---------- */
function weekSignJson(row) {
  return {
    id: String(row.id), deptId: String(row.dept_id), week: row.week_start,
    sign: { name: row.sign_name, title: row.sign_title, url: `/api/files/${row.sign_file_id}`,
      opinion: row.sign_opinion, at: row.sign_at },
    stat: { checked: row.stat_checked, ng: row.stat_ng, days: row.stat_days },
    at: row.sign_at
  };
}

function listWeekSigns({ deptIds, deptId, from, to }) {
  const db = getDb();
  const cond = []; const args = [];
  if (deptId != null) { cond.push('dept_id = ?'); args.push(+deptId); }
  else if (deptIds) { cond.push(`dept_id IN (${deptIds.map(() => '?').join(',') || 'NULL'})`); args.push(...deptIds); }
  if (from) { cond.push('week_start >= ?'); args.push(from); }
  if (to) { cond.push('week_start <= ?'); args.push(to); }
  return db.prepare(`SELECT * FROM week_signs ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY week_start, dept_id`)
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
  const ws = db.prepare('SELECT * FROM week_signs WHERE dept_id = ? AND week_start = ?').get(deptId, week) || null;
  return P.weekState({ week, today, recs, ws });
}

function signWeek(user, deptId, week, body) {
  const db = getDb();
  deptId = +deptId;
  if (!DATE_RE.test(String(week)) || P.wkOf(week) !== week) throw E.badInput('week 必须是周一日期');
  assertSignBody(body);
  const today = P.today();
  if (week > today) throw E.early('这一周还没开始，不能提前签字');
  const st = deptWeekState(deptId, week, today);
  if (st.locked) throw E.locked('本周已签字');
  if (!st.ready) throw E.notReady('本周尚有未完成日签的日期');
  const f = fileSvc.saveSignature(body.dataUrl);
  const at = P.stamp();
  const id = db.prepare(`INSERT INTO week_signs (dept_id, week_start, sign_name, sign_title, sign_opinion,
    sign_file_id, stat_checked, stat_ng, stat_days, signed_by, sign_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(deptId, week, body.name.trim(), String(body.title || ''), String(body.opinion || ''),
      f.id, st.checked, st.ng, st.days.length, user.id, at).lastInsertRowid;
  return weekSignJson(db.prepare('SELECT * FROM week_signs WHERE id = ?').get(id));
}

/* ---------- 月签 ---------- */
function monthSignJson(row) {
  return {
    id: String(row.id), deptId: String(row.dept_id), month: row.month,
    sign: { name: row.sign_name, title: row.sign_title, url: `/api/files/${row.sign_file_id}`,
      opinion: row.sign_opinion, at: row.sign_at },
    stat: { checked: row.stat_checked, ng: row.stat_ng, weeks: row.stat_weeks },
    at: row.sign_at
  };
}

function listMonthSigns({ deptIds, deptId, year }) {
  const db = getDb();
  const cond = []; const args = [];
  if (deptId != null) { cond.push('dept_id = ?'); args.push(+deptId); }
  else if (deptIds) { cond.push(`dept_id IN (${deptIds.map(() => '?').join(',') || 'NULL'})`); args.push(...deptIds); }
  if (year) { cond.push("month LIKE ? || '-%'"); args.push(String(year)); }
  return db.prepare(`SELECT * FROM month_signs ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY month, dept_id`)
    .all(...args).map(monthSignJson);
}

function deptMonthState(deptId, month, today) {
  const db = getDb();
  const weekSignWeeks = db.prepare('SELECT week_start FROM week_signs WHERE dept_id = ?').all(deptId).map(r => r.week_start);
  const rows = db.prepare('SELECT * FROM records WHERE dept_id = ? AND date >= ? AND date <= ?')
    .all(deptId, `${month}-01`, `${month}-31`);
  const items = loadItems(db, rows.map(r => r.id));
  const recs = rows.map(r => {
    const checks = {};
    for (const it of (items.get(r.id) || [])) checks[String(it.device_id)] = it.result;
    return { date: r.date, sign: !!r.sign_at, checks };
  });
  const ms = db.prepare('SELECT * FROM month_signs WHERE dept_id = ? AND month = ?').get(deptId, month) || null;
  return P.monthState({ month, today, weekSignWeeks, recs, ms });
}

function signMonth(user, deptId, month, body) {
  const db = getDb();
  deptId = +deptId;
  if (!MONTH_RE.test(String(month))) throw E.badInput('month 格式必须是 YYYY-MM');
  if (!db.prepare('SELECT 1 FROM depts WHERE id = ?').get(deptId)) throw E.notFound('科室不存在');
  assertSignBody(body);
  const today = P.today();
  if (month > P.moOf(today)) throw E.early('这个月还没开始，不能提前签字');
  const st = deptMonthState(deptId, month, today);
  if (st.locked) throw E.locked('本月已签字');
  if (!st.ready) throw E.notReady('该月仍有未完成周签的周');
  const f = fileSvc.saveSignature(body.dataUrl);
  const at = P.stamp();
  const id = db.prepare(`INSERT INTO month_signs (dept_id, month, sign_name, sign_title, sign_opinion,
    sign_file_id, stat_checked, stat_ng, stat_weeks, signed_by, sign_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(deptId, month, body.name.trim(), String(body.title || ''), String(body.opinion || ''),
      f.id, st.checked, st.ng, st.weeks.length, user.id, at).lastInsertRowid;
  return monthSignJson(db.prepare('SELECT * FROM month_signs WHERE id = ?').get(id));
}

module.exports = {
  recordJson, getRecord, getRecordRow, listRecords, putRecord, signRecord,
  listWeekSigns, signWeek, deptWeekState,
  listMonthSigns, signMonth, deptMonthState, loadItems
};
