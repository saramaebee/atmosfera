import { inArray } from 'drizzle-orm';
import type { Db } from './client';
import { type DiscordUserCacheRow, discordUserCache } from './schema';

export interface UpsertDiscordUserInput {
  userId: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
}

export function upsertDiscordUser(db: Db, input: UpsertDiscordUserInput): void {
  const now = Date.now();
  db.insert(discordUserCache)
    .values({
      userId: input.userId,
      username: input.username,
      globalName: input.globalName,
      avatarHash: input.avatarHash,
      fetchedAt: now,
    })
    .onConflictDoUpdate({
      target: discordUserCache.userId,
      set: {
        username: input.username,
        globalName: input.globalName,
        avatarHash: input.avatarHash,
        fetchedAt: now,
      },
    })
    .run();
}

export function getDiscordUsers(db: Db, userIds: string[]): Map<string, DiscordUserCacheRow> {
  if (userIds.length === 0) return new Map();
  const rows = db
    .select()
    .from(discordUserCache)
    .where(inArray(discordUserCache.userId, userIds))
    .all();
  return new Map(rows.map((r) => [r.userId, r]));
}
