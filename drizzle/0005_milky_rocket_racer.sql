CREATE TABLE `account_mfa_settings` (
	`account_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'disabled' NOT NULL,
	`secret_ciphertext` text,
	`secret_iv` text,
	`last_totp_counter` integer DEFAULT -1 NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`pending_expires_at` text,
	`confirmed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `account_recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_recovery_codes_hash_unique` ON `account_recovery_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `account_recovery_codes_account_used_idx` ON `account_recovery_codes` (`account_id`,`used_at`);--> statement-breakpoint
CREATE TABLE `app_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`account_id` text NOT NULL,
	`sso_email` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`idle_expires_at` text NOT NULL,
	`absolute_expires_at` text NOT NULL,
	`locked_at` text,
	`revoked_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_sessions_token_hash_unique` ON `app_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `app_sessions_account_status_idx` ON `app_sessions` (`account_id`,`status`);