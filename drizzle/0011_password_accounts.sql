CREATE TABLE `account_credentials` (
	`account_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`iterations` integer DEFAULT 210000 NOT NULL,
	`algorithm` text DEFAULT 'pbkdf2-sha256' NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`password_updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_credentials_username_unique` ON `account_credentials` (`username`);--> statement-breakpoint
ALTER TABLE `app_sessions` ADD `auth_method` text DEFAULT 'sso' NOT NULL;