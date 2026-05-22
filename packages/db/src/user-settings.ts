import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { brutalOptin, roastOptout } from './schema';

export interface NotableUserSetting {
  userId: string;
  brutalOptin: boolean;
  optedOut: boolean;
  lockedUntil: number | null;
}

/**
 * Per-guild list of users whose user-roast settings deviate from the default
 * (brutal opt-in, opted out of roasts, or inside an opt-out lock window).
 * Default state (opted in to being roasted, no brutal) is not surfaced.
 */
export function listNotableUserSettings(db: Db, guildId: string): NotableUserSetting[] {
  const optins = db.select().from(brutalOptin).where(eq(brutalOptin.guildId, guildId)).all();
  const optouts = db.select().from(roastOptout).where(eq(roastOptout.guildId, guildId)).all();

  const byUser = new Map<string, NotableUserSetting>();
  for (const row of optins) {
    byUser.set(row.userId, {
      userId: row.userId,
      brutalOptin: true,
      optedOut: false,
      lockedUntil: null,
    });
  }

  const now = Date.now();
  for (const row of optouts) {
    const note = byUser.get(row.userId) ?? {
      userId: row.userId,
      brutalOptin: false,
      optedOut: false,
      lockedUntil: null,
    };
    note.optedOut = row.optedOut === 1;
    note.lockedUntil = row.lockedUntil;
    const notable = note.optedOut || (note.lockedUntil !== null && note.lockedUntil > now);
    if (notable || byUser.has(row.userId)) {
      byUser.set(row.userId, note);
    }
  }

  return [...byUser.values()].sort((a, b) => a.userId.localeCompare(b.userId));
}
