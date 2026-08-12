-- 资产编号简码：设备台账新增设备时按「简码 + 7 位顺序号」自动生成资产编号。
-- 顺序号不单独存计数器，按现有台账里同简码的最大号推算，避免导入/删除/跨设备同步后计数器漂移。
ALTER TABLE `hospitals` ADD `asset_code_prefix` text DEFAULT '' NOT NULL;
