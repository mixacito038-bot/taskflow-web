CREATE TABLE `data_cleaning_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`data_domain` text NOT NULL,
	`name` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_by_account_id` text NOT NULL,
	`updated_by_account_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_cleaning_recipes_hospital_name_version_unique` ON `data_cleaning_recipes` (`hospital_id`,`data_domain`,`name`,`version`);--> statement-breakpoint
CREATE TABLE `data_cleaning_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`rule_type` text NOT NULL,
	`field_name` text DEFAULT '' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `data_cleaning_recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_cleaning_rules_recipe_sequence_unique` ON `data_cleaning_rules` (`recipe_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `data_cleaning_rules_hospital_recipe_idx` ON `data_cleaning_rules` (`hospital_id`,`recipe_id`);--> statement-breakpoint
CREATE TABLE `data_field_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`connector_id` text,
	`data_domain` text NOT NULL,
	`name` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`mapping_json` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by_account_id` text NOT NULL,
	`updated_by_account_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_id`) REFERENCES `data_source_connectors`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_field_mappings_hospital_domain_version_unique` ON `data_field_mappings` (`hospital_id`,`data_domain`,`name`,`version`);--> statement-breakpoint
CREATE INDEX `data_field_mappings_hospital_status_idx` ON `data_field_mappings` (`hospital_id`,`status`);--> statement-breakpoint
CREATE TABLE `data_import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`connector_id` text,
	`data_domain` text NOT NULL,
	`ingestion_mode` text NOT NULL,
	`file_name` text DEFAULT '' NOT NULL,
	`object_key` text DEFAULT '' NOT NULL,
	`sha256` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`accepted_count` integer DEFAULT 0 NOT NULL,
	`rejected_count` integer DEFAULT 0 NOT NULL,
	`error_code` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_account_id` text NOT NULL,
	`reviewed_by_account_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_id`) REFERENCES `data_source_connectors`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `data_import_jobs_hospital_status_idx` ON `data_import_jobs` (`hospital_id`,`status`);--> statement-breakpoint
CREATE INDEX `data_import_jobs_hospital_domain_idx` ON `data_import_jobs` (`hospital_id`,`data_domain`);--> statement-breakpoint
CREATE TABLE `data_lineage_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hospital_id` text NOT NULL,
	`actor_account_id` text,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`from_status` text DEFAULT '' NOT NULL,
	`to_status` text DEFAULT '' NOT NULL,
	`import_job_id` text,
	`dataset_version` text DEFAULT '' NOT NULL,
	`mapping_version` text DEFAULT '' NOT NULL,
	`rule_version` text DEFAULT '' NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_job_id`) REFERENCES `data_import_jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `data_lineage_events_hospital_created_idx` ON `data_lineage_events` (`hospital_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `data_lineage_events_hospital_resource_idx` ON `data_lineage_events` (`hospital_id`,`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `data_publish_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`series_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`data_domain` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`source_import_ids_json` text DEFAULT '[]' NOT NULL,
	`manifest_json` text DEFAULT '{}' NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`mapping_version` text DEFAULT '' NOT NULL,
	`rule_version` text DEFAULT '' NOT NULL,
	`review_comment` text DEFAULT '' NOT NULL,
	`created_by_account_id` text NOT NULL,
	`reviewed_by_account_id` text,
	`published_by_account_id` text,
	`reviewed_at` text,
	`published_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`published_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_publish_versions_hospital_series_version_unique` ON `data_publish_versions` (`hospital_id`,`series_id`,`version`);--> statement-breakpoint
CREATE INDEX `data_publish_versions_hospital_status_idx` ON `data_publish_versions` (`hospital_id`,`status`);--> statement-breakpoint
CREATE TABLE `data_quality_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`import_job_id` text,
	`raw_dataset_id` text,
	`rule_code` text NOT NULL,
	`field_name` text DEFAULT '' NOT NULL,
	`severity` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`affected_rows` integer DEFAULT 0 NOT NULL,
	`message` text NOT NULL,
	`sample_json` text DEFAULT '[]' NOT NULL,
	`resolution_comment` text DEFAULT '' NOT NULL,
	`resolved_by_account_id` text,
	`resolved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_job_id`) REFERENCES `data_import_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`raw_dataset_id`) REFERENCES `raw_datasets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `data_quality_issues_hospital_status_idx` ON `data_quality_issues` (`hospital_id`,`status`);--> statement-breakpoint
CREATE INDEX `data_quality_issues_hospital_job_idx` ON `data_quality_issues` (`hospital_id`,`import_job_id`);--> statement-breakpoint
CREATE TABLE `data_source_connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`source_type` text NOT NULL,
	`transport_type` text NOT NULL,
	`endpoint` text DEFAULT '' NOT NULL,
	`credential_ref` text DEFAULT '' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_account_id` text NOT NULL,
	`updated_by_account_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_source_connectors_hospital_code_unique` ON `data_source_connectors` (`hospital_id`,`code`);--> statement-breakpoint
CREATE INDEX `data_source_connectors_hospital_status_idx` ON `data_source_connectors` (`hospital_id`,`status`);--> statement-breakpoint
CREATE TABLE `raw_datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`import_job_id` text NOT NULL,
	`connector_id` text,
	`object_key` text DEFAULT '' NOT NULL,
	`content_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`sha256` text DEFAULT '' NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`schema_json` text DEFAULT '{}' NOT NULL,
	`profile_json` text DEFAULT '{}' NOT NULL,
	`retention_until` text,
	`created_by_account_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_job_id`) REFERENCES `data_import_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_id`) REFERENCES `data_source_connectors`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_datasets_hospital_job_unique` ON `raw_datasets` (`hospital_id`,`import_job_id`);--> statement-breakpoint
CREATE INDEX `raw_datasets_hospital_created_idx` ON `raw_datasets` (`hospital_id`,`created_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `permissions` (`code`, `module`, `name`, `risk`) VALUES
  ('connector.manage', 'data-workbench', '管理数据连接', 'high'),
  ('data.ingest', 'data-workbench', '导入与登记原始数据', 'high'),
  ('data.clean', 'data-workbench', '配置映射、清洗与质量规则', 'high'),
  ('data.review', 'data-workbench', '审核数据批次与发布版本', 'high'),
  ('data.publish', 'data-workbench', '发布、撤回与替代数据版本', 'high');
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission_code`)
SELECT 'role-platform-admin', `code`
FROM `permissions`
WHERE `code` IN ('connector.manage', 'data.ingest', 'data.clean', 'data.review', 'data.publish')
  AND EXISTS (SELECT 1 FROM `roles` WHERE `id` = 'role-platform-admin');
