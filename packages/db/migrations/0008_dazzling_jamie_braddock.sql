CREATE TABLE `explain_guild_roles` (
	`guild_id` text NOT NULL,
	`role_id` text NOT NULL,
	`language` text NOT NULL,
	`tier` text NOT NULL,
	`set_by` text NOT NULL,
	`set_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `role_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_explain_guild_roles_guild_lang` ON `explain_guild_roles` (`guild_id`,`language`);