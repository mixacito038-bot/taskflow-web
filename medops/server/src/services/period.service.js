'use strict';
/* =========================================================================
   周期归属与递进就绪判定
   日期工具与 H5 index.html 353-389 行逐行对齐；
   dayDone/weekState/monthState 与 H5 620-650 行逐行对齐（数据由调用方
   查好传入、today 一律显式传参，保持纯函数便于单测对拍）。
   ========================================================================= */

const pad = n => String(n).padStart(2, '0');
const D = s => new Date(String(s).replace(/-/g, '/') + ' 00:00:00');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDay = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return fmt(d); };

/* 周以「周一日期」为标识，避免跨年周号问题 */
const wkOf = s => { const d = D(s); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return fmt(d); };
const wkDays = w => Array.from({ length: 7 }, (_, i) => addDay(w, i));
const moOf = s => s.slice(0, 7);
/* 某月包含的周（以周一归属月份计），仅返回已开始的 */
const wksOfMonth = (m, today) => {
  const out = []; let w = wkOf(m + '-01');
  if (moOf(w) !== m) w = addDay(w, 7);
  while (moOf(w) === m) { if (w <= today) out.push(w); w = addDay(w, 7); }
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

/* 某周状态：需要该周所有「已过去的日期」都完成日签
   recs: [{date, sign, checks}]（该科室该周范围内记录）；ws: 已存在的周签或 null */
function weekState({ week, today: t, recs, ws }) {
  const days = wkDays(week).filter(d => d <= t);
  const map = new Map(recs.map(r => [r.date, r]));
  const signed = days.filter(d => { const r = map.get(d); return r && r.sign; });
  const miss = days.filter(d => !signed.includes(d));
  let checked = 0, ng = 0;
  recs.forEach(r => { const v = Object.values(r.checks || {}); checked += v.length; ng += v.filter(x => x === 'ng').length; });
  return { week, days, signed, miss, checked, ng, ws,
    started: week <= t, ended: addDay(week, 6) < t,
    ready: days.length > 0 && miss.length === 0, locked: !!ws };
}

/* 某月状态：需要该月所有「已开始的周」都完成周签
   weekSignWeeks: 该科室已周签的周一列表；recs: 该月 [m-01, m-31] 记录；ms: 已存在的月签或 null */
function monthState({ month, today: t, weekSignWeeks, recs, ms }) {
  const wks = wksOfMonth(month, t);
  const signs = weekSignWeeks.filter(w => wks.includes(w));
  const miss = wks.filter(w => !signs.includes(w));
  let checked = 0, ng = 0, dsign = 0;
  recs.forEach(r => { const v = Object.values(r.checks || {}); checked += v.length;
    ng += v.filter(x => x === 'ng').length; if (r.sign) dsign++; });
  return { month, weeks: wks, signedWeeks: signs.length, miss, checked, ng, dsign, ms,
    started: month <= moOf(t), ended: month < moOf(t),
    ready: wks.length > 0 && miss.length === 0, locked: !!ms };
}

module.exports = {
  pad, D, fmt, addDay, wkOf, wkDays, moOf, wksOfMonth, prevMonth,
  shNow, today, stamp, dayDone, weekState, monthState
};
