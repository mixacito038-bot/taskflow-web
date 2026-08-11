CREATE TABLE `audit_policies` (
	`hospital_id` text PRIMARY KEY NOT NULL,
	`retention_days` integer DEFAULT 365 NOT NULL,
	`review_cycle_months` integer DEFAULT 3 NOT NULL,
	`invitation_expiry_days` integer DEFAULT 7 NOT NULL,
	`denial_alert_threshold` integer DEFAULT 5 NOT NULL,
	`export_format` text DEFAULT 'csv' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hospital_id`) REFERENCES `hospitals`(`id`) ON UPDATE no action ON DELETE cascade
);
