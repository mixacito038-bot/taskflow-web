'use strict';
/* 资产盘点还原：模拟「电脑 A 正常录入 → 电脑 B 登录时选了使用本机数据，整份覆盖 → 还原」 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initDb, getDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ams-restore-'));
initDb(dir);
migrate(getDb());
const ams = require('../src/services/ams.service');
const R = require('../src/services/ams-restore.service');
const db = getDb();
db.prepare("INSERT INTO users (id, username, password_hash, display_name, role, created_at, updated_at) VALUES (1, 'admin', 'x', '管理员', 'admin', 'x', 'x')").run();

/* 时间可控：每次推送前把「现在」拨到指定时刻 */
const realNow = Date.now;
function at(iso, fn) {
  const t = Date.parse(iso);
  const RealDate = Date;
  global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } };
  try { return fn(); } finally { global.Date = RealDate; Date.now = realNow; }
}
const ver = k => (db.prepare('SELECT version FROM ams_kv WHERE key = ?').get(k) || {}).version || 0;
const push = (dev, kv) => ams.push({ id: 1 }, { deviceId: dev, changes: Object.entries(kv).map(([key, value]) => ({ key, value, baseVersion: ver(key) })) });
const val = k => (db.prepare('SELECT value FROM ams_kv WHERE key = ?').get(k) || {}).value;
const arr = n => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: 'a' + i })));

test('找出误覆盖那次，还原到它之前；还原本身可撤销', () => {
  // 电脑 A：首次上传 + 几次正常录入
  at('2026-11-01T01:00:00.000Z', () => push('dev-A', { 'ams:assets': arr(200), 'ams:sites': arr(18), 'ams:movements': arr(300), 'ams:changelog': arr(10) }));
  at('2026-11-03T02:00:00.000Z', () => push('dev-A', { 'ams:assets': arr(219), 'ams:movements': arr(320) }));
  at('2026-11-04T06:00:00.000Z', () => push('dev-A', { 'ams:assets': arr(220), 'ams:movements': arr(340), 'ams:changelog': arr(12) }));
  const good = { assets: val('ams:assets'), sites: val('ams:sites'), movements: val('ams:movements'), changelog: val('ams:changelog') };
  // 电脑 B：本机是很久以前的数据，选了「使用本机数据」——整份推上来，云端多出的 key 删掉
  at('2026-11-04T09:42:10.000Z', () => push('dev-B', { 'ams:assets': arr(12), 'ams:sites': arr(3), 'ams:movements': arr(5), 'ams:inventories': arr(1), 'ams:changelog': null }));
  // 之后 B 上又改了一笔
  at('2026-11-04T09:50:00.000Z', () => push('dev-B', { 'ams:assets': arr(13) }));

  const evs = R.listEvents();
  assert.equal(evs.length, 5, '5 次改动');
  const sus = R.suspectIndex(evs);
  assert.equal(sus, 3, '最像误操作的是 B 那次整份覆盖（一次改了 5 份、电脑台账 220 → 12）');
  assert.equal(evs[sus].dev, 'dev-B');
  assert.deepEqual(evs[sus].keys.sort(), ['ams:assets', 'ams:changelog', 'ams:inventories', 'ams:movements', 'ams:sites']);

  const p = R.plan(sus);
  assert.equal(p.later, 1, '之后还有 1 次改动会一起撤销');
  assert.deepEqual(p.summary.find(s => s.key === 'ams:assets'), { key: 'ams:assets', label: '电脑台账', now: 13, restored: 220 });
  assert.equal(p.unknown.length, 0);
  // 只读：plan 不改数据
  assert.equal(R.countOf(val('ams:assets')), 13);

  const seqBefore = db.prepare('SELECT n FROM ams_seq').get().n;
  const r = at('2026-11-04T10:00:00.000Z', () => R.apply(sus));
  assert.equal(r.written, 5, '电脑台账、部门、流转、变更日志恢复，B 带来的盘点任务删掉');
  assert.deepEqual({ assets: val('ams:assets'), sites: val('ams:sites'), movements: val('ams:movements'), changelog: val('ams:changelog') }, good, '和覆盖前一字不差');
  assert.equal(val('ams:inventories'), null, '覆盖前没有的 key 删掉');
  assert.ok(db.prepare('SELECT n FROM ams_seq').get().n > seqBefore, '全局游标前进：各电脑的增量拉取能拉到');
  const snap = ams.snapshot();
  assert.equal(R.countOf(snap.keys['ams:assets'].value), 220);
  assert.ok(!('ams:inventories' in snap.keys));
  const changes = ams.changes(seqBefore);
  assert.ok(changes.keys['ams:assets'] && changes.keys['ams:inventories'].value === null, '增量里带着还原后的值和删除');
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'ams_restore'").get(), '记审计');

  // 再看改动列表：最新一次是「服务器上的还原操作」，不会被当成误操作
  const evs2 = R.listEvents();
  assert.ok(R.isRestore(evs2[evs2.length - 1].dev));
  assert.equal(R.suspectIndex(evs2), 3, '还原操作本身不算嫌疑');
  // 撤销还原：还原到「还原那一次」之前 = 回到 13 台
  at('2026-11-04T10:05:00.000Z', () => R.apply(evs2.length - 1));
  assert.equal(R.countOf(val('ams:assets')), 13);
  assert.equal(R.countOf(val('ams:inventories')), 1);
});

