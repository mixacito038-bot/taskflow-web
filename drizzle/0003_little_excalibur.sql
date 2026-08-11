CREATE TABLE `account_cloud_preferences` (
	`account_id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'clinical' NOT NULL,
	`density` text DEFAULT 'comfortable' NOT NULL,
	`content_zoom` real DEFAULT 1.1 NOT NULL,
	`notification_preferences_json` text DEFAULT '{}' NOT NULL,
	`read_notification_ids_json` text DEFAULT '[]' NOT NULL,
	`active_hospital_id` text,
	`department` text DEFAULT '全部科室' NOT NULL,
	`period` text DEFAULT '2026年度' NOT NULL,
	`perspective` text DEFAULT '管理层' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `hospital_cloud_resources` (
	`hospital_id` text NOT NULL,
	`resource` text NOT NULL,
	`value_json` text DEFAULT '[]' NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`updated_by_account_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`hospital_id`, `resource`),
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `report_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`report_id` text,
	`actor_account_id` text,
	`file_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`report_id`) REFERENCES `benefit_reports`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_artifacts_file_key_unique` ON `report_artifacts` (`file_key`);