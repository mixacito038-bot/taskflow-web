-- 系统设置（键值对）。只新增一张表：回退到旧版本时旧代码不认识它，照常运行（只是设置不生效）。
--
--   inspect_start  巡检起算日（周一，YYYY-MM-DD）：这天以前的日子、周、月不再提醒、不算缺签；
--                  归属起算日当月的月签只要求起算日所在周及以后的周签。空 / 没有这一行 = 不限
--                  （按科室建立日、或更早的第一条巡检记录算，同以前）。
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT,
  updated_by INTEGER
);
