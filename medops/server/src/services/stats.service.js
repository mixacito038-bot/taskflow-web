'use strict';
const { getDb } = require('../db/connection');
const P = require('./period.service');

/* 数据范围：deptIds=null 表示全院。
   month 给定时（按月的统计），全院范围除了启用中的科室，还要带上「该月有巡检记录」的停用科室——
   停用而不删除就是为了保留历史；旧版只取启用科室，科室一停用，它过去几个月的完成率、
   签字工作量就整体从统计里消失了。 */
function scopedDepts(deptIds, month) {
  const db = getDb();
  if (deptIds == null) {
    if (!month) return db.prepare("SELECT * FROM depts WHERE status = 'on' ORDER BY sort, id").all();
    return db.prepare(`SELECT * FROM depts d WHERE d.status = 'on'
        OR EXISTS (SELECT 1 FROM records r WHERE r.dept_id = d.id AND r.date LIKE ? || '-%')
      ORDER BY d.sort, d.id`).all(month);
  }
  if (!deptIds.length) return [];
  const qs = deptIds.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM depts WHERE id IN (${qs}) ORDER BY sort, id`).all(...deptIds);
}

/* 科室从哪天开始算「应巡」：建科室那天；导入过更早的历史记录的，从最早一条记录算起。
   旧版不看起点：今天新建的科室，首页立刻多出「前 7 天未日签」7 条提醒。 */
function deptStart(d) {
  const first = getDb().prepare('SELECT MIN(date) AS d FROM records WHERE dept_id = ?').get(d.id).d;
  const created = P.shDateOf(d.created_at);
  return first && first < created ? first : created;
}
const inUseCount = deptId =>
  getDb().prepare("SELECT COUNT(*) AS c FROM devices WHERE dept_id = ? AND status = 'in_use'").get(deptId).c;

/* GET /api/stats/unsigned：最近 7 天未日签 / 上周及更早未周签 / 已结束但未月签的月 */
function unsigned(deptIds) {
  const db = getDb();
  const t = P.today();
  // 提醒只针对启用中的科室（停用科室不再有人巡检，提醒了也没人处理）
  const depts = scopedDepts(deptIds).filter(d => d.status === 'on');
  const days = [], weeks = [], months = [];
  const curWeek = P.wkOf(t);
  for (const d of depts) {
    const start = deptStart(d);
    // 日：最近 7 天、且在科室起算日之后；没有在用设备的科室无事可做，不提醒
    if (inUseCount(d.id) > 0) {
      for (let i = 1; i <= 7; i++) {
        const date = P.addDay(t, -i);
        if (date < start) break;
        const r = db.prepare('SELECT sign_at FROM records WHERE dept_id = ? AND date = ?').get(d.id, date);
        if (!r || !r.sign_at) days.push({ deptId: String(d.id), date });
      }
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
      /* 月：最后一周已经结束（可以月签了）、覆盖范围内有巡检记录、却还没月签的月。
         旧版只看「上个月」：8 月没签、到了 10 月，提醒里就再也看不到 8 月了。最多回溯 12 个月。 */
      const signedMo = new Set(db.prepare('SELECT month FROM month_signs WHERE dept_id = ?').all(d.id).map(r => r.month));
      let m = P.moOf(t);
      for (let i = 0; i < 12; i++) {
        m = P.prevMonth(m);
        const span = P.monthSpan(m);
        if (span.to < P.wkOf(first)) break;
        if (span.to >= t || signedMo.has(m)) continue;
        if (db.prepare('SELECT 1 FROM records WHERE dept_id = ? AND date >= ? AND date <= ? LIMIT 1').get(d.id, span.from, span.to)) {
          months.push({ deptId: String(d.id), month: m });
        }
      }
    }
  }
  months.sort((a, b) => a.month.localeCompare(b.month) || a.deptId - b.deptId);
  return { days, weeks, months };
}

/* GET /api/stats/completion?month=&deptId= */
function completion(deptIds, month, deptId) {
  const db = getDb();
  const t = P.today();
  let depts = scopedDepts(deptIds, month);
  if (deptId != null) depts = depts.filter(d => d.id === +deptId);
  /* 周签进度的分母 = 归属该月的全部周（与月签就绪条件一致）；
     旧版只算已开始的周，本月中途会显示 1/2 这种"看着快齐了"的假进度 */
  const wks = P.wksOfMonth(month);
  /* 应巡天数：该月内、科室起算日之后、≤今天 的天数（按科室分别算：月中新建的科室不该按整月算缺签） */
  const monthEnd = (() => { const d = P.D(`${month}-01`); d.setMonth(d.getMonth() + 1); d.setDate(0); return P.fmt(d); })();
  const dueOf = d => {
    let from = `${month}-01`; const to = monthEnd < t ? monthEnd : t;
    const st = deptStart(d); if (st > from) from = st;
    if (from > to) return 0;
    return Math.round((P.D(to) - P.D(from)) / 864e5) + 1;
  };
  return depts.map(d => {
    const dueDays = dueOf(d);
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
      deptId: String(d.id), deptName: d.name, deptStatus: d.status,
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
  const depts = scopedDepts(deptIds, month);
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
