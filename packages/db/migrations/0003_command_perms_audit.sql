CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text,
	`actor_id` text NOT NULL,
	`event_type` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_guild_time` ON `audit_log` (`guild_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_log_event_time` ON `audit_log` (`event_type`,`created_at`);--> statement-breakpoint
CREATE TABLE `command_permission_rules` (
	`guild_id` text NOT NULL,
	`command_name` text NOT NULL,
	`principal_type` text NOT NULL,
	`principal_id` text NOT NULL,
	`effect` text NOT NULL,
	`granted_by` text NOT NULL,
	`granted_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `command_name`, `principal_type`, `principal_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_cmd_perm_rules_guild_cmd` ON `command_permission_rules` (`guild_id`,`command_name`);