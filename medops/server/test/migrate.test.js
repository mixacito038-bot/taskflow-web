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

test('006：设备加序列号列，旧设备默认空串，不设唯一约束', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  const col = db.prepare("SELECT * FROM pragma_table_info('devices') WHERE name = 'serial'").get();
  assert.ok(col, '应有 serial 列');
  assert.equal(col.notnull, 1);
  assert.equal(col.dflt_value, "''");
  db.prepare("INSERT INTO depts (id, name, created_at) VALUES (1, '急诊科', 'x')").run();
  // 旧代码的 INSERT 不带 serial 列：照样能插（升级失败回退到旧版本时，旧代码要能用新库）
  db.prepare(`INSERT INTO devices (dept_id, cat_name, code, name, status, created_at, updated_at)
    VALUES (1, '除颤类', 'A-1', '除颤仪', 'in_use', 'x', 'x')`).run();
  assert.equal(db.prepare("SELECT serial FROM devices WHERE code = 'A-1'").get().serial, '');
  db.prepare("UPDATE devices SET serial = 'SN1' WHERE code = 'A-1'").run();
  db.prepare(`INSERT INTO devices (dept_id, cat_name, code, name, status, serial, created_at, updated_at)
    VALUES (1, '除颤类', 'A-2', '除颤仪', 'in_use', 'SN1', 'x', 'x')`).run(); // 允许重号
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM devices WHERE serial = 'SN1'").get().c, 2);
});

/* ---------- 007：设备编码允许「/」重复（重建 devices 表） ---------- */
const DIR = path.join(__dirname, '../src/db/migrations');
const os = require('os');
/* 只跑到某个迁移之前：模拟线上升级前的库 */
function dbBefore(stop) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort().filter(f => f < stop)) {
    db.transaction(() => { db.exec(fs.readFileSync(path.join(DIR, f), 'utf8')); db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(f, 'x'); })();
  }
  return db;
}
function seed(db) {
  db.exec(`INSERT INTO depts (id, name, created_at) VALUES (1, '急诊科', 'x'), (2, 'ICU', 'x');
    INSERT INTO devices (dept_id, cat_name, code, name, model, location, status, sort, created_at, updated_at,
      expiry_date, expiry_note, remind_days, serial) VALUES
      (1, '除颤类', 'JZ-1', '除颤仪', 'XD-100', '抢救室', 'in_use', 2, 'c1', 'u1', '2027-03-15', '电极片', 15, 'SN1'),
      (1, '呼吸类', '无', '简易呼吸器', '', '', 'in_use', 0, 'c2', 'u2', '', '', 0, '-'),
      (2, '监护类', 'ICU-1', '监护仪', '', '1 床', 'repair', 0, 'c3', 'u3', '', '', 0, ''),
      (2, '监护类', 'ICU-2', '删掉的', '', '', 'in_use', 0, 'c4', 'u4', '', '', 0, '');
    DELETE FROM devices WHERE code = 'ICU-2';
    INSERT INTO records (id, dept_id, date, created_at, updated_at) VALUES (1, 1, '2026-11-01', 'x', 'x');
    INSERT INTO record_items (record_id, device_id, result, note) VALUES (1, 1, 'ok', ''), (1, 2, 'ng', '漏气');`);
}