test('超出 20 版历史的 key 不乱改；没有改动时什么都不写', () => {
  for (let i = 0; i < 25; i++) at(`2026-12-01T0${Math.floor(i / 10)}:${String(i % 10).padStart(2, '0')}:00.000Z`, () => push('dev-C', { 'ams:tags': arr(i) }));
  const evs = R.listEvents();
  const first = evs.findIndex(e => e.keys.includes('ams:tags'));
  const p = R.plan(first); // 第一次写 tags 之前：tags 当时不存在，但最早的版本已被挤出历史
  assert.ok(p.unknown.includes('ams:tags'), '认不出那时的样子 → 不动');
  assert.ok(!p.changes.some(c => c.key === 'ams:tags'));
  const last = evs.length - 1;
  const p2 = R.plan(last);
  assert.deepEqual(p2.changes.map(c => c.key), ['ams:tags'], '只改动过 tags');
});

test('保留之后的改动：覆盖前的找回来，覆盖之后新加、新改、删掉的照样算数', () => {
  const A = (id, extra = {}) => ({ id, code: 'ZC-' + id, holder: '', purchaseDate: '2023-04-28', ...extra });
  // 覆盖前：a1..a6
  const before = [A('a1'), A('a2', { holder: '张三' }), A('a3'), A('a4'), A('a5'), A('a6')];
  // 覆盖成（旧电脑上的老数据）：a1、a2（旧的使用人）、a3，另有一台旧数据里才有的 x9；a4..a6 没了
  const after = [A('a1'), A('a2', { holder: '李四' }), A('a3'), A('x9')];
  // 覆盖之后：新加 n1；a1 改了位置；a3 删掉；x9 有人改过（留着）；又补录了一台 a5（新 id 同编号）
  const now = [A('n1'), A('a1', { location: '908' }), A('a2', { holder: '李四' }), A('x9', { holder: '王五' }), A('n5', { code: 'ZC-a5' })];
  const r = R.mergeValues(JSON.stringify(after), JSON.stringify(before), JSON.stringify(now));
  const got = JSON.parse(r.value);
  const byId = Object.fromEntries(got.map(x => [x.id, x]));
  assert.deepEqual(Object.keys(byId).sort(), ['a1', 'a2', 'a4', 'a5', 'a6', 'n1', 'n5', 'x9'], '找回 a4..a6；保留 n1、n5、改过的 x9；a3 照删');
  assert.equal(byId.a1.location, '908', '之后改的字段保留');
  assert.equal(byId.a2.holder, '张三', '覆盖时被改回旧样子、之后没人动的 → 覆盖前的');
  assert.equal(byId.x9.holder, '王五');
  assert.deepEqual(r.stats, { recovered: 4, keptNew: 2, keptChanged: 2, dropped: 0, deletedLater: 1, conflicts: 0 });
  // 覆盖时带进来、之后没人动的 → 去掉
  const r2 = R.mergeValues(JSON.stringify(after), JSON.stringify(before), JSON.stringify([...after, A('n1')]));
  assert.ok(!JSON.parse(r2.value).some(x => x.id === 'x9') && JSON.parse(r2.value).some(x => x.id === 'n1'));
  // 之后没人改过 → 就是覆盖前那份（原样字符串）
  assert.equal(R.mergeValues(JSON.stringify(after), JSON.stringify(before), JSON.stringify(after)).value, JSON.stringify(before));
  // 简单数组（类别名称）、对象（设置）
  assert.deepEqual(JSON.parse(R.mergeValues('["笔记本","台式机"]', '["笔记本","台式机","一体机"]', '["笔记本","台式机","服务器"]').value), ['笔记本', '台式机', '一体机', '服务器']);
  assert.deepEqual(JSON.parse(R.mergeValues('{"rate":5,"life":5}', '{"rate":3,"life":5}', '{"rate":5,"life":6}').value), { rate: 3, life: 6 });
});

