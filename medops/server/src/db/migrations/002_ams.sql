-- 资产盘点系统（无源码压缩版）云同步：整 key 快照 + 乐观锁 + 历史 + 附件对账

CREATE TABLE ams_kv (
  key        TEXT PRIMARY KEY,                 -- 'ams:assets' 等，原样
  value      TEXT,                             -- JSON 字符串原样存；NULL = 已删除(removeItem)
  version    INTEGER NOT NULL DEFAULT 1,       -- 乐观锁：每次写 +1
  seq        INTEGER NOT NULL,                 -- 全局递增游标（changes?since= 用）
  updated_at TEXT NOT NULL,
  updated_by INTEGER,
  device_id  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_ams_kv_seq ON ams_kv(seq);

CREATE TABLE ams_kv_history (                  -- 每 key 保留最近 20 版
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL, value TEXT, version INTEGER NOT NULL,
  updated_at TEXT NOT NULL, updated_by INTEGER, device_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_amsh_key ON ams_kv_history(key, version);

CREATE TABLE ams_files (                       -- 对应 IndexedDB ams-files/files（附件 dataURL 落地为二进制）
  id         TEXT PRIMARY KEY,                 -- 沿用 App 的 keyPath id
  asset_id   TEXT NOT NULL DEFAULT '',
  meta       TEXT NOT NULL DEFAULT '{}',       -- 原记录去掉 dataUrl 后的 JSON
  rel_path   TEXT NOT NULL,                    -- ams/<id>.bin
  mime       TEXT NOT NULL DEFAULT '',
  size       INTEGER NOT NULL DEFAULT 0,
  sha256     TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,       -- 墓碑
  seq        INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_ams_files_seq ON ams_files(seq);

CREATE TABLE ams_seq (id INTEGER PRIMARY KEY CHECK(id=1), n INTEGER NOT NULL);
INSERT INTO ams_seq VALUES (1, 0);
