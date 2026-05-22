CREATE TABLE `messages_recent` (
	`message_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`author_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`is_reply` integer DEFAULT 0 NOT NULL,
	`reply_to_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_messages_recent_guild_author_time` ON `messages_recent` (`guild_id`,`author_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_messages_recent_created` ON `messages_recent` (`created_at`);