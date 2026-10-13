'use strict';
/* =========================================================================
   周期归属与递进就绪判定
   日期工具与 H5 index.html 中的同名函数保持一致；weekState/monthState 的
   就绪规则以「业务规则」为准（不是以旧版 H5 为准——旧版本身就允许提前签），
   H5 端的同名函数必须与这里保持同一规则。数据由调用方查好传入、today 一律
   显式传参，保持纯函数便于单测。
   ========================================================================= */

const pad = n => String(n).padStart(2, '0');
const D = s => new Date(String(s).replace(/-/g, '/') + ' 00:00:00');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDay = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return fmt(d); };

/* 周以「周一日期」为标识，避免跨年周号问题 */
const wkOf = s => { const d = D(s); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return fmt(d); };
const wkDays = w => Array.from({ length: 7 }, (_, i) => addDay(w, i));
const moOf = s => s.slice(0, 7);
/* 某月包含的周（以周一归属月份计）。
   不传 today → 该月全部的周（月签就绪、周签进度分母用这个）；
   传 today   → 只返回已开始的周（周一 ≤ today）。 */
const wksOfMonth = (m, today) => {
  const out = []; let w = wkOf(m + '-01');
  if (moOf(w) !== m) w = addDay(w, 7);
  while (moOf(w) === m) { if (!today || w <= today) out.push(w); w = addDay(w, 7); }
  return out;
};
const prevMonth = m => { let y = +m.slice(0, 4), mm = +m.slice(5, 7) - 1; if (mm < 1) { mm = 12; y--; } return `${y}-${pad(mm)}`; };

/* ---------- 业务时钟：只按 Asia/Shanghai 计算，不依赖进程 TZ ---------- */
const SH_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false
});
function shNow() {
  const p = {};
  for (const it of SH_FMT.formatToParts(new Date())) p[it.type] = it.value;
  const hour = p.hour === '24' ? '00' : p.hour; // 部分 ICU 会输出 24:xx
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}` };
}
const today = () => shNow().date;
const stamp = () => { const n = shNow(); return `${n.date} ${n.time}`; };

/* ---------- 递进关系判定（H5 620-650 行移植） ---------- */
/* 日签是否完成 */
function dayDone(rec) { return !!(rec && rec.sign); }

/* 某周状态。周签前提：该周「周一到周日 7 天」全部完成日签。
   ⚠ 旧版只检查「今天及以前」的天：周一日签完当天就能签本周，违反「不可提前签」。
   未来的日期不能日签，所以 7 天齐了最早也是周日——不需要再单独判断"周是否结束"。
   recs: [{date, sign, checks}]（该科室该周范围内记录）；ws: 已存在的周签或 null
   返回里区分两种"没齐"：missDue = 已经到了却没日签（可以补签）；future = 还没到的天。 */
function weekState({ week, today: t, recs, ws }) {
  const days = wkDays(week);
  const map = new Map(recs.map(r => [r.date, r]));
  const signed = days.filter(d => { const r = map.get(d); return r && r.sign; });
  const miss = days.filter(d => !signed.includes(d));
  const future = days.filter(d => d > t);
  const missDue = miss.filter(d => d <= t);
  let checked = 0, ng = 0;
  recs.forEach(r => { const v = Object.values(r.checks || {}); checked += v.length; ng += v.filter(x => x === 'ng').length; });
  return { week, days, signed, miss, missDue, future, checked, ng, ws,
    started: week <= t, ended: addDay(week, 6) < t,
    ready: miss.length === 0, locked: !!ws };
}

/* 某月状态。月签前提：归属该月的「全部」周都已周签（周按周一所在月份归属）。
   ⚠ 旧版只要求「已开始的周」：月初签完第一周就能把整月签掉，而月签会锁定整月记录，
   导致当月后面的日子再也录不了巡检。
   weekSignWeeks: 该科室已周签的周一列表；recs: 该月 [m-01, m-31] 记录；ms: 已存在的月签或 null
   openWeeks = 周日还没到的周（本月还没结束）；missDue = 已经可以签却没周签的周。 */
function monthState({ month, today: t, weekSignWeeks, recs, ms }) {
  const wks = wksOfMonth(month);
  const signs = weekSignWeeks.filter(w => wks.includes(w));
  const miss = wks.filter(w => !signs.includes(w));
  const openWeeks = wks.filter(w => addDay(w, 6) > t);
  const missDue = miss.filter(w => addDay(w, 6) <= t);
  let checked = 0, ng = 0, dsign = 0;
  recs.forEach(r => { const v = Object.values(r.checks || {}); checked += v.length;
    ng += v.filter(x => x === 'ng').length; if (r.sign) dsign++; });
  return { month, weeks: wks, signedWeeks: signs.length, miss, missDue, openWeeks, checked, ng, dsign, ms,
    started: month <= moOf(t), ended: month < moOf(t),
    ready: wks.length > 0 && miss.length === 0, locked: !!ms };
}

module.exports = {
  pad, D, fmt, addDay, wkOf, wkDays, moOf, wksOfMonth, prevMonth,
  shNow, today, stamp, dayDone, weekState, monthState
};
