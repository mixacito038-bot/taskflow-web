CREATE TABLE `benefit_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`series_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`title` text NOT NULL,
	`period` text NOT NULL,
	`scope` text DEFAULT 'hospital' NOT NULL,
	`config_json` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`quality_score` integer DEFAULT 0 NOT NULL,
	`blocking_count` integer DEFAULT 0 NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`warning_acknowledged` integer DEFAULT false NOT NULL,
	`created_by_account_id` text NOT NULL,
	`reviewed_by_account_id` text,
	`approved_by_account_id` text,
	`review_comment` text DEFAULT '' NOT NULL,
	`submitted_at` text,
	`reviewed_at` text,
	`issued_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `benefit_reports_series_version_unique` ON `benefit_reports` (`series_id`,`version`);--> statement-breakpoint
CREATE TABLE `report_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hospital_id` text NOT NULL,
	`report_id` text,
	`actor_account_id` text,
	`action` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`report_id`) REFERENCES `benefit_reports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `report_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`config_json` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_by_account_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_templates_hospital_name_unique` ON `report_templates` (`hospital_id`,`name`);