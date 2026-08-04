-- 急救设备巡检 · 核心表
-- 约定：日 YYYY-MM-DD / 月 YYYY-MM / 时刻 "YYYY-MM-DD HH:mm"（Asia/Shanghai，应用层生成）
-- 锁定不设字段：records.sign_at 非空即锁；week_signs/month_signs 行存在即锁（UNIQUE 保证只签一次）

CREATE TABLE depts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  code        TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'on' CHECK(status IN ('on','off')),
  created_at  TEXT NOT NULL
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('inspector','dept','equip','admin')),
  status        TEXT NOT NULL DEFAULT 'on' CHECK(status IN ('on','off')),
  fail_count    INTEGER NOT NULL DEFAULT 0,   -- 密码连错计数（满 5 清零并升 freeze_level）
  freeze_level  INTEGER NOT NULL DEFAULT 0,   -- 冻结轮次：n → 5*n 分钟
  frozen_until  TEXT,                          -- ISO 时刻，NULL=未冻结
  must_change   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE user_depts (                      -- inspector 多科室；dept 角色恰 1 行
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dept_id INTEGER NOT NULL REFERENCES depts(id),
  PRIMARY KEY (user_id, dept_id)
);

CREATE TABLE devices (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  dept_id   INTEGER NOT NULL REFERENCES depts(id),
  cat_name  TEXT NOT NULL,
  code      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  model     TEXT NOT NULL DEFAULT '',
  location  TEXT NOT NULL DEFAULT '',
  status    TEXT NOT NULL DEFAULT 'in_use',
  sort      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_devices_dept ON devices(dept_id, status);

CREATE TABLE members (                         -- 科室签字人名单（周签时从中选人）
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  dept_id INTEGER NOT NULL REFERENCES depts(id),
  name    TEXT NOT NULL,
  title   TEXT NOT NULL DEFAULT '',
  status  TEXT NOT NULL DEFAULT 'on' CHECK(status IN ('on','off')),
  sort    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (dept_id, name)
);

CREATE TABLE files (
  id         TEXT PRIMARY KEY,                 -- uuid
  kind       TEXT NOT NULL CHECK(kind IN ('signature','attachment')),
  rel_path   TEXT NOT NULL,                    -- signatures/2026/08/<id>.png
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  sha256     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE records (                         -- 日巡检；一科室一天一条
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  dept_id        INTEGER NOT NULL REFERENCES depts(id),
  date           TEXT NOT NULL,
  inspector_id   INTEGER REFERENCES users(id),
  inspector_name TEXT,
  sign_name      TEXT, sign_title TEXT, sign_opinion TEXT,
  sign_file_id   TEXT REFERENCES files(id),
  sign_at        TEXT,                          -- 非空 = 已日签锁定
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (dept_id, date)
);
CREATE INDEX idx_records_date ON records(date);

CREATE TABLE record_items (
  record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL REFERENCES devices(id),
  result    TEXT NOT NULL CHECK(result IN ('ok','ng')),
  note      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (record_id, device_id)
);

CREATE TABLE week_signs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  dept_id      INTEGER NOT NULL REFERENCES depts(id),
  week_start   TEXT NOT NULL,                  -- 周一日期；服务端校验必须是周一
  sign_name    TEXT NOT NULL, sign_title TEXT NOT NULL DEFAULT '', sign_opinion TEXT NOT NULL DEFAULT '',
  sign_file_id TEXT NOT NULL REFERENCES files(id),
  stat_checked INTEGER NOT NULL, stat_ng INTEGER NOT NULL, stat_days INTEGER NOT NULL,
  signed_by    INTEGER REFERENCES users(id),
  sign_at      TEXT NOT NULL,
  UNIQUE (dept_id, week_start)
);

CREATE TABLE month_signs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  dept_id      INTEGER NOT NULL REFERENCES depts(id),
  month        TEXT NOT NULL,                  -- YYYY-MM
  sign_name    TEXT NOT NULL, sign_title TEXT NOT NULL DEFAULT '', sign_opinion TEXT NOT NULL DEFAULT '',
  sign_file_id TEXT NOT NULL REFERENCES files(id),
  stat_checked INTEGER NOT NULL, stat_ng INTEGER NOT NULL, stat_weeks INTEGER NOT NULL,
  signed_by    INTEGER REFERENCES users(id),
  sign_at      TEXT NOT NULL,
  UNIQUE (dept_id, month)
);

CREATE TABLE refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,            -- sha256(token)
  device_id   TEXT NOT NULL DEFAULT '',
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  revoked_at  TEXT
);
CREATE INDEX idx_rt_user ON refresh_tokens(user_id);

CREATE TABLE auth_throttle (                   -- 设备/IP 级账号枚举冷却
  key           TEXT PRIMARY KEY,              -- 'ip:1.2.3.4' / 'dev:<uuid>'
  fail_count    INTEGER NOT NULL DEFAULT 0,
  window_start  TEXT NOT NULL,
  blocked_until TEXT
);

CREATE TABLE known_devices (                   -- login-state 防枚举：该设备成功登录过哪些账号
  device_id TEXT NOT NULL,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_at   TEXT NOT NULL,
  PRIMARY KEY (device_id, user_id)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
