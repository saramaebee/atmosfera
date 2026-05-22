import { describe, expect, it } from 'bun:test';
import {
  botGuildStats,
  getBotGuild,
  listActiveBotGuilds,
  markBotGuildLeft,
  reconcileBotGuildsLeft,
  upsertBotGuild,
} from './bot-guilds';
import { createDb, migrateDb } from './client';

function freshDb() {
  const db = createDb(':memory:');
  migrateDb(db);
  return db;
}

describe('bot-guilds', () => {
  it('upsert + list active', () => {
    const db = freshDb();
    upsertBotGuild(db, { guildId: 'g1', name: 'one', iconHash: null, memberCount: 5 });
    upsertBotGuild(db, { guildId: 'g2', name: 'two', iconHash: 'abc', memberCount: 12 });
    const active = listActiveBotGuilds(db);
    expect(active.map((g) => g.guildId).sort()).toEqual(['g1', 'g2']);
  });

  it('markBotGuildLeft sets leftAt and excludes from active list', () => {
    const db = freshDb();
    upsertBotGuild(db, { guildId: 'g1', name: 'one', iconHash: null, memberCount: 5 });
    markBotGuildLeft(db, 'g1');
    expect(listActiveBotGuilds(db)).toHaveLength(0);
    const row = getBotGuild(db, 'g1');
    expect(row?.leftAt).not.toBeNull();
  });

  it('re-joining a left guild clears leftAt and refreshes joinedAt', () => {
    const db = freshDb();
    upsertBotGuild(db, { guildId: 'g1', name: 'one', iconHash: null, memberCount: 5 });
    markBotGuildLeft(db, 'g1');
    const before = getBotGuild(db, 'g1');
    upsertBotGuild(db, { guildId: 'g1', name: 'one renamed', iconHash: null, memberCount: 7 });
    const after = getBotGuild(db, 'g1');
    expect(after?.leftAt).toBeNull();
    expect(after?.name).toBe('one renamed');
    expect(after?.memberCount).toBe(7);
    // joinedAt should have been refreshed since the guild had left
    expect((after?.joinedAt ?? 0) >= (before?.joinedAt ?? 0)).toBe(true);
  });

  it('reconcileBotGuildsLeft marks missing guilds as left', () => {
    const db = freshDb();
    upsertBotGuild(db, { guildId: 'g1', name: 'one', iconHash: null, memberCount: 1 });
    upsertBotGuild(db, { guildId: 'g2', name: 'two', iconHash: null, memberCount: 2 });
    upsertBotGuild(db, { guildId: 'g3', name: 'three', iconHash: null, memberCount: 3 });
    const marked = reconcileBotGuildsLeft(db, { presentGuildIds: new Set(['g1', 'g3']) });
    expect(marked).toBe(1);
    expect(
      listActiveBotGuilds(db)
        .map((g) => g.guildId)
        .sort(),
    ).toEqual(['g1', 'g3']);
  });

  it('botGuildStats reports active count', () => {
    const db = freshDb();
    upsertBotGuild(db, { guildId: 'g1', name: 'one', iconHash: null, memberCount: 1 });
    upsertBotGuild(db, { guildId: 'g2', name: 'two', iconHash: null, memberCount: 2 });
    markBotGuildLeft(db, 'g2');
    const stats = botGuildStats(db);
    expect(stats.activeCount).toBe(1);
    expect(stats.indexingEnabledCount).toBe(0);
    expect(stats.brutalAllowedCount).toBe(0);
  });
});
