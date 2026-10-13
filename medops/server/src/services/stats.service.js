'use strict';
const { getDb } = require('../db/connection');
const P = require('./period.service');

/* 数据范围：deptIds=null 表示全院 */
function scopedDepts(deptIds) {
  const db = getDb();
  if (deptIds == null) return db.prepare("SELECT * FROM depts WHERE status = 'on' ORDER BY sort, id").all();
  if (!deptIds.length) return [];
  const qs = deptIds.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM depts WHERE id IN (${qs}) ORDER BY sort, id`).all(...deptIds);
}

/* GET /api/stats/unsigned：最近 7 天未日签 / 上周及更早未周签 / 上月未月签 */
function unsigned(deptIds) {
  const db = getDb();
  const t = P.today();
  const depts = scopedDepts(deptIds);
  const days = [], weeks = [], months = [];
  const curWeek = P.wkOf(t);
  const prevMo = P.prevMonth(P.moOf(t));
  for (const d of depts) {
    for (let i = 1; i <= 7; i++) {
      const date = P.addDay(t, -i);
      const r = db.prepare('SELECT sign_at FROM records WHERE dept_id = ? AND date = ?').get(d.id, date);
      if (!r || !r.sign_at) days.push({ deptId: String(d.id), date });
    }
    // 周：自该科室最早记录所在周起（最多回溯 12 周），到上周为止，缺周签的
    const first = db.prepare('SELECT MIN(date) AS d FROM records WHERE dept_id = ?').get(d.id).d;
    if (first) {
      let w = P.wkOf(first);
      const floor = P.addDay(curWeek, -7 * 12);
      if (w < floor) w = floor;
      const signed = new Set(db.prepare('SELECT week_start FROM week_signs WHERE dept_id = ?').all(d.id).map(r => r.week_start));
      while (w < curWeek) {
        if (!signed.has(w)) weeks.push({ deptId: String(d.id), week: w });
        w = P.addDay(w, 7);
      }
    }
    // 月：上月有巡检记录但未月签的
    const hasRec = db.prepare("SELECT 1 FROM records WHERE dept_id = ? AND date LIKE ? || '-%' LIMIT 1").get(d.id, prevMo);
    if (hasRec && !db.prepare('SELECT 1 FROM month_signs WHERE dept_id = ? AND month = ?').get(d.id, prevMo)) {
      months.push({ deptId: String(d.id), month: prevMo });
    }
  }
  return { days, weeks, months };
}

/* GET /api/stats/completion?month=&deptId= */
function completion(deptIds, month, deptId) {
  const db = getDb();
  const t = P.today();
  let depts = scopedDepts(deptIds);
  if (deptId != null) depts = depts.filter(d => d.id === +deptId);
  /* 周签进度的分母 = 归属该月的全部周（与月签就绪条件一致）；
     旧版只算已开始的周，本月中途会显示 1/2 这种"看着快齐了"的假进度 */
  const wks = P.wksOfMonth(month);
  // 应巡天数：该月内 ≤今天 的天数
  const last = +P.addDay(P.moOf(t) === month ? t : `${month}-01`, 0).slice(8, 10);
  let dueDays = 0;
  if (month < P.moOf(t)) { // 已结束的月：整月天数
    const d = P.D(`${month}-01`); d.setMonth(d.getMonth() + 1); d.setDate(0);
    dueDays = d.getDate();
  } else if (month === P.moOf(t)) dueDays = last;
  return depts.map(d => {
    const rows = db.prepare("SELECT * FROM records WHERE dept_id = ? AND date LIKE ? || '-%'").all(d.id, month);
    const signedDays = rows.filter(r => r.sign_at).length;
    let checked = 0, ng = 0;
    if (rows.length) {
      const qs = rows.map(() => '?').join(',');
      const its = db.prepare(`SELECT result, COUNT(*) AS c FROM record_items WHERE record_id IN (${qs}) GROUP BY result`)
        .all(...rows.map(r => r.id));
      for (const it of its) { checked += it.c; if (it.result === 'ng') ng = it.c; }
    }
    const weekSigned = wks.filter(w =>
      db.prepare('SELECT 1 FROM week_signs WHERE dept_id = ? AND week_start = ?').get(d.id, w)).length;
    const monthSigned = !!db.prepare('SELECT 1 FROM month_signs WHERE dept_id = ? AND month = ?').get(d.id, month);
    return {
      deptId: String(d.id), deptName: d.name,
      dueDays, signedDays, checked, ng,
      weekSigned, weekTotal: wks.length, monthSigned
    };
  });
}

/* GET /api/stats/ng?from=&to=&deptId= —— 异常明细 */
function ngList(deptIds, { from, to, deptId }) {
  const db = getDb();
  const cond = ["ri.result = 'ng'"]; const args = [];
  if (deptId != null) { cond.push('r.dept_id = ?'); args.push(+deptId); }
  else if (deptIds) { cond.push(`r.dept_id IN (${deptIds.map(() => '?').join(',') || 'NULL'})`); args.push(...deptIds); }
  if (from) { cond.push('r.date >= ?'); args.push(from); }
  if (to) { cond.push('r.date <= ?'); args.push(to); }
  return db.prepare(`
    SELECT r.date, r.dept_id, dp.name AS dept_name, dv.code, dv.name AS dev_name, dv.cat_name,
           ri.note, COALESCE(iu.display_name, r.inspector_name) AS inspector_name
    FROM record_items ri
    JOIN records r ON r.id = ri.record_id
    JOIN devices dv ON dv.id = ri.device_id
    JOIN depts dp ON dp.id = r.dept_id
    LEFT JOIN users iu ON iu.id = r.inspector_id
    WHERE ${cond.join(' AND ')}
    ORDER BY r.date, r.dept_id, dv.code`).all(...args)
    .map(x => ({
      date: x.date, deptId: String(x.dept_id), deptName: x.dept_name,
      deviceCode: x.code, deviceName: x.dev_name, catName: x.cat_name,
      note: x.note, inspectorName: x.inspector_name || ''
    }));
}

/* GET /api/stats/signatures?month= —— 各科室签字人 × 日/周/月签次数
   按「人」聚合（账号 ID / 签字人名单 ID），显示当前名字；改名后不会被拆成两行。
   关联不上的历史签字（对象已删除）按签字当时的姓名单独成行。 */
function signatures(deptIds, month) {
  const db = getDb();
  const depts = scopedDepts(deptIds);
  const out = [];
  for (const d of depts) {
    const acc = new Map(); // key → {name, title, day, week, month}
    const bump = (key, name, title, kind) => {
      if (!name) return;
      if (!acc.has(key)) acc.set(key, { name, title: title || '', day: 0, week: 0, month: 0 });
      acc.get(key)[kind]++;
    };
    for (const r of db.prepare(`SELECT r.sign_user_id AS uid, COALESCE(u.display_name, r.sign_name) AS name, r.sign_title AS title
        FROM records r LEFT JOIN users u ON u.id = r.sign_user_id
        WHERE r.dept_id = ? AND r.sign_at IS NOT NULL AND r.date LIKE ? || '-%'`).all(d.id, month)) {
      bump(r.uid != null ? `u${r.uid}` : `n:${r.name}`, r.name, r.title, 'day');
    }
    for (const r of db.prepare(`SELECT w.sign_member_id AS mid, COALESCE(m.name, w.sign_name) AS name,
        CASE WHEN m.id IS NULL THEN w.sign_title ELSE m.title END AS title
        FROM week_signs w LEFT JOIN members m ON m.id = w.sign_member_id
        WHERE w.dept_id = ? AND w.week_start LIKE ? || '-%'`).all(d.id, month)) {
      bump(r.mid != null ? `m${r.mid}` : `n:${r.name}`, r.name, r.title, 'week');
    }
    for (const r of db.prepare(`SELECT ms.signed_by AS uid, COALESCE(u.display_name, ms.sign_name) AS name, ms.sign_title AS title
        FROM month_signs ms LEFT JOIN users u ON u.id = ms.signed_by
        WHERE ms.dept_id = ? AND ms.month = ?`).all(d.id, month)) {
      bump(r.uid != null ? `u${r.uid}` : `n:${r.name}`, r.name, r.title, 'month');
    }
    for (const v of acc.values()) {
      out.push({ deptId: String(d.id), deptName: d.name, name: v.name, title: v.title,
        daySigns: v.day, weekSigns: v.week, monthSigns: v.month });
    }
  }
  return out;
}

module.exports = { unsigned, completion, ngList, signatures, scopedDepts };
