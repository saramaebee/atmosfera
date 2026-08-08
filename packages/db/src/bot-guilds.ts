import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { Db } from './client';
import { type BotGuild, botGuilds } from './schema';

export interface UpsertBotGuildInput {
  guildId: string;
  name: string;
  iconHash: string | null;
  memberCount: number | null;
}

export function upsertBotGuild(db: Db, input: UpsertBotGuildInput): void {
  const now = Date.now();
  db.insert(botGuilds)
    .values({
      guildId: input.guildId,
      name: input.name,
      iconHash: input.iconHash,
      memberCount: input.memberCount,
      joinedAt: now,
      leftAt: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: botGuilds.guildId,
      set: {
        name: input.name,
        iconHash: input.iconHash,
        memberCount: input.memberCount,
        // joinedAt is preserved if the guild was ever joined before; if it
        // had been marked leftAt, we treat this as a re-join and refresh
        // joinedAt to the new "in" timestamp.
        joinedAt: sql`CASE WHEN ${botGuilds.leftAt} IS NULL THEN ${botGuilds.joinedAt} ELSE ${now} END`,
        leftAt: null,
        updatedAt: now,
      },
    })
    .run();
}

export function markBotGuildLeft(db: Db, guildId: string): void {
  const now = Date.now();
  db.update(botGuilds)
    .set({ leftAt: now, updatedAt: now })
    .where(and(eq(botGuilds.guildId, guildId), isNull(botGuilds.leftAt)))
    .run();
}

export function getBotGuild(db: Db, guildId: string): BotGuild | undefined {
  return db.select().from(botGuilds).where(eq(botGuilds.guildId, guildId)).get();
}

export function listActiveBotGuilds(db: Db): BotGuild[] {
  return db
    .select()
    .from(botGuilds)
    .where(isNull(botGuilds.leftAt))
    .orderBy(desc(botGuilds.memberCount))
    .all();
}

export interface ReconcileBotGuildsInput {
  presentGuildIds: Set<string>;
}

/**
 * Mark any tracked-but-not-present guild as left. Used by the bot on `ready`
 * to catch up after downtime.
 */
export function reconcileBotGuildsLeft(db: Db, input: ReconcileBotGuildsInput): number {
  const now = Date.now();
  const rows = db
    .select({ guildId: botGuilds.guildId })
    .from(botGuilds)
    .where(isNull(botGuilds.leftAt))
    .all();

  let marked = 0;
  for (const { guildId } of rows) {
    if (!input.presentGuildIds.has(guildId)) {
      db.update(botGuilds)
        .set({ leftAt: now, updatedAt: now })
        .where(eq(botGuilds.guildId, guildId))
        .run();
      marked++;
    }
  }
  return marked;
}

export interface BotGuildStats {
  activeCount: number;
  joinedLast7d: number;
  joinedLast30d: number;
  leftLast30d: number;
}

export function botGuildStats(db: Db): BotGuildStats {
  const now = Date.now();
  const d7 = now - 7 * 24 * 60 * 60 * 1000;
  const d30 = now - 30 * 24 * 60 * 60 * 1000;

  const active = db
    .select({ c: sql<number>`count(*)` })
    .from(botGuilds)
    .where(isNull(botGuilds.leftAt))
    .get();

  const j7 = db
    .select({ c: sql<number>`count(*)` })
    .from(botGuilds)
    .where(and(isNull(botGuilds.leftAt), gte(botGuilds.joinedAt, d7)))
    .get();

  const j30 = db
    .select({ c: sql<number>`count(*)` })
    .from(botGuilds)
    .where(and(isNull(botGuilds.leftAt), gte(botGuilds.joinedAt, d30)))
    .get();

  const l30 = db
    .select({ c: sql<number>`count(*)` })
    .from(botGuilds)
    .where(gte(botGuilds.leftAt, d30))
    .get();

  return {
    activeCount: active?.c ?? 0,
    joinedLast7d: j7?.c ?? 0,
    joinedLast30d: j30?.c ?? 0,
    leftLast30d: l30?.c ?? 0,
  };
}
