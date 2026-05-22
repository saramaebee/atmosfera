CREATE TABLE `bot_guilds` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon_hash` text,
	`member_count` integer,
	`joined_at` integer NOT NULL,
	`left_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_bot_guilds_left_at` ON `bot_guilds` (`left_at`);--> statement-breakpoint
CREATE TABLE `discord_user_cache` (
	`user_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`global_name` text,
	`avatar_hash` text,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `web_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`discord_user_id` text NOT NULL,
	`discord_username` text NOT NULL,
	`discord_global_name` text,
	`discord_avatar_hash` text,
	`access_token_enc` text NOT NULL,
	`refresh_token_enc` text NOT NULL,
	`access_token_expires_at` integer NOT NULL,
	`oauth_guilds_json` text NOT NULL,
	`oauth_guilds_fetched_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_web_sessions_user` ON `web_sessions` (`discord_user_id`);