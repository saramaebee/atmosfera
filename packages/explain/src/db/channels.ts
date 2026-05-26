import type { ExplainGuildChannelRow, ExplainMode } from '@atmosfera/db';
import { getDb } from './client';
import { getExplainMode, setExplainMode } from './settings';

interface ChannelRow {
  guild_id: string;
  channel_id: string;
  set_by: string;
  set_at: number;
}

function rowToChannel(r: ChannelRow): ExplainGuildChannelRow {
  return {
    guildId: r.guild_id,
    channelId: r.channel_id,
    setBy: r.set_by,
    setAt: r.set_at,
  };
}

export function listExplainChannels(guildId: string): ExplainGuildChannelRow[] {
  const rows = getDb()
    .prepare(
      'SELECT guild_id, channel_id, set_by, set_at FROM explain_guild_channels WHERE guild_id = ? ORDER BY set_at, channel_id',
    )
    .all(guildId) as ChannelRow[];
  return rows.map(rowToChannel);
}

/**
 * Invocation-time gate. Driven by the guild's mode:
 *   'off'        → never allowed
 *   'everywhere' → always allowed
 *   'allowlist'  → only channels present in explain_guild_channels
 */
export function isExplainAllowedInChannel(guildId: string, channelId: string): boolean {
  const mode = getExplainMode(guildId);
  if (mode === 'off') return false;
  if (mode === 'everywhere') return true;
  const match = getDb()
    .prepare('SELECT 1 FROM explain_guild_channels WHERE guild_id = ? AND channel_id = ? LIMIT 1')
    .get(guildId, channelId);
  return match != null;
}

export interface AddExplainChannelInput {
  guildId: string;
  channelId: string;
  setBy: string;
}

/**
 * Adds a channel to the allowlist and activates allowlist mode (so the
 * restriction takes effect immediately). `added` is false if it was already
 * present. Returns the resulting mode (always 'allowlist').
 */
export function addExplainChannel(input: AddExplainChannelInput): {
  added: boolean;
  mode: ExplainMode;
} {
  const db = getDb();
  const existing = db
    .prepare('SELECT 1 FROM explain_guild_channels WHERE guild_id = ? AND channel_id = ? LIMIT 1')
    .get(input.guildId, input.channelId);
  const added = existing == null;
  if (added) {
    db.prepare(
      'INSERT INTO explain_guild_channels (guild_id, channel_id, set_by, set_at) VALUES (?, ?, ?, ?)',
    ).run(input.guildId, input.channelId, input.setBy, Date.now());
  }
  setExplainMode({ guildId: input.guildId, mode: 'allowlist', setBy: input.setBy });
  return { added, mode: 'allowlist' };
}

export interface RemoveExplainChannelInput {
  guildId: string;
  channelId: string;
  setBy: string;
}

/**
 * Removes a channel from the allowlist. If that empties the list while in
 * 'allowlist' mode, the guild reverts to 'everywhere' (Explain works in every
 * channel again). Returns the removed row (or null) and the resulting mode.
 */
export function removeExplainChannel(input: RemoveExplainChannelInput): {
  removed: ExplainGuildChannelRow | null;
  mode: ExplainMode;
} {
  const db = getDb();
  const prev = db
    .prepare(
      'SELECT guild_id, channel_id, set_by, set_at FROM explain_guild_channels WHERE guild_id = ? AND channel_id = ?',
    )
    .get(input.guildId, input.channelId) as ChannelRow | null;
  if (!prev) {
    return { removed: null, mode: getExplainMode(input.guildId) };
  }
  db.prepare('DELETE FROM explain_guild_channels WHERE guild_id = ? AND channel_id = ?').run(
    input.guildId,
    input.channelId,
  );

  let mode = getExplainMode(input.guildId);
  const remaining = listExplainChannels(input.guildId);
  if (remaining.length === 0 && mode === 'allowlist') {
    setExplainMode({ guildId: input.guildId, mode: 'everywhere', setBy: input.setBy });
    mode = 'everywhere';
  }
  return { removed: rowToChannel(prev), mode };
}
