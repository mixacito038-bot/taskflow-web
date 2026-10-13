-- 签字人 / 巡检人与「账号」「签字人名单」建立 ID 关联。
-- 目的：页面与导出一律显示「当前名字」，账号或签字人改名后，历史记录同步更新。
-- 原有的 sign_name / sign_title / inspector_name 继续保留，作为签字当时的快照，
-- 在关联对象被删除时兜底显示。
--
-- 关联关系：
--   日签人 = 登录签字的巡检员账号      → records.sign_user_id
--   巡检人 = 最后保存勾选结果的账号    → records.inspector_id（原有）
--   周签人 = 本科室「签字人名单」中的人 → week_signs.sign_member_id
--   月签人 = 登录签字的设备科账号      → month_signs.signed_by（原有）
--
-- 刻意不加 REFERENCES：库里开启了 foreign_keys，加了外键后，
-- 「有过签字记录的签字人」在名单里就删不掉了（删除会直接报错）。
-- 用软关联 + 快照兜底：对象被删除时显示签字当时的名字。

ALTER TABLE records ADD COLUMN sign_user_id INTEGER;
ALTER TABLE week_signs ADD COLUMN sign_member_id INTEGER;

-- 回填历史数据（只在能确定是同一人时回填；确定不了的继续按快照显示）：
-- 日签只能由登录的巡检员本人签字，签字名就是账号显示名，
-- 与同一条记录的巡检人快照一致 → 即为同一账号。
UPDATE records SET sign_user_id = inspector_id
 WHERE sign_at IS NOT NULL AND sign_user_id IS NULL AND inspector_id IS NOT NULL
   AND sign_name = inspector_name;

-- 周签人按「科室 + 姓名」匹配签字人名单（名单里同科室姓名唯一）。
UPDATE week_signs SET sign_member_id =
  (SELECT m.id FROM members m WHERE m.dept_id = week_signs.dept_id AND m.name = week_signs.sign_name)
 WHERE sign_member_id IS NULL;
