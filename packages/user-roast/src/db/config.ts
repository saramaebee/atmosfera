import { getDb } from './client';

export interface GuildConfig {
  guild_id: string;
  indexing_enabled: boolean;
  slash_enabled: boolean;
  message_enabled: boolean;
  brutal_allowed: boolean;
  indexing_enabled_at: number | null;
}

interface GuildConfigRow {
  guild_id: string;
  indexing_enabled: number;
  slash_enabled: number;
  message_enabled: number;
  brutal_allowed: number;
  indexing_enabled_at: number | null;
}

function rowToConfig(row: GuildConfigRow): GuildConfig {
  return {
    guild_id: row.guild_id,
    indexing_enabled: row.indexing_enabled === 1,
    slash_enabled: row.slash_enabled === 1,
    message_enabled: row.message_enabled === 1,
    brutal_allowed: row.brutal_allowed === 1,
    indexing_enabled_at: row.indexing_enabled_at,
  };
}

const DEFAULT_CONFIG = (guildId: string): GuildConfig => ({
  guild_id: guildId,
  indexing_enabled: false,
  slash_enabled: true,
  message_enabled: true,
  brutal_allowed: false,
  indexing_enabled_at: null,
});

export function getGuildConfig(guildId: string): GuildConfig {
  const row = getDb().prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId) as
    | GuildConfigRow
    | undefined;
  return row ? rowToConfig(row) : DEFAULT_CONFIG(guildId);
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
