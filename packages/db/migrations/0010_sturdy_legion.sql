CREATE TABLE `explain_guild_settings` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`set_by` text NOT NULL,
	`set_at` integer NOT NULL
);