test('007：重建后数据、id、自增计数、外键、索引都在；「/」可以重复，其他编码仍然唯一', () => {
  const db = dbBefore('007');
  seed(db);
  const before = db.prepare('SELECT * FROM devices ORDER BY id').all();
  const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'devices'").get().seq;
  assert.equal(seq, 4);
  migrate(db);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1, '外键检查已恢复为开');
  const after = db.prepare('SELECT * FROM devices ORDER BY id').all();
  // 只有「无」「-」被统一成「/」，其他一个字都不变
  const want = before.map(v => (v.id === 2 ? { ...v, code: '/', serial: '/', updated_at: after[1].updated_at } : v));
  assert.deepEqual(after, want);
  assert.deepEqual(Object.keys(after[0]), Object.keys(before[0]), '列和顺序不变');
  // 删过的设备编号不复用
  const id = db.prepare(`INSERT INTO devices (dept_id, cat_name, code, name, created_at, updated_at) VALUES (1, '呼吸类', '/', '简易呼吸器', 'x', 'x')`).run().lastInsertRowid;
  assert.equal(id, 5, '新设备接着原来的计数往后排（4 号删过，不复用）');
  // 「/」可以多台；其他编码重复撞唯一索引
  assert.throws(() => db.prepare(`INSERT INTO devices (dept_id, cat_name, code, name, created_at, updated_at) VALUES (1, 'c', 'JZ-1', 'x', 'x', 'x')`).run(), /UNIQUE constraint failed: devices\.code/);
  // 外键照常：被巡检过的设备删不掉；不存在的科室插不进
  assert.throws(() => db.prepare('DELETE FROM devices WHERE id = 1').run(), /FOREIGN KEY/);
  assert.throws(() => db.prepare(`INSERT INTO devices (dept_id, cat_name, code, name, created_at, updated_at) VALUES (99, 'c', 'Z', 'x', 'x', 'x')`).run(), /FOREIGN KEY/);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'devices' AND sql IS NOT NULL ORDER BY name").all();
  assert.deepEqual(idx.map(i => i.name), ['idx_devices_dept', 'idx_devices_expiry', 'ux_devices_code']);
  assert.match(idx[2].sql, /UNIQUE INDEX ux_devices_code ON devices\(code\) WHERE code <> '\/'/);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_temp_master WHERE type = 'table'").all(), [], '不留临时表');
  assert.deepEqual(db.prepare("SELECT action, detail, ip FROM audit_log ORDER BY id").all(), [
    { action: 'device_code_fix', detail: "id=2 name=简易呼吸器 from='无' to=/", ip: 'migration' },
    { action: 'device_serial_fix', detail: "id=2 name=简易呼吸器 from='-' to=/", ip: 'migration' }
  ]);
  // 旧版本的代码（回退后）：INSERT 不带 serial、按编码查重，照常能用
  db.prepare(`INSERT INTO devices (dept_id, cat_name, code, name, model, location, status, sort, created_at, updated_at)
    VALUES (1, '吸引类', 'JZ-9', '吸引器', '', '', 'in_use', 0, 'x', 'x')`).run();
  assert.equal(db.prepare("SELECT serial FROM devices WHERE code = 'JZ-9'").get().serial, '');
  assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE name = '007_device_code_slash.sql'").get());
});

test('007：空库（从没建过设备）也能迁移；从 005 的库连跑 006、007', () => {
  const db = dbBefore('006');
  migrate(db);
  // 空表 INSERT … SELECT 会留下一条 seq=0 的计数（SQLite 的行为），下一台设备照样从 1 号开始
  db.prepare("INSERT INTO depts (id, name, created_at) VALUES (1, '急诊科', 'x')").run();
  const id = db.prepare(`INSERT INTO devices (dept_id, cat_name, code, name, created_at, updated_at) VALUES (1, 'c', '/', 'x', 'x', 'x')`).run().lastInsertRowid;
  assert.equal(id, 1);
  assert.equal(db.prepare("SELECT serial FROM devices").get().serial, '');
});

test('007：中途出错整体回滚，原表原样、外键检查恢复为开', () => {
  const db = dbBefore('007');
  seed(db);
  db.exec('CREATE TABLE devices_new (x INTEGER)'); // 让 007 的 CREATE TABLE 失败
  const sqlBefore = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'devices'").get().sql;
  const rows = db.prepare('SELECT * FROM devices ORDER BY id').all();
  assert.throws(() => migrate(db), /devices_new already exists/);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'devices'").get().sql, sqlBefore, '表结构没变');
  assert.deepEqual(db.prepare('SELECT * FROM devices ORDER BY id').all(), rows, '数据没变（「无」也没被改）');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c, 0);
  assert.ok(!db.prepare("SELECT 1 FROM schema_migrations WHERE name = '007_device_code_slash.sql'").get(), '没记成已执行，下次启动会重试');
});

test('migrate：foreign_keys=off 的迁移造成新的外键问题 → 回滚；库里原有的外键问题不挡迁移', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (pid INTEGER REFERENCES p(id));
    INSERT INTO p VALUES (1); INSERT INTO c VALUES (1);`);
  fs.writeFileSync(path.join(dir, '001_bad.sql'), '-- migrate: foreign_keys=off\nINSERT INTO c VALUES (99);');
  assert.throws(() => migrate(db, dir), /外键检查不通过/);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM c').get().c, 1, '回滚了');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  // 原来就有的外键问题（比如手工改过库）：不算这次迁移造成的
  db.pragma('foreign_keys = OFF'); db.exec('INSERT INTO c VALUES (77)'); db.pragma('foreign_keys = ON');
  fs.writeFileSync(path.join(dir, '001_bad.sql'), '-- migrate: foreign_keys=off\nCREATE TABLE p2 (id INTEGER PRIMARY KEY); INSERT INTO p2 SELECT id FROM p; DROP TABLE p; ALTER TABLE p2 RENAME TO p;');
  migrate(db, dir);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  // 没有标记的迁移：外键照常开着（DROP 被引用的表会失败）
  fs.writeFileSync(path.join(dir, '002_plain.sql'), 'DELETE FROM p;');
  assert.throws(() => migrate(db, dir), /FOREIGN KEY/);
  fs.rmSync(dir, { recursive: true, force: true });
});
