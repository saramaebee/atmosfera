-- Roast feature removal. The FTS5 virtual table + triggers were hand-written
-- in 0002 (drizzle can't model FTS5), so their drops are hand-added here ahead
-- of the generated DROP TABLEs. IF EXISTS keeps this idempotent regardless of
-- drop order relative to pinned_roasts.
DROP TRIGGER IF EXISTS `pinned_roasts_ai`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `pinned_roasts_ad`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `pinned_roasts_au`;--> statement-breakpoint
DROP TABLE IF EXISTS `pinned_roasts_fts`;--> statement-breakpoint
DROP TABLE `activity_hourly`;--> statement-breakpoint
DROP TABLE `activity_recent`;--> statement-breakpoint
DROP TABLE `brutal_optin`;--> statement-breakpoint
DROP TABLE `guild_config`;--> statement-breakpoint
DROP TABLE `interactions`;--> statement-breakpoint
DROP TABLE `messages_recent`;--> statement-breakpoint
DROP TABLE `pinned_roast_votes`;--> statement-breakpoint
DROP TABLE `pinned_roasts`;--> statement-breakpoint
DROP TABLE `roast_history`;--> statement-breakpoint
DROP TABLE `roast_optout`;--> statement-breakpoint
DROP TABLE `roast_trace`;