-- 新增「设备业务量与收入」业务模板种子。
--
-- 月检查人数/项目、检阳性数、总收入不在设备数据填报页手工敲，而是由科室按表格统一上传，
-- 走和其它模板一样的上传→校验→审核→发布流程，填报页只读回填。
--
-- 种子放在新迁移而不是补进 0009：0009 已经在生产库执行过，drizzle 按 journal 记账不会重跑，
-- 改它只会让新库和老库的模板清单不一致。
--
-- period 存字符串而非日期：要同时接受 2026-07 / 2026-W28 / 2026-Q3 / 2026-07-15 四种粒度的期间键。
INSERT OR IGNORE INTO `data_business_templates`
  (`id`,`hospital_id`,`code`,`name`,`data_domain`,`required_fields_json`,`optional_fields_json`,`aliases_json`,`validation_json`,`default_header_row`,`status`,`version`)
VALUES
  ('template-device-workload',NULL,'device_workload','设备业务量与收入','exam','["deviceId","period","examVolume"]','["positiveCount","totalRevenue","department"]','{"设备编号":"deviceId","资产编号":"deviceId","期间":"period","月份":"period","统计期间":"period","会计期间":"period","检查人数/项目":"examVolume","月检查人数":"examVolume","检查人次":"examVolume","检查例数":"examVolume","工作量":"examVolume","检阳性数":"positiveCount","阳性例数":"positiveCount","阳性数":"positiveCount","总收入（元）":"totalRevenue","总收入":"totalRevenue","收入":"totalRevenue","设备收入":"totalRevenue","责任科室":"department","科室":"department"}','{"recordType":{"const":"exam"},"deviceId":{"required":true},"period":{"required":true},"examVolume":{"type":"number","required":true},"positiveCount":{"type":"number"},"totalRevenue":{"type":"number"}}',1,'active',1);
