import { getEnv } from '@atmosfera/config';
import { getDb } from './client';

export interface GuildConfig {
  guild_id: string;
  indexing_enabled: boolean;
  slash_enabled: boolean;
  message_enabled: boolean;
  brutal_allowed: boolean;
  indexing_enabled_at: number | null;
  /** Per-guild overrides for the roast pipeline. null = use env default. */
  roast_hypothesize_max_iterations: number | null;
  roast_synthesize_max_iterations: number | null;
  roast_temperature_sharp: number | null;
  roast_temperature_brutal: number | null;
  roast_thinking_budget: number | null;
  roast_min_tool_calls: number | null;
  roast_deemphasize_channel_dist: boolean | null;
}

interface GuildConfigRow {
  guild_id: string;
  indexing_enabled: number;
  slash_enabled: number;
  message_enabled: number;
  brutal_allowed: number;
  indexing_enabled_at: number | null;
  roast_hypothesize_max_iterations: number | null;
  roast_synthesize_max_iterations: number | null;
  roast_temperature_sharp: number | null;
  roast_temperature_brutal: number | null;
  roast_thinking_budget: number | null;
  roast_min_tool_calls: number | null;
  roast_deemphasize_channel_dist: number | null;
}

function rowToConfig(row: GuildConfigRow): GuildConfig {
  return {
    guild_id: row.guild_id,
    indexing_enabled: row.indexing_enabled === 1,
    slash_enabled: row.slash_enabled === 1,
    message_enabled: row.message_enabled === 1,
    brutal_allowed: row.brutal_allowed === 1,
    indexing_enabled_at: row.indexing_enabled_at,
    roast_hypothesize_max_iterations: row.roast_hypothesize_max_iterations,
    roast_synthesize_max_iterations: row.roast_synthesize_max_iterations,
    roast_temperature_sharp: row.roast_temperature_sharp,
    roast_temperature_brutal: row.roast_temperature_brutal,
    roast_thinking_budget: row.roast_thinking_budget,
    roast_min_tool_calls: row.roast_min_tool_calls,
    roast_deemphasize_channel_dist:
      row.roast_deemphasize_channel_dist == null ? null : row.roast_deemphasize_channel_dist === 1,
  };
}

const DEFAULT_CONFIG = (guildId: string): GuildConfig => ({
  guild_id: guildId,
  indexing_enabled: false,
  slash_enabled: true,
  message_enabled: true,
  brutal_allowed: false,
  indexing_enabled_at: null,
  roast_hypothesize_max_iterations: null,
  roast_synthesize_max_iterations: null,
  roast_temperature_sharp: null,
  roast_temperature_brutal: null,
  roast_thinking_budget: null,
  roast_min_tool_calls: null,
  roast_deemphasize_channel_dist: null,
});

export function getGuildConfig(guildId: string): GuildConfig {
  const row = getDb().prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId) as
    | GuildConfigRow
    | undefined;
  return row ? rowToConfig(row) : DEFAULT_CONFIG(guildId);
}

/**
 * Effective roast pipeline tuning values for a guild — per-guild override if
 * present, otherwise the env default. This is the single read point for the
 * pipeline (hypothesize.ts / synthesize.ts / fingerprint.ts). Captured into
 * the trace row so we can tell after the fact what limits were in play.
 */
export interface EffectiveRoastKnobs {
  hypothesizeMaxIterations: number;
  synthesizeMaxIterations: number;
  temperatureSharp: number;
  temperatureBrutal: number;
  thinkingBudget: number;
  minToolCalls: number;
  deemphasizeChannelDist: boolean;
  /** Where each knob came from — written into knobs_json on the trace. */
  source: Record<keyof Omit<EffectiveRoastKnobs, 'source'>, 'env' | 'guild'>;
}

export function getEffectiveRoastKnobs(guildId: string): EffectiveRoastKnobs {
  const cfg = getGuildConfig(guildId);
  const env = getEnv();
  const pick = <T>(override: T | null, fallback: T): { value: T; src: 'env' | 'guild' } =>
    override == null ? { value: fallback, src: 'env' } : { value: override, src: 'guild' };

  const a = pick(cfg.roast_hypothesize_max_iterations, env.ROAST_HYPOTHESIZE_MAX_TOOL_ITERATIONS);
  const b = pick(cfg.roast_synthesize_max_iterations, env.ROAST_MAX_TOOL_ITERATIONS);
  const c = pick(cfg.roast_temperature_sharp, env.ROAST_TEMPERATURE_SHARP);
  const d = pick(cfg.roast_temperature_brutal, env.ROAST_TEMPERATURE_BRUTAL);
  const e = pick(cfg.roast_thinking_budget, env.ROAST_THINKING_BUDGET);
  const f = pick(cfg.roast_min_tool_calls, env.ROAST_MIN_TOOL_CALLS);
  const g = pick(cfg.roast_deemphasize_channel_dist, env.ROAST_DEEMPHASIZE_CHANNEL_DIST);

  return {
    hypothesizeMaxIterations: a.value,
    synthesizeMaxIterations: b.value,
    temperatureSharp: c.value,
    temperatureBrutal: d.value,
    thinkingBudget: e.value,
    minToolCalls: f.value,
    deemphasizeChannelDist: g.value,
    source: {
      hypothesizeMaxIterations: a.src,
      synthesizeMaxIterations: b.src,
      temperatureSharp: c.src,
      temperatureBrutal: d.src,
      thinkingBudget: e.src,
      minToolCalls: f.src,
      deemphasizeChannelDist: g.src,
    },
  };
}