test('还原时选「保留之后的改动」：整份数据层面', () => {
  const evsBefore = R.listEvents().length;
  const A = (id, extra = {}) => ({ id, code: 'K-' + id, ...extra });
  at('2027-01-01T01:00:00.000Z', () => push('pc-main', { 'ams:assets': JSON.stringify([A('1'), A('2'), A('3')]), 'ams:sites': JSON.stringify([{ id: 's1', name: '信息部' }]) }));
  const mvBefore = val('ams:movements'), catsBefore = val('ams:cats'); // 同一个库，前面的测试留下过
  at('2027-01-01T02:00:00.000Z', () => push('pc-old', { 'ams:assets': JSON.stringify([A('1')]), 'ams:sites': JSON.stringify([]), 'ams:movements': JSON.stringify([{ id: 'm0' }]), 'ams:cats': '["x"]' }));
  at('2027-01-01T03:00:00.000Z', () => push('pc-main', { 'ams:assets': JSON.stringify([A('9'), A('1', { holder: '新' })]) }));
  const evs = R.listEvents();
  const idx = evs.length - 2; // pc-old 那次
  assert.equal(evs[idx].dev, 'pc-old');
  const plain = R.plan(idx);
  assert.equal(plain.later, 1);
  assert.equal(plain.summary.find(s => s.key === 'ams:assets').restored, 3, '完全退回：3 台（之后加的 9 没了）');
  const keep = R.plan(idx, undefined, { keepLater: true });
  assert.equal(keep.keepLater, true);
  assert.equal(keep.summary.find(s => s.key === 'ams:assets').restored, 4, '保留之后的：1、2、3 + 之后加的 9');
  const r = at('2027-01-01T04:00:00.000Z', () => R.apply(idx, undefined, { keepLater: true }));
  const assets = JSON.parse(val('ams:assets'));
  assert.deepEqual(assets.map(a => a.id).sort(), ['1', '2', '3', '9']);
  assert.equal(assets.find(a => a.id === '1').holder, '新');
  assert.deepEqual(JSON.parse(val('ams:sites')), [{ id: 's1', name: '信息部' }], '之后没人动的份：直接退回覆盖前');
  assert.equal(val('ams:movements'), mvBefore, '覆盖时改掉的份（之后没人动）：退回覆盖前');
  assert.equal(val('ams:cats') ?? null, catsBefore ?? null, '覆盖时带进来的份：删掉');
  assert.ok(r.written >= 3 && evsBefore < R.listEvents().length);
});
