CREATE TABLE `data_exam_event_body_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`exam_event_id` text NOT NULL,
	`body_part_code` text NOT NULL,
	`body_part_name` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`sequence` integer DEFAULT 1 NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exam_event_id`) REFERENCES `data_exam_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_exam_body_parts_event_code_unique` ON `data_exam_event_body_parts` (`exam_event_id`,`body_part_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `data_exam_body_parts_one_primary_unique` ON `data_exam_event_body_parts` (`exam_event_id`) WHERE "data_exam_event_body_parts"."is_primary" = 1;--> statement-breakpoint
CREATE INDEX `data_exam_body_parts_hospital_event_idx` ON `data_exam_event_body_parts` (`hospital_id`,`exam_event_id`);--> statement-breakpoint
CREATE TABLE `data_exam_events` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`import_job_id` text,
	`source_event_key` text NOT NULL,
	`device_key` text NOT NULL,
	`encounter_key` text DEFAULT '' NOT NULL,
	`patient_key` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL,
	`revenue_cents` integer DEFAULT 0 NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_by_account_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_job_id`) REFERENCES `data_import_jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_exam_events_hospital_source_key_unique` ON `data_exam_events` (`hospital_id`,`source_event_key`);--> statement-breakpoint
CREATE INDEX `data_exam_events_hospital_occurred_idx` ON `data_exam_events` (`hospital_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `data_field_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`data_type` text NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`dictionary_json` text DEFAULT '{}' NOT NULL,
	`validation_json` text DEFAULT '{}' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
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
CREATE UNIQUE INDEX `data_field_definitions_hospital_code_version_unique` ON `data_field_definitions` (`hospital_id`,`code`,`version`);--> statement-breakpoint
CREATE INDEX `data_field_definitions_hospital_status_idx` ON `data_field_definitions` (`hospital_id`,`status`);--> statement-breakpoint
CREATE TABLE `data_metric_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`formula` text NOT NULL,
	`aggregation` text NOT NULL,
	`numerator` text DEFAULT '' NOT NULL,
	`denominator` text DEFAULT '' NOT NULL,
	`dimensions_json` text DEFAULT '[]' NOT NULL,
	`source_field_refs_json` text DEFAULT '[]' NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
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
CREATE UNIQUE INDEX `data_metric_definitions_hospital_code_version_unique` ON `data_metric_definitions` (`hospital_id`,`code`,`version`);--> statement-breakpoint
CREATE INDEX `data_metric_definitions_hospital_status_idx` ON `data_metric_definitions` (`hospital_id`,`status`);--> statement-breakpoint
CREATE TABLE `data_visualization_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`hospital_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`metric_id` text NOT NULL,
	`chart_type` text NOT NULL,
	`dimension` text DEFAULT '' NOT NULL,
	`series_json` text DEFAULT '[]' NOT NULL,
	`sort_json` text DEFAULT '{}' NOT NULL,
	`limit` integer DEFAULT 20 NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_account_id` text NOT NULL,
	`updated_by_account_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`metric_id`) REFERENCES `data_metric_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_visualizations_hospital_code_version_unique` ON `data_visualization_definitions` (`hospital_id`,`code`,`version`);--> statement-breakpoint
CREATE INDEX `data_visualizations_hospital_metric_idx` ON `data_visualization_definitions` (`hospital_id`,`metric_id`);