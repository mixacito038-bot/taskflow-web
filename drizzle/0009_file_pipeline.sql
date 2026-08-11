CREATE TABLE `data_business_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`data_domain` text NOT NULL,
	`file_types_json` text DEFAULT '["xlsx","csv","json"]' NOT NULL,
	`required_fields_json` text DEFAULT '[]' NOT NULL,
	`optional_fields_json` text DEFAULT '[]' NOT NULL,
	`aliases_json` text DEFAULT '{}' NOT NULL,
	`validation_json` text DEFAULT '{}' NOT NULL,
	`default_header_row` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_account_id` text,
	`updated_by_account_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_business_templates_hospital_code_version_unique` ON `data_business_templates` (`hospital_id`,`code`,`version`);--> statement-breakpoint
CREATE INDEX `data_business_templates_hospital_status_idx` ON `data_business_templates` (`hospital_id`,`status`);--> statement-breakpoint
CREATE TABLE `data_dataset_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`import_job_id` text,
	`layer` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'building' NOT NULL,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`row_count` integer NOT NULL,
	`headers_json` text DEFAULT '[]' NOT NULL,
	`profile_json` text DEFAULT '{}' NOT NULL,
	`parent_snapshot_id` text,
	`mapping_id` text,
	`recipe_id` text,
	`mapping_version` text DEFAULT '' NOT NULL,
	`rule_version` text DEFAULT '' NOT NULL,
	`created_by_account_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_job_id`) REFERENCES `data_import_jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`mapping_id`) REFERENCES `data_field_mappings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recipe_id`) REFERENCES `data_cleaning_recipes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_dataset_snapshots_hospital_object_unique` ON `data_dataset_snapshots` (`hospital_id`,`object_key`);--> statement-breakpoint
CREATE INDEX `data_dataset_snapshots_hospital_layer_idx` ON `data_dataset_snapshots` (`hospital_id`,`layer`,`status`);--> statement-breakpoint
CREATE INDEX `data_dataset_snapshots_import_idx` ON `data_dataset_snapshots` (`hospital_id`,`import_job_id`,`version`);--> statement-breakpoint
CREATE TABLE `data_pipeline_idempotency` (
	`hospital_id` text NOT NULL,
	`action` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_sha256` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`response_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`hospital_id`, `action`, `idempotency_key`),
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `data_pipeline_records` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`source_row_number` integer NOT NULL,
	`source_record_id` text NOT NULL,
	`record_json` text NOT NULL,
	`record_sha256` text NOT NULL,
	`status` text DEFAULT 'valid' NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by_account_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `data_dataset_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_pipeline_records_snapshot_source_unique` ON `data_pipeline_records` (`snapshot_id`,`source_row_number`);--> statement-breakpoint
CREATE INDEX `data_pipeline_records_hospital_snapshot_status_idx` ON `data_pipeline_records` (`hospital_id`,`snapshot_id`,`status`);--> statement-breakpoint
CREATE TABLE `data_reconciliation_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`name` text NOT NULL,
	`left_key_fields_json` text NOT NULL,
	`right_key_fields_json` text NOT NULL,
	`compare_fields_json` text DEFAULT '[]' NOT NULL,
	`tolerance_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_account_id` text NOT NULL,
	`updated_by_account_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_reconciliation_configs_hospital_name_version_unique` ON `data_reconciliation_configs` (`hospital_id`,`name`,`version`);--> statement-breakpoint
CREATE TABLE `data_reconciliation_differences` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`run_id` text NOT NULL,
	`match_key` text NOT NULL,
	`difference_type` text NOT NULL,
	`field_name` text DEFAULT '' NOT NULL,
	`left_record_id` text,
	`right_record_id` text,
	`left_value_json` text DEFAULT 'null' NOT NULL,
	`right_value_json` text DEFAULT 'null' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `data_reconciliation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`left_record_id`) REFERENCES `data_pipeline_records`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`right_record_id`) REFERENCES `data_pipeline_records`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `data_reconciliation_differences_run_idx` ON `data_reconciliation_differences` (`hospital_id`,`run_id`,`difference_type`);--> statement-breakpoint
CREATE TABLE `data_reconciliation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`config_id` text NOT NULL,
	`left_snapshot_id` text NOT NULL,
	`right_snapshot_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`matched_count` integer DEFAULT 0 NOT NULL,
	`left_only_count` integer DEFAULT 0 NOT NULL,
	`right_only_count` integer DEFAULT 0 NOT NULL,
	`mismatch_count` integer DEFAULT 0 NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_by_account_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`config_id`) REFERENCES `data_reconciliation_configs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`left_snapshot_id`) REFERENCES `data_dataset_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`right_snapshot_id`) REFERENCES `data_dataset_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_reconciliation_runs_hospital_idempotency_unique` ON `data_reconciliation_runs` (`hospital_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `data_reconciliation_runs_hospital_created_idx` ON `data_reconciliation_runs` (`hospital_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `data_record_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`record_id` text NOT NULL,
	`field_name` text DEFAULT '' NOT NULL,
	`rule_code` text NOT NULL,
	`severity` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`message` text NOT NULL,
	`before_json` text DEFAULT 'null' NOT NULL,
	`after_json` text DEFAULT 'null' NOT NULL,
	`resolution_comment` text DEFAULT '' NOT NULL,
	`resolved_by_account_id` text,
	`resolved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `data_dataset_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`record_id`) REFERENCES `data_pipeline_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `data_record_issues_hospital_snapshot_status_idx` ON `data_record_issues` (`hospital_id`,`snapshot_id`,`status`);--> statement-breakpoint
CREATE INDEX `data_record_issues_record_idx` ON `data_record_issues` (`record_id`,`status`);--> statement-breakpoint
CREATE TABLE `data_review_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hospital_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`decision` text NOT NULL,
	`actor_account_id` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`break_glass_reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `data_review_events_hospital_resource_idx` ON `data_review_events` (`hospital_id`,`resource_type`,`resource_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `data_import_jobs` ADD `business_template_code` text DEFAULT 'generic' NOT NULL;--> statement-breakpoint
ALTER TABLE `data_import_jobs` ADD `selected_sheet` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `data_import_jobs` ADD `header_row` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `data_import_jobs` ADD `parser_config_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `data_import_jobs` ADD `idempotency_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `data_import_jobs_hospital_idempotency_unique` ON `data_import_jobs` (`hospital_id`,`idempotency_key`) WHERE "data_import_jobs"."idempotency_key" <> '';--> statement-breakpoint
ALTER TABLE `data_publish_versions` ADD `curated_snapshot_id` text REFERENCES data_dataset_snapshots(id);--> statement-breakpoint
ALTER TABLE `data_publish_versions` ADD `published_snapshot_id` text REFERENCES data_dataset_snapshots(id);--> statement-breakpoint
ALTER TABLE `data_publish_versions` ADD `snapshot_sha256` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `data_publish_versions` ADD `correction_of_id` text;--> statement-breakpoint
ALTER TABLE `data_publish_versions` ADD `rollback_of_id` text;--> statement-breakpoint
ALTER TABLE `data_publish_versions` ADD `idempotency_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `data_publish_versions_hospital_idempotency_unique` ON `data_publish_versions` (`hospital_id`,`idempotency_key`) WHERE "data_publish_versions"."idempotency_key" <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO `data_business_templates`
  (`id`,`hospital_id`,`code`,`name`,`data_domain`,`required_fields_json`,`optional_fields_json`,`aliases_json`,`validation_json`,`default_header_row`,`status`,`version`)
VALUES
  ('template-device-master',NULL,'device_master','设备台账','device','["deviceId","deviceName"]','["category","department","model","manufacturer","investment","enabledDate"]','{"资产编号":"deviceId","设备编号":"deviceId","设备名称":"deviceName","科室":"department","设备类别":"category","规格型号":"model","投资额":"investment","原值":"investment","启用日期":"enabledDate","投用日期":"enabledDate"}','{"recordType":{"const":"device"},"deviceId":{"required":true},"investment":{"type":"number"}}',1,'active',1),
  ('template-exam-activity',NULL,'exam_activity','检查工作量','exam','["examId","deviceId","occurredAt"]','["bodyParts","bodyPart","bodyPartWeight","isPrimaryBodyPart","examRevenue","examCost","department"]','{"检查号":"examId","设备编号":"deviceId","主部位":"bodyPart","检查部位":"bodyPart","检查部位列表":"bodyParts","部位权重":"bodyPartWeight","完成时间":"occurredAt","检查时间":"occurredAt","收入":"examRevenue","成本":"examCost"}','{"recordType":{"const":"exam"},"examId":{"required":true},"deviceId":{"required":true},"examRevenue":{"type":"number"},"examCost":{"type":"number"}}',1,'active',1),
  ('template-billing-revenue',NULL,'billing_revenue','收费与收入','revenue','["sourceRecordId","amount"]','["deviceId","examId","chargeItem","refundAmount","occurredAt"]','{"来源记录号":"sourceRecordId","金额":"amount","设备编号":"deviceId","检查号":"examId","收费项目":"chargeItem","退费金额":"refundAmount"}','{"amount":{"type":"number"}}',1,'active',1),
  ('template-cost-detail',NULL,'cost_detail','成本明细','cost','["deviceId","costType","amount"]','["period","department","sourceDocument"]','{"设备编号":"deviceId","成本类型":"costType","金额":"amount","期间":"period","科室":"department"}','{"recordType":{"const":"cost"},"deviceId":{"required":true},"amount":{"type":"number"}}',1,'active',1),
  ('template-maintenance',NULL,'maintenance','维修保养','maintenance','["deviceId","occurredAt"]','["eventType","downtimeHours","maintenanceCost","status"]','{"设备编号":"deviceId","事件时间":"occurredAt","事件类型":"eventType","停机小时":"downtimeHours","维修费用":"maintenanceCost"}','{"deviceId":{"required":true}}',1,'active',1),
  ('template-utilization',NULL,'utilization','开机与利用率','utilization','["deviceId","period","scheduledMinutes"]','["poweredMinutes","availableMinutes","activeMinutes","downtimeMinutes"]','{"设备编号":"deviceId","统计日期":"period","统计期间":"period","期间":"period","计划时间":"scheduledMinutes","排班分钟":"scheduledMinutes","开机时间":"poweredMinutes","可用时间":"availableMinutes","作业时间":"activeMinutes","停机时间":"downtimeMinutes"}','{"recordType":{"const":"utilization"},"deviceId":{"required":true},"scheduledMinutes":{"type":"number"}}',1,'active',1),
  ('template-quality-safety',NULL,'quality_safety','质量与安全','quality','["eventId","eventDate"]','["deviceId","eventType","severity","correctiveAction"]','{"事件编号":"eventId","事件日期":"eventDate","设备编号":"deviceId","事件类型":"eventType","严重程度":"severity","整改措施":"correctiveAction"}','{}',1,'active',1),
  ('template-target-budget',NULL,'target_budget','目标与预算','target','["metricCode","period","targetValue"]','["department","budgetAmount","owner"]','{"指标编码":"metricCode","期间":"period","目标值":"targetValue","责任部门":"department","预算金额":"budgetAmount"}','{"recordType":{"const":"metric"},"targetValue":{"type":"number"}}',1,'active',1);
