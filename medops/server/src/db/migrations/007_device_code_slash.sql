-- migrate: foreign_keys=off
-- 设备编码允许「/」（= 没有编码），多台设备可以都是「/」；其他编码照旧全院唯一。
--
-- SQLite 去不掉列上的 UNIQUE，只能重建 devices 表（官方文档推荐的做法：
-- 新建表 → 原样拷数据（id 不变）→ 删旧表 → 改名 → 重建索引）。
-- 第一行的标记让 migrate.js 在事务外先关外键检查、执行完做一次外键检查（不通过整个回滚）再打开：
-- 外键开着时删旧表会去检查 record_items，表就重建不成。
-- 列、类型、默认值、索引与原表完全一致，旧版本的代码（升级失败回退时）照常能用这张表。

-- 1) 「无」「-」「、」等写法统一成「/」；改前的值记进审计日志
INSERT INTO audit_log (user_id, action, detail, ip, created_at)
SELECT NULL, 'device_code_fix', 'id=' || id || ' name=' || name || ' from=' || quote(code) || ' to=/', 'migration',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM devices
 WHERE code <> '/' AND lower(trim(code, ' 　' || char(9, 10, 13))) IN
       ('/', '／', '、', '\', '无', '没有', '暂无', '不适用', '-', '－', '—', '–', 'n/a');
UPDATE devices SET code = '/', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE code <> '/' AND lower(trim(code, ' 　' || char(9, 10, 13))) IN
       ('/', '／', '、', '\', '无', '没有', '暂无', '不适用', '-', '－', '—', '–', 'n/a');

INSERT INTO audit_log (user_id, action, detail, ip, created_at)
SELECT NULL, 'device_serial_fix', 'id=' || id || ' name=' || name || ' from=' || quote(serial) || ' to=/', 'migration',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM devices
 WHERE serial <> '/' AND lower(trim(serial, ' 　' || char(9, 10, 13))) IN
       ('/', '／', '、', '\', '无', '没有', '暂无', '不适用', '-', '－', '—', '–', 'n/a');
UPDATE devices SET serial = '/', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE serial <> '/' AND lower(trim(serial, ' 　' || char(9, 10, 13))) IN
       ('/', '／', '、', '\', '无', '没有', '暂无', '不适用', '-', '－', '—', '–', 'n/a');

-- 2) 重建表。自增计数器先记下：删表会连它一起删掉，重建后只会从现有最大 id 往后排，
--    删过的设备编号就会被复用（手机上残留的旧草稿会对到新设备上）
CREATE TEMP TABLE _dev_seq AS SELECT seq FROM sqlite_sequence WHERE name = 'devices';

CREATE TABLE devices_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dept_id     INTEGER NOT NULL REFERENCES depts(id),
  cat_name    TEXT NOT NULL,
  code        TEXT NOT NULL,              -- 「/」= 没有编码，可以重复；其他编码由 ux_devices_code 保证唯一
  name        TEXT NOT NULL,
  model       TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'in_use',
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  expiry_date TEXT NOT NULL DEFAULT '',
  expiry_note TEXT NOT NULL DEFAULT '',
  remind_days INTEGER NOT NULL DEFAULT 0,
  serial      TEXT NOT NULL DEFAULT ''    -- 「/」或空 = 没有 / 还没录；其他序列号由程序判重（不区分大小写）
);
INSERT INTO devices_new (id, dept_id, cat_name, code, name, model, location, status, sort, created_at, updated_at,
                         expiry_date, expiry_note, remind_days, serial)
SELECT id, dept_id, cat_name, code, name, model, location, status, sort, created_at, updated_at,
       expiry_date, expiry_note, remind_days, serial
  FROM devices;
DROP TABLE devices;
ALTER TABLE devices_new RENAME TO devices;

CREATE INDEX idx_devices_dept ON devices(dept_id, status);
CREATE INDEX idx_devices_expiry ON devices(expiry_date) WHERE expiry_date <> '';
CREATE UNIQUE INDEX ux_devices_code ON devices(code) WHERE code <> '/';

UPDATE sqlite_sequence SET seq = max(seq, (SELECT seq FROM _dev_seq))
 WHERE name = 'devices' AND EXISTS (SELECT 1 FROM _dev_seq);
INSERT INTO sqlite_sequence (name, seq)
SELECT 'devices', seq FROM _dev_seq WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'devices');
DROP TABLE _dev_seq;
