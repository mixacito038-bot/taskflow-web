-- 操作日志：在原有 audit_log 上加列（只加不改，回退到旧版本时旧代码照常写入：新列可以为空）。
--
--   username / user_name / user_role  操作人当时的账号、姓名、角色（快照：账号改名、删除后日志照样看得懂）
--   module   模块：账号 / 科室 / 设备 / 签字人 / 签字 / 登录 / 导入 / 导出 / 系统
--   op       操作：新增 / 修改 / 删除 / 停用 / 启用 / 重置密码 / 作废 / 日签 / 周签 / 月签 / 登录 / 登录失败 …
--   target   操作对象，如「账号 zhoupu01（张三）」「急诊科 · 2026-11-10 日签」
--   summary  一句话说明
--   changes  改了哪些地方：JSON 数组 [{"f":"字段","from":"改前","to":"改后"}]
--   result   ok / fail（登录失败、被拒绝的危险操作也记）
--   ua       浏览器 / 手机型号（User-Agent，截断）
--   device   设备号（x-device-id）
-- 原有的 action / detail 照旧保留：detail 是机器可读的原始信息（stats 里统计作废日签就靠它），页面上作为「原始信息」显示。

ALTER TABLE audit_log ADD COLUMN username TEXT;
ALTER TABLE audit_log ADD COLUMN user_name TEXT;
ALTER TABLE audit_log ADD COLUMN user_role TEXT;
ALTER TABLE audit_log ADD COLUMN module TEXT;
ALTER TABLE audit_log ADD COLUMN op TEXT;
ALTER TABLE audit_log ADD COLUMN target TEXT;
ALTER TABLE audit_log ADD COLUMN summary TEXT;
ALTER TABLE audit_log ADD COLUMN changes TEXT;
ALTER TABLE audit_log ADD COLUMN result TEXT;
ALTER TABLE audit_log ADD COLUMN ua TEXT;
ALTER TABLE audit_log ADD COLUMN device TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_log(module, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);

-- 旧日志补上操作人快照（账号还在的才补得上）
UPDATE audit_log SET
  username  = (SELECT u.username FROM users u WHERE u.id = audit_log.user_id),
  user_name = (SELECT u.display_name FROM users u WHERE u.id = audit_log.user_id),
  user_role = (SELECT u.role FROM users u WHERE u.id = audit_log.user_id)
 WHERE user_id IS NOT NULL AND username IS NULL;

-- 旧日志按 action 归到模块和操作；说明先用原始信息
UPDATE audit_log SET
  module = CASE
    WHEN action LIKE 'user%' THEN '账号'
    WHEN action LIKE 'dept%' THEN '科室'
    WHEN action LIKE 'device%' THEN '设备'
    WHEN action = 'sign_void' THEN '签字'
    WHEN action IN ('login', 'refresh_replay', 'refresh_device_mismatch', 'change_password') THEN '登录'
    WHEN action IN ('import_legacy') THEN '导入'
    ELSE '系统' END,
  op = CASE action
    WHEN 'user_create' THEN '新增' WHEN 'user_patch' THEN '修改' WHEN 'user_delete' THEN '删除'
    WHEN 'user_reset_password' THEN '重置密码' WHEN 'user_unfreeze' THEN '解冻' WHEN 'users_import' THEN '批量导入'
    WHEN 'dept_disable' THEN '停用' WHEN 'dept_enable' THEN '启用' WHEN 'dept_delete' THEN '删除'
    WHEN 'depts_import' THEN '批量导入' WHEN 'dept_batch_status' THEN '批量改状态' WHEN 'dept_batch_delete' THEN '批量删除'
    WHEN 'device_transfer' THEN '调拨' WHEN 'device_delete' THEN '删除' WHEN 'devices_import' THEN '批量导入'
    WHEN 'device_batch_status' THEN '批量改状态' WHEN 'device_batch_delete' THEN '批量删除'
    WHEN 'sign_void' THEN '作废' WHEN 'login' THEN '登录' WHEN 'change_password' THEN '修改密码'
    WHEN 'refresh_replay' THEN '登录凭证重放（已全部吊销）' WHEN 'refresh_device_mismatch' THEN '登录凭证换设备使用（已拒绝）'
    WHEN 'import_legacy' THEN '历史数据导入' WHEN 'data_reset' THEN '清空数据' WHEN 'ams_restore' THEN '资产盘点数据还原'
    WHEN 'migration' THEN '数据库升级'
    ELSE action END,
  summary = detail,
  result = CASE WHEN action IN ('refresh_replay', 'refresh_device_mismatch') THEN 'fail' ELSE 'ok' END
 WHERE module IS NULL;

-- 自动修正类的历史记录（005 / 007 迁移写的）
UPDATE audit_log SET module = '系统', op = '自动修正数据' WHERE action LIKE 'device\_%\_fix' ESCAPE '\';
