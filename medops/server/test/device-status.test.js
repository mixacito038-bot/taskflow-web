'use strict';
/* 设备状态换算：导入用的 JS 对照表必须与迁移 005 的 SQL 对照表完全一致，
   否则「升级时自动改好的」和「导入时换算的」会对不上 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../src/services/device-status');

test('常见写法换算到四个合法状态；没填返回空串；认不出返回 null', () => {
  const cases = [['active', 'in_use'], [' Active ', 'in_use'], ['IN-USE', 'in_use'], ['in use', 'in_use'], ['正常', 'in_use'],
    ['　在用　', 'in_use'], ['维修中', 'repair'], ['Maintenance', 'repair'], ['inactive', 'retired'], ['已停用', 'retired'],
    ['报废', 'scrapped'], ['Scrapped', 'scrapped'], ['', ''], [null, ''], [undefined, ''], ['备用', null], ['lent', null]];
  for (const [v, want] of cases) assert.equal(S.normDeviceStatus(v), want, `「${v}」`);
});

test('启用状态：明确表示停用的写法 → off，其余 → on', () => {
  for (const v of ['off', 'inactive', '停用', '已停用', '离职', false, 'FALSE']) assert.equal(S.onOff(v), 'off', String(v));
  for (const v of ['on', 'active', '在用', '', null, undefined, true, 'xyz']) assert.equal(S.onOff(v), 'on', String(v));
});

test('与迁移 005 的对照表逐项一致', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/005_device_status_fix.sql'), 'utf8');
  const pairs = [...sql.matchAll(/\('([^']*)', '(in_use|repair|retired|scrapped)'\)/g)].map(m => [m[1], m[2]]);
  assert.ok(pairs.length > 40, '没解析到 SQL 对照表');
  for (const [k, v] of pairs) {
    if (k === '') continue; // SQL 里空串归「在用」；JS 返回 ''（没填），由调用方按新设备在用、已有设备不变处理
    assert.equal(S.normDeviceStatus(k), v, `SQL 有「${k}」→ ${v}`);
  }
  const sqlMap = new Map(pairs);
  for (const [v, words] of Object.entries(S.SYNONYMS)) {
    for (const w of words) assert.equal(sqlMap.get(w), v, `JS 有「${w}」→ ${v}，SQL 对照表里没有或不一致`);
  }
});
