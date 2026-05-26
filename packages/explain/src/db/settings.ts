import type { ExplainMode } from '@atmosfera/db';
import { getDb } from './client';

const DEFAULT_MODE: ExplainMode = 'everywhere';

interface SettingsRow {
  mode: string;
}

/** Per-guild Explain availability mode. Absent row ⇒ 'everywhere'. */
export function getExplainMode(guildId: string): ExplainMode {
  const row = getDb()
    .prepare('SELECT mode FROM explain_guild_settings WHERE guild_id = ?')
    .get(guildId) as SettingsRow | null;
  return row ? (row.mode as ExplainMode) : DEFAULT_MODE;
}

export interface SetExplainModeInput {
  guildId: string;
  mode: ExplainMode;
  setBy: string;
}

export function setExplainMode(input: SetExplainModeInput): { previous: ExplainMode } {
  const previous = getExplainMode(input.guildId);
  getDb()
    .prepare(
      `INSERT INTO explain_guild_settings (guild_id, mode, set_by, set_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET
         mode = excluded.mode,
         set_by = excluded.set_by,
         set_at = excluded.set_at`,
    )
    .run(input.guildId, input.mode, input.setBy, Date.now());
  return { previous };
}

/** Whether the per-guild Explain application command should exist (visible). */
export function shouldExplainExist(mode: ExplainMode): boolean {
  return mode !== 'off';
}
