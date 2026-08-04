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

test('wksOfMonth 只含已开始的周（周一 ≤ today）', () => {
  assert.deepEqual(P.wksOfMonth('2026-08', '2026-08-01'), []); // 首个周一 08-03 还没到
  assert.deepEqual(P.wksOfMonth('2026-08', '2026-08-03'), ['2026-08-03']);
  assert.deepEqual(P.wksOfMonth('2026-08', '2026-08-04'), ['2026-08-03']);
  assert.deepEqual(P.wksOfMonth('2026-08', '2026-08-16'), ['2026-08-03', '2026-08-10']);
  assert.deepEqual(P.wksOfMonth('2026-08', '2026-09-15'),
    ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']);
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

test('weekState：所有已过去日期都已日签才 ready', () => {
  const week = '2026-08-03';
  const rec = (date, sign) => ({ date, sign, checks: { 1: 'ok', 2: 'ng' } });
  // 周中（today=周二）：只签了周一 → 缺周二
  let st = P.weekState({ week, today: '2026-08-04', recs: [rec('2026-08-03', true)], ws: null });
  assert.deepEqual(st.days, ['2026-08-03', '2026-08-04']);
  assert.deepEqual(st.miss, ['2026-08-04']);
  assert.equal(st.ready, false);
  assert.equal(st.started, true);
  assert.equal(st.ended, false);
  // 周一、周二都签 → ready；统计正确
  st = P.weekState({ week, today: '2026-08-04',
    recs: [rec('2026-08-03', true), rec('2026-08-04', true)], ws: null });
  assert.equal(st.ready, true);
  assert.equal(st.checked, 4);
  assert.equal(st.ng, 2);
  // 有记录但未签 → 不 ready（sign 才算）
  st = P.weekState({ week, today: '2026-08-04',
    recs: [rec('2026-08-03', true), rec('2026-08-04', false)], ws: null });
  assert.equal(st.ready, false);
  // 未开始的周
  st = P.weekState({ week: '2026-08-10', today: '2026-08-04', recs: [], ws: null });
  assert.equal(st.started, false);
  assert.equal(st.ready, false); // days 为空 → 不 ready
  // 已周签 → locked
  st = P.weekState({ week, today: '2026-08-20', recs: [], ws: { id: 1 } });
  assert.equal(st.locked, true);
  assert.equal(st.ended, true);
});

test('weekState：跨年周在 today 位于新年时天数正确', () => {
  const st = P.weekState({ week: '2025-12-29', today: '2026-01-02', recs: [], ws: null });
  assert.deepEqual(st.days, ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
  assert.deepEqual(st.miss, st.days);
});

test('monthState：所有已开始的周都周签才 ready', () => {
  const month = '2026-07'; // 周：07-06/13/20/27
  const allWeeks = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'];
  let st = P.monthState({ month, today: '2026-08-04', weekSignWeeks: allWeeks.slice(0, 3), recs: [], ms: null });
  assert.deepEqual(st.weeks, allWeeks);
  assert.deepEqual(st.miss, ['2026-07-27']);
  assert.equal(st.ready, false);
  st = P.monthState({ month, today: '2026-08-04', weekSignWeeks: allWeeks,
    recs: [{ date: '2026-07-06', sign: true, checks: { 1: 'ok' } }, { date: '2026-07-07', sign: false, checks: { 1: 'ng' } }], ms: null });
  assert.equal(st.ready, true);
  assert.equal(st.checked, 2);
  assert.equal(st.ng, 1);
  assert.equal(st.dsign, 1);
  assert.equal(st.ended, true);
  // 该月尚无已开始的周 → 不 ready（wks 为空）
  st = P.monthState({ month: '2026-08', today: '2026-08-01', weekSignWeeks: [], recs: [], ms: null });
  assert.deepEqual(st.weeks, []);
  assert.equal(st.ready, false);
  assert.equal(st.started, true);
  // 月中：只有已开始的周计入
  st = P.monthState({ month: '2026-08', today: '2026-08-04', weekSignWeeks: ['2026-08-03'], recs: [], ms: null });
  assert.deepEqual(st.weeks, ['2026-08-03']);
  assert.equal(st.ready, true);
  // 已月签 → locked
  st = P.monthState({ month, today: '2026-08-04', weekSignWeeks: allWeeks, recs: [], ms: { id: 9 } });
  assert.equal(st.locked, true);
});
