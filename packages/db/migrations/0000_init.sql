CREATE TABLE `aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`query` text NOT NULL,
	`scope` text NOT NULL,
	`guild_id` text DEFAULT '' NOT NULL,
	`user_id` text DEFAULT '' NOT NULL,
	`city_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aliases_scope_lookup_idx` ON `aliases` (`query`,`scope`,`guild_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `cities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`canonical_name` text NOT NULL,
	`region` text,
	`country` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`timezone` text NOT NULL,
	`population` integer,
	`open_meteo_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cities_open_meteo_id_idx` ON `cities` (`open_meteo_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cities_latlon_idx` ON `cities` (`latitude`,`longitude`);