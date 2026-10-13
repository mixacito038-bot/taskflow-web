'use strict';
/* period.service 与 H5 算法对拍单测（node:test）
   所有断言都传显式 today，不依赖系统当前时间 */
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/services/period.service');

test('wkOf：周归属 = 所在周的周一', () => {
  assert.equal(P.wkOf('2026-08-04'), '2026-08-03'); // 周二
  assert.equal(P.wkOf('2026-08-03'), '2026-08-03'); // 周一本身
  assert.equal(P.wkOf('2026-08-09'), '2026-08-03'); // 周日归上周一
});

test('跨年周：2025-12-29(周一) 覆盖 2025→2026 跨年', () => {
  assert.equal(P.wkOf('2025-12-29'), '2025-12-29');
  assert.equal(P.wkOf('2025-12-31'), '2025-12-29');
  assert.equal(P.wkOf('2026-01-01'), '2025-12-29'); // 元旦归 2025 的最后一周
  assert.equal(P.wkOf('2026-01-04'), '2025-12-29'); // 周日仍归该周
  assert.equal(P.wkOf('2026-01-05'), '2026-01-05'); // 新年第一个周一
  assert.deepEqual(P.wkDays('2025-12-29'),
    ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  // 12-29 那周周一在 12 月 → 属 2025-12；2026-01 的第一周是 01-05
  assert.deepEqual(P.wksOfMonth('2025-12', '2026-02-01'),
    ['2025-12-01', '2025-12-08', '2025-12-15', '2025-12-22', '2025-12-29']);
  assert.deepEqual(P.wksOfMonth('2026-01', '2026-02-01'),
    ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
});

test('月首日是周日：2026-03-01(周日) 归 2 月最后一周', () => {
  assert.equal(P.wkOf('2026-03-01'), '2026-02-23');
  assert.deepEqual(P.wksOfMonth('2026-03', '2026-04-10'),
    ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30']);
  // 2026-02-23 那周属 2 月
  assert.ok(P.wksOfMonth('2026-02', '2026-04-10').includes('2026-02-23'));
});

test('2 月：平年/闰年', () => {
  // 2027-02-01 是周一
  assert.deepEqual(P.wksOfMonth('2027-02', '2027-03-10'),
    ['2027-02-01', '2027-02-08', '2027-02-15', '2027-02-22']);
  // 2024 闰年：02-29 存在且归 02-26 那周
  assert.equal(P.addDay('2024-02-28', 1), '2024-02-29');
  assert.equal(P.addDay('2024-02-29', 1), '2024-03-01');
  assert.equal(P.wkOf('2024-02-29'), '2024-02-26');
  assert.deepEqual(P.wksOfMonth('2024-02', '2024-03-10'),
    ['2024-02-05', '2024-02-12', '2024-02-19', '2024-02-26']);
});

test('wksOfMonth：传 today 只含已开始的周；不传则返回全月的周', () => {
  assert.deepEqual(P.wksOfMonth('2026-08', '2026-08-01'), []); // 首个周一 08-03 还没到
  assert.deepEqual(P.wksOfMonth('2026-08', '2026-08-03'), ['2026-08-03']);
  assert.deepEqual(P.wksOfMonth('2026-08', '2026-08-04'), ['2026-08-03']);
  assert.deepEqual(P.wksOfMonth('2026-08', '2026-08-16'), ['2026-08-03', '2026-08-10']);
  const all = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'];
  assert.deepEqual(P.wksOfMonth('2026-08', '2026-09-15'), all);
  assert.deepEqual(P.wksOfMonth('2026-08'), all);              // 不传 today：全月 5 周
  assert.deepEqual(P.wksOfMonth('2026-10'),                     // 10-01 是周四，归 9 月最后一周
    ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
});

test('prevMonth：跨年回退', () => {
  assert.equal(P.prevMonth('2026-01'), '2025-12');
  assert.equal(P.prevMonth('2026-08'), '2026-07');
});

test('dayDone：sign 非空才算完成', () => {
  assert.equal(P.dayDone(null), false);
  assert.equal(P.dayDone({ sign: null }), false);
  assert.equal(P.dayDone({ sign: { name: '张三' } }), true);
});

/* ---------- 业务规则：周签前提 = 周一到周日 7 天全部日签（不可提前签） ---------- */
const rec = (date, sign, checks = { 1: 'ok', 2: 'ng' }) => ({ date, sign, checks });
const allSigned = week => P.wkDays(week).map(d => rec(d, true));

test('规则：周一只签了当天，不能周签本周（用户截图里的 bug）', () => {
  const st = P.weekState({ week: '2026-10-12', today: '2026-10-12', recs: [rec('2026-10-12', true)], ws: null });
  assert.equal(st.ready, false);
  assert.equal(st.days.length, 7);
  assert.deepEqual(st.signed, ['2026-10-12']);
  assert.equal(st.missDue.length, 0);           // 已到的天都签了……
  assert.equal(st.future.length, 6);            // ……但还有 6 天没到
});

test('规则：周中已到的天全签了也不行，必须 7 天齐', () => {
  const recs = ['2026-08-03', '2026-08-04', '2026-08-05'].map(d => rec(d, true));
  const st = P.weekState({ week: '2026-08-03', today: '2026-08-05', recs, ws: null });
  assert.equal(st.ready, false);
  assert.deepEqual(st.future, ['2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']);
});

test('规则：周日签完第 7 天，当天就可以周签', () => {
  const st = P.weekState({ week: '2026-08-03', today: '2026-08-09', recs: allSigned('2026-08-03'), ws: null });
  assert.equal(st.ready, true);
  assert.equal(st.future.length, 0);
  assert.equal(st.signed.length, 7);
});

test('规则：周已结束但中间漏签一天 → 不能周签，missDue 指出漏的是哪天（可补签）', () => {
  const recs = allSigned('2026-08-03').filter(r => r.date !== '2026-08-05');
  const st = P.weekState({ week: '2026-08-03', today: '2026-08-12', recs, ws: null });
  assert.equal(st.ready, false);
  assert.deepEqual(st.missDue, ['2026-08-05']);
  assert.deepEqual(st.future, []);
  assert.equal(st.ended, true);
});

test('规则：有巡检记录但没日签的天不算完成', () => {
  const recs = allSigned('2026-08-03').map(r => r.date === '2026-08-09' ? rec(r.date, false) : r);
  const st = P.weekState({ week: '2026-08-03', today: '2026-08-12', recs, ws: null });
  assert.equal(st.ready, false);
  assert.deepEqual(st.missDue, ['2026-08-09']);
});

test('weekState：统计、未开始的周、已周签锁定', () => {
  let st = P.weekState({ week: '2026-08-03', today: '2026-08-12', recs: allSigned('2026-08-03'), ws: null });
  assert.equal(st.checked, 14);
  assert.equal(st.ng, 7);
  st = P.weekState({ week: '2026-08-10', today: '2026-08-04', recs: [], ws: null });
  assert.equal(st.started, false);
  assert.equal(st.ready, false);
  assert.equal(st.future.length, 7);
  st = P.weekState({ week: '2026-08-03', today: '2026-08-20', recs: [], ws: { id: 1 } });
  assert.equal(st.locked, true);
  assert.equal(st.ended, true);
});

test('weekState：跨年周（2025-12-29 起）在新年期间仍按整周 7 天判断', () => {
  const st = P.weekState({ week: '2025-12-29', today: '2026-01-02', recs: [], ws: null });
  assert.equal(st.days.length, 7);
  assert.deepEqual(st.missDue, ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
  assert.deepEqual(st.future, ['2026-01-03', '2026-01-04']);
});

/* ---------- 业务规则：月签前提 = 归属该月的全部周都已周签 ---------- */
test('规则：月初只签了第一周，不能月签（旧版会放行，并锁死整月记录）', () => {
  const st = P.monthState({ month: '2026-10', today: '2026-10-12',
    weekSignWeeks: ['2026-10-05', '2026-10-12'], recs: [], ms: null });
  assert.equal(st.ready, false);
  assert.deepEqual(st.weeks, ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  assert.deepEqual(st.miss, ['2026-10-19', '2026-10-26']);
  assert.deepEqual(st.openWeeks, ['2026-10-12', '2026-10-19', '2026-10-26']);
  assert.deepEqual(st.missDue, []);
});

test('规则：月签要等最后一周（可能跨到下个月）周签完成', () => {
  const all = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']; // 最后一周到 09-06
  let st = P.monthState({ month: '2026-08', today: '2026-09-03', weekSignWeeks: all.slice(0, 4), recs: [], ms: null });
  assert.equal(st.ready, false);
  assert.deepEqual(st.openWeeks, ['2026-08-31']);
  st = P.monthState({ month: '2026-08', today: '2026-09-06', weekSignWeeks: all, recs: [], ms: null });
  assert.equal(st.ready, true);
  assert.deepEqual(st.openWeeks, []);
});

test('规则：月已结束但漏了一周周签 → 不能月签，missDue 指出是哪周', () => {
  const all = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'];
  const st = P.monthState({ month: '2026-07', today: '2026-08-12',
    weekSignWeeks: all.filter(w => w !== '2026-07-13'), recs: [], ms: null });
  assert.equal(st.ready, false);
  assert.deepEqual(st.missDue, ['2026-07-13']);
});

test('monthState：全部周签齐 → ready；统计；已月签锁定；其它月份的周签不计入', () => {
  const month = '2026-07';
  const allWeeks = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'];
  let st = P.monthState({ month, today: '2026-08-04', weekSignWeeks: ['2026-06-29', ...allWeeks, '2026-08-03'],
    recs: [{ date: '2026-07-06', sign: true, checks: { 1: 'ok' } }, { date: '2026-07-07', sign: false, checks: { 1: 'ng' } }], ms: null });
  assert.equal(st.ready, true);
  assert.equal(st.signedWeeks, 4);
  assert.equal(st.checked, 2);
  assert.equal(st.ng, 1);
  assert.equal(st.dsign, 1);
  assert.equal(st.ended, true);
  st = P.monthState({ month, today: '2026-08-04', weekSignWeeks: allWeeks, recs: [], ms: { id: 9 } });
  assert.equal(st.locked, true);
});

test('月锁归属：一天归哪个月的月签管，看它所在的周归哪个月（不是看日期本身的月份）', () => {
  // 2026-08-01（周六）、08-02（周日）属于 07-27 那一周 → 归 7 月
  assert.equal(P.signMonthOf('2026-08-01'), '2026-07');
  assert.equal(P.signMonthOf('2026-08-02'), '2026-07');
  assert.equal(P.signMonthOf('2026-08-03'), '2026-08');
  // 2026-09-01～09-06 属于 08-31 那一周 → 归 8 月
  assert.equal(P.signMonthOf('2026-09-01'), '2026-08');
  assert.equal(P.signMonthOf('2026-09-06'), '2026-08');
  assert.equal(P.signMonthOf('2026-09-07'), '2026-09');
  // 跨年：2026-01-01～01-04 属于 2025-12-29 那一周 → 归 2025-12
  assert.equal(P.signMonthOf('2026-01-02'), '2025-12');
  // 与 wksOfMonth 一致：任何一天都恰好落在它所属月份的某一周里
  for (let d = '2025-11-20'; d <= '2027-02-10'; d = P.addDay(d, 1)) {
    assert.ok(P.wksOfMonth(P.signMonthOf(d)).includes(P.wkOf(d)), d);
  }
});

test('月签覆盖范围 monthSpan：第一周周一 ～ 最后一周周日，首尾可跨月', () => {
  assert.deepEqual(P.monthSpan('2026-08'), { from: '2026-08-03', to: '2026-09-06' });
  assert.deepEqual(P.monthSpan('2026-07'), { from: '2026-07-06', to: '2026-08-02' });
  assert.deepEqual(P.monthSpan('2026-02'), { from: '2026-02-02', to: '2026-03-01' });
  assert.deepEqual(P.monthSpan('2025-12'), { from: '2025-12-01', to: '2026-01-04' });
  // 相邻两个月的覆盖范围首尾相接、不重叠、不留缝
  for (let m = '2027-06'; m > '2025-01'; m = P.prevMonth(m)) {
    const prev = P.prevMonth(m);
    assert.equal(P.addDay(P.monthSpan(prev).to, 1), P.monthSpan(m).from, `${prev} → ${m}`);
  }
});

test('isMonth：只接受 01–12 月', () => {
  for (const ok of ['2026-01', '2026-09', '2026-12']) assert.equal(P.isMonth(ok), true, ok);
  for (const bad of ['2026-00', '2026-13', '2026-1', '26-01', '2026/01', '', null, undefined]) assert.equal(P.isMonth(bad), false, String(bad));
});

test('shDateOf：UTC 时刻换算成上海日期；上海日期 → UTC 区间', () => {
  assert.equal(P.shDateOf('2026-10-12T15:59:59.000Z'), '2026-10-12');
  assert.equal(P.shDateOf('2026-10-12T16:00:00.000Z'), '2026-10-13'); // 上海 10-13 00:00
  assert.equal(P.shDayStartIso('2026-10-13'), '2026-10-12T16:00:00.000Z');
  assert.equal(P.shDayEndIso('2026-10-13'), '2026-10-13T15:59:59.999Z');
});