/** Knob fields settable via the admin surfaces. Null clears the override. */
export type RoastKnobName =
  | 'roast_hypothesize_max_iterations'
  | 'roast_synthesize_max_iterations'
  | 'roast_temperature_sharp'
  | 'roast_temperature_brutal'
  | 'roast_thinking_budget'
  | 'roast_min_tool_calls'
  | 'roast_deemphasize_channel_dist';

const KNOB_COLUMNS: ReadonlySet<RoastKnobName> = new Set<RoastKnobName>([
  'roast_hypothesize_max_iterations',
  'roast_synthesize_max_iterations',
  'roast_temperature_sharp',
  'roast_temperature_brutal',
  'roast_thinking_budget',
  'roast_min_tool_calls',
  'roast_deemphasize_channel_dist',
]);

/**
 * Set a single knob override (or clear it with `null`). Returns the row's
 * effective config after the write — callers want this so they can pass
 * before/after to the audit log.
 */
export function setRoastKnob(
  guildId: string,
  name: RoastKnobName,
  value: number | boolean | null,
): GuildConfig {
  if (!KNOB_COLUMNS.has(name)) throw new Error(`unknown knob: ${name}`);
  ensureRow(guildId);
  const stored: number | null =
    value == null ? null : typeof value === 'boolean' ? (value ? 1 : 0) : value;
  getDb().prepare(`UPDATE guild_config SET ${name} = ? WHERE guild_id = ?`).run(stored, guildId);
  return getGuildConfig(guildId);
}

export function listIndexedGuilds(): string[] {
  const rows = getDb()
    .prepare('SELECT guild_id FROM guild_config WHERE indexing_enabled = 1')
    .all() as { guild_id: string }[];
  return rows.map((r) => r.guild_id);
}

export function setIndexingEnabled(guildId: string, enabled: boolean): void {
  const now = enabled ? Date.now() : null;
  getDb()
    .prepare(
      `INSERT INTO guild_config (guild_id, indexing_enabled, indexing_enabled_at)
       VALUES (?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET
         indexing_enabled = excluded.indexing_enabled,
         indexing_enabled_at = excluded.indexing_enabled_at`,
    )
    .run(guildId, enabled ? 1 : 0, now);
}

export function setSlashEnabled(guildId: string, enabled: boolean): void {
  ensureRow(guildId);
  getDb()
    .prepare('UPDATE guild_config SET slash_enabled = ? WHERE guild_id = ?')
    .run(enabled ? 1 : 0, guildId);
}

export function setMessageEnabled(guildId: string, enabled: boolean): void {
  ensureRow(guildId);
  getDb()
    .prepare('UPDATE guild_config SET message_enabled = ? WHERE guild_id = ?')
    .run(enabled ? 1 : 0, guildId);
}

export function setBrutalAllowed(guildId: string, allowed: boolean): void {
  ensureRow(guildId);
  getDb()
    .prepare('UPDATE guild_config SET brutal_allowed = ? WHERE guild_id = ?')
    .run(allowed ? 1 : 0, guildId);
}

function ensureRow(guildId: string): void {
  getDb()
    .prepare('INSERT INTO guild_config (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING')
    .run(guildId);
}

export function setBrutalOptin(userId: string, guildId: string): void {
  getDb()
    .prepare(
      `INSERT INTO brutal_optin (user_id, guild_id, opted_in_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id, guild_id) DO UPDATE SET opted_in_at = excluded.opted_in_at`,
    )
    .run(userId, guildId, Date.now());
}

export function clearBrutalOptin(userId: string, guildId: string): void {
  getDb()
    .prepare('DELETE FROM brutal_optin WHERE user_id = ? AND guild_id = ?')
    .run(userId, guildId);
}

export function hasBrutalOptin(userId: string, guildId: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 AS one FROM brutal_optin WHERE user_id = ? AND guild_id = ?')
    .get(userId, guildId) as { one: number } | null;
  // bun:sqlite's `.get()` returns null (not undefined) when no row matches —
  // `row !== undefined` would always be true for `null`.
  return row != null;
}

export const OPTOUT_LOCK_MS = 30 * 24 * 60 * 60 * 1000;

export interface RoastOptoutState {
  optedOut: boolean;
  lockedUntil: number | null;
}

interface RoastOptoutRow {
  opted_out: number;
  locked_until: number | null;
}

export function getRoastOptoutState(userId: string, guildId: string): RoastOptoutState {
  const row = getDb()
    .prepare('SELECT opted_out, locked_until FROM roast_optout WHERE user_id = ? AND guild_id = ?')
    .get(userId, guildId) as RoastOptoutRow | undefined;
  if (!row) return { optedOut: false, lockedUntil: null };
  return { optedOut: row.opted_out === 1, lockedUntil: row.locked_until };
}

export function setRoastOptedOut(userId: string, guildId: string): void {
  getDb()
    .prepare(
      `INSERT INTO roast_optout (user_id, guild_id, opted_out, locked_until, updated_at)
       VALUES (?, ?, 1, NULL, ?)
       ON CONFLICT(user_id, guild_id) DO UPDATE SET
         opted_out = 1,
         locked_until = NULL,
         updated_at = excluded.updated_at`,
    )
    .run(userId, guildId, Date.now());
}

export function setRoastOptedIn(userId: string, guildId: string, lockMs: number): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO roast_optout (user_id, guild_id, opted_out, locked_until, updated_at)
       VALUES (?, ?, 0, ?, ?)
       ON CONFLICT(user_id, guild_id) DO UPDATE SET
         opted_out = 0,
         locked_until = excluded.locked_until,
         updated_at = excluded.updated_at`,
    )
    .run(userId, guildId, now + lockMs, now);
}
