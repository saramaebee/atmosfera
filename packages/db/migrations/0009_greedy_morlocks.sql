CREATE TABLE `explain_guild_channels` (
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`set_by` text NOT NULL,
	`set_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `channel_id`)
);
