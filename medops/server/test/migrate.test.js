'use strict';
/* 迁移单测：005 设备状态 / 品类归一化。
   做法：在内存库里跑完全部迁移 → 写入旧版本留下的那种设备 → 把 005 的 SQL 再执行一遍，
   相当于「旧库升级时第一次跑 005」。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate } = require('../src/db/migrate');

const SQL005 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/005_device_status_fix.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  db.prepare("INSERT INTO depts (id, name, created_at) VALUES (1, '急诊科', '2026-01-01T00:00:00Z')").run();
  return db;
}
const addDev = (db, code, status, cat = '除颤类') => db.prepare(`INSERT INTO devices
  (dept_id, cat_name, code, name, status, created_at, updated_at) VALUES (1, ?, ?, ?, ?, 'x', 'x')`)
  .run(cat, code, code, status);
const statusOf = (db, code) => db.prepare('SELECT status FROM devices WHERE code = ?').get(code).status;

test('005：active 等常见写法归一到四个合法状态', () => {
  const db = freshDb();
  const cases = {
    'BF-001': ['active', 'in_use'], 'BF-002': [' Active ', 'in_use'], 'BF-003': ['IN-USE', 'in_use'],
    'BF-004': ['in use', 'in_use'], 'BF-005': ['', 'in_use'], 'BF-006': ['正常', 'in_use'],
    'BF-007': ['　在用　', 'in_use'], 'BF-008': ['维修中', 'repair'], 'BF-009': ['Maintenance', 'repair'],
    'BF-010': ['inactive', 'retired'], 'BF-011': ['已停用', 'retired'], 'BF-012': ['报废', 'scrapped'],
    'BF-013': ['Scrapped', 'scrapped'], 'BF-014': ['in_use', 'in_use'], 'BF-015': ['repair', 'repair'],
    'BF-016': ['retired', 'retired'], 'BF-017': ['scrapped', 'scrapped']
  };
  for (const [code, [st]] of Object.entries(cases)) addDev(db, code, st);
  db.exec(SQL005);
  for (const [code, [st, want]] of Object.entries(cases)) assert.equal(statusOf(db, code), want, `${code}「${st}」`);
});

test('005：认不出来的状态保持原样（交给人工确认），不擅自改成在用', () => {
  const db = freshDb();
  addDev(db, 'BY-001', '备用');
  addDev(db, 'BY-002', 'lent');
  db.exec(SQL005);
  assert.equal(statusOf(db, 'BY-001'), '备用');
  assert.equal(statusOf(db, 'BY-002'), 'lent');
});

test('005：空品类改为「未分类」，有品类的不动', () => {
  const db = freshDb();
  addDev(db, 'JS-001', 'active', '');
  addDev(db, 'JS-002', 'in_use', '  ');
  addDev(db, 'JS-003', 'in_use', '生命监护类');
  db.exec(SQL005);
  const cat = code => db.prepare('SELECT cat_name FROM devices WHERE code = ?').get(code).cat_name;
  assert.equal(cat('JS-001'), '未分类');
  assert.equal(cat('JS-002'), '未分类');
  assert.equal(cat('JS-003'), '生命监护类');
});

test('005：每一处改动都记进审计日志（含改前的值），合法数据不产生日志', () => {
  const db = freshDb();
  addDev(db, 'BF-001', 'active', '');
  addDev(db, 'BF-002', 'in_use');
  db.exec(SQL005);
  const logs = db.prepare("SELECT action, detail, ip FROM audit_log ORDER BY id").all();
  assert.deepEqual(logs, [
    { action: 'device_status_fix', detail: "code=BF-001 from='active' to=in_use", ip: 'migration' },
    { action: 'device_cat_fix', detail: "code=BF-001 from='' to=未分类", ip: 'migration' }
  ]);
  // 再跑一遍不会重复记（迁移本身只跑一次，这里验证 SQL 自身是幂等的）
  db.exec(SQL005);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c, 2);
});

test('005：不留下临时表', () => {
  const db = freshDb();
  db.exec(SQL005);
  const t = db.prepare("SELECT name FROM sqlite_temp_master WHERE type = 'table'").all();
  assert.deepEqual(t, []);
});
