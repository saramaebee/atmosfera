CREATE TABLE `activity_hourly` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`hour_bucket` integer NOT NULL,
	`msg_count` integer DEFAULT 0 NOT NULL,
	`total_length` integer DEFAULT 0 NOT NULL,
	`mention_count` integer DEFAULT 0 NOT NULL,
	`attachment_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`, `channel_id`, `hour_bucket`)
);
--> statement-breakpoint
CREATE INDEX `idx_activity_hourly_guild_user` ON `activity_hourly` (`guild_id`,`user_id`,`hour_bucket`);--> statement-breakpoint
CREATE INDEX `idx_activity_hourly_guild_channel` ON `activity_hourly` (`guild_id`,`channel_id`,`hour_bucket`);--> statement-breakpoint
CREATE TABLE `activity_recent` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`length_bucket` integer NOT NULL,
	`has_attachment` integer DEFAULT 0 NOT NULL,
	`is_reply` integer DEFAULT 0 NOT NULL,
	`mention_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_activity_recent_guild_user_time` ON `activity_recent` (`guild_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_activity_recent_created` ON `activity_recent` (`created_at`);--> statement-breakpoint
CREATE TABLE `brutal_optin` (
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`opted_in_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `guild_id`)
);
--> statement-breakpoint
CREATE TABLE `guild_config` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`indexing_enabled` integer DEFAULT 0 NOT NULL,
	`slash_enabled` integer DEFAULT 1 NOT NULL,
	`message_enabled` integer DEFAULT 1 NOT NULL,
	`brutal_allowed` integer DEFAULT 0 NOT NULL,
	`indexing_enabled_at` integer
);
--> statement-breakpoint
CREATE TABLE `interactions` (
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`author_id` text NOT NULL,
	`target_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_interactions_guild_author_time` ON `interactions` (`guild_id`,`author_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_interactions_guild_target_time` ON `interactions` (`guild_id`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_interactions_created` ON `interactions` (`created_at`);--> statement-breakpoint
CREATE TABLE `pinned_roast_votes` (
	`invocation_id` text NOT NULL,
	`voter_id` text NOT NULL,
	`voted_at` integer NOT NULL,
	PRIMARY KEY(`invocation_id`, `voter_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_pinned_roast_votes_invocation` ON `pinned_roast_votes` (`invocation_id`);--> statement-breakpoint
CREATE TABLE `pinned_roasts` (
	`invocation_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`target_id` text NOT NULL,
	`invoker_id` text NOT NULL,
	`tone` text NOT NULL,
	`roast_text` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text NOT NULL,
	`pinned_at` integer NOT NULL,
	`roast_created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pinned_roasts_guild_target_pinned` ON `pinned_roasts` (`guild_id`,`target_id`,`pinned_at`);--> statement-breakpoint
CREATE TABLE `roast_history` (
	`invocation_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`target_id` text NOT NULL,
	`invoker_id` text NOT NULL,
	`tone` text NOT NULL,
	`created_at` integer NOT NULL,
	`angle_titles_json` text NOT NULL,
	`referenced_partner_ids_json` text NOT NULL,
	`searched_keywords_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_roast_history_guild_target_time` ON `roast_history` (`guild_id`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_roast_history_created` ON `roast_history` (`created_at`);--> statement-breakpoint
CREATE TABLE `roast_optout` (
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`opted_out` integer NOT NULL,
	`locked_until` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `guild_id`)
);
