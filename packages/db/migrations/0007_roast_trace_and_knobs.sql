CREATE TABLE `roast_trace` (
	`invocation_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`target_id` text NOT NULL,
	`invoker_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`tone` text NOT NULL,
	`length` text NOT NULL,
	`fingerprint_json` text NOT NULL,
	`fingerprint_summary_text` text NOT NULL,
	`hypothesis_prompt_text` text NOT NULL,
	`hypothesis_exploration_json` text NOT NULL,
	`hypothesis_json` text NOT NULL,
	`synthesis_system_text` text NOT NULL,
	`synthesis_prompt_text` text NOT NULL,
	`synthesis_json` text NOT NULL,
	`knobs_json` text NOT NULL,
	`total_messages_fetched` integer NOT NULL,
	`total_duration_ms` integer NOT NULL,
	`final_roast_text` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_roast_trace_guild_time` ON `roast_trace` (`guild_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_roast_trace_guild_target_time` ON `roast_trace` (`guild_id`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_roast_trace_created` ON `roast_trace` (`created_at`);--> statement-breakpoint
ALTER TABLE `guild_config` ADD `roast_hypothesize_max_iterations` integer;--> statement-breakpoint
ALTER TABLE `guild_config` ADD `roast_synthesize_max_iterations` integer;--> statement-breakpoint
ALTER TABLE `guild_config` ADD `roast_temperature_sharp` real;--> statement-breakpoint
ALTER TABLE `guild_config` ADD `roast_temperature_brutal` real;--> statement-breakpoint
ALTER TABLE `guild_config` ADD `roast_thinking_budget` integer;--> statement-breakpoint
ALTER TABLE `guild_config` ADD `roast_min_tool_calls` integer;--> statement-breakpoint
ALTER TABLE `guild_config` ADD `roast_deemphasize_channel_dist` integer;