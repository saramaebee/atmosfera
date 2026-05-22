import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';
import type { Guild } from 'discord.js';
import { setUserRoastDb } from './db/client';
import { setRoastOptedOut } from './db/config';
import { recordMessage } from './db/messages';
import { RoastSession } from './sessionCache';
import { buildRoastTools } from './tools';

/**
 * Schema scaffolding for the synthesis tool tests. Just the tables that
 * `tools.ts` actually touches — keeps the fixture small.
 */
function freshDb(): void {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE messages_recent (
      message_id TEXT PRIMARY KEY NOT NULL,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      edited_at INTEGER,
      is_reply INTEGER DEFAULT 0 NOT NULL,
      reply_to_id TEXT
    );
    CREATE INDEX idx_messages_recent_guild_author_time
      ON messages_recent (guild_id, author_id, created_at);
    CREATE INDEX idx_messages_recent_guild_channel_author_time
      ON messages_recent (guild_id, channel_id, author_id, created_at);

    CREATE TABLE roast_optout (
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      opted_out INTEGER NOT NULL,
      locked_until INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, guild_id)
    );

    CREATE TABLE interactions (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE guild_config (
      guild_id TEXT PRIMARY KEY NOT NULL,
      indexing_enabled INTEGER DEFAULT 0 NOT NULL,
      indexing_enabled_at INTEGER,
      slash_enabled INTEGER DEFAULT 1 NOT NULL,
      message_enabled INTEGER DEFAULT 1 NOT NULL,
      brutal_allowed INTEGER DEFAULT 0 NOT NULL
    );
  `);
  setUserRoastDb(db);
}

function makeSession(targetUserId: string, guildId: string): RoastSession {
  return new RoastSession({
    invocationId: 'inv-test',
    targetUserId,
    guildId,
    fetchBudget: 100,
  });
}

// `Guild` is a fat discord.js class. The tools we exercise here only read
// `.id` on the local paths; any code path that reaches into `guild.channels`
// or similar would throw `Cannot read property 'cache' of undefined`, which
// is itself the assertion that a probe was attempted.
function makeGuild(id: string): Guild {
  return { id } as Guild;
}

// Tools resolve their cutoff via Date.now() at call time, so "recent" must be
// anchored to the real clock — a fixed past timestamp would fall outside the
// 7-day retention window and the queries would return nothing.
const recent = (offsetMs: number) => Date.now() - offsetMs;

beforeEach(() => {
  freshDb();
});

describe('searchTargetMessagesContaining', () => {
  it('returns hits from messages_recent without touching Discord', async () => {
    recordMessage({
      messageId: 'm1',
      guildId: 'g1',
      channelId: 'c1',
      authorId: 'u1',
      content: 'I have so many opinions about Severance',
      createdAt: recent(60_000),
      isReply: false,
      replyToId: null,
    });
    recordMessage({
      messageId: 'm2',
      guildId: 'g1',
      channelId: 'c1',
      authorId: 'u1',
      content: 'unrelated',
      createdAt: recent(30_000),
      isReply: false,
      replyToId: null,
    });

    const tools = buildRoastTools({ guild: makeGuild('g1'), session: makeSession('u1', 'g1') });
    const search = tools.find((t) => t.name === 'searchTargetMessagesContaining');
    expect(search).toBeDefined();

    const result = (await search!.handler({ keyword: 'severance' })) as {
      match_count: number;
      matches: { id: string }[];
    };

    expect(result.match_count).toBe(1);
    expect(result.matches[0]?.id).toBe('m1');
  });
});

describe('getMessagesNearTime', () => {
  it('reads the context window from messages_recent without probing Discord', async () => {
    const pivot = recent(60_000);
    const seed = (id: string, authorId: string, atMs: number) =>
      recordMessage({
        messageId: id,
        guildId: 'g1',
        channelId: 'c1',
        authorId,
        content: `msg-${id}`,
        createdAt: atMs,
        isReply: false,
        replyToId: null,
      });
    seed('a', 'someone', pivot - 5 * 60_000);
    seed('b', 'someone', pivot - 60_000);
    seed('c', 'u1', pivot);
    seed('d', 'someone', pivot + 60_000);
    seed('e', 'someone', pivot + 5 * 60_000);

    const tools = buildRoastTools({ guild: makeGuild('g1'), session: makeSession('u1', 'g1') });
    const ctx = tools.find((t) => t.name === 'getMessagesNearTime');

    const result = (await ctx!.handler({
      channelId: 'c1',
      timestampIso: new Date(pivot).toISOString(),
      radius: 2,
    })) as { messages: { id: string }[] };

    // 2 before + pivot + 2 after = 5
    expect(result.messages.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('getReplyChainBetween', () => {
  function seedChain(opts: { paired: number }): void {
    for (let i = 0; i < opts.paired; i++) {
      const partnerId = `partner-msg-${i}`;
      const targetId = `target-msg-${i}`;
      recordMessage({
        messageId: partnerId,
        guildId: 'g1',
        channelId: 'c1',
        authorId: 'partner',
        content: `partner says ${i}`,
        createdAt: recent(100_000 - i * 100),
        isReply: false,
        replyToId: null,
      });
      recordMessage({
        messageId: targetId,
        guildId: 'g1',
        channelId: 'c1',
        authorId: 'u1',
        content: `target replies ${i}`,
        createdAt: recent(99_000 - i * 100),
        isReply: true,
        replyToId: partnerId,
      });
    }
  }

  it('returns source=local without probing when local chain is rich enough', async () => {
    seedChain({ paired: 4 });
    const tools = buildRoastTools({ guild: makeGuild('g1'), session: makeSession('u1', 'g1') });
    const replyTool = tools.find((t) => t.name === 'getReplyChainBetween');

    const result = (await replyTool!.handler({ partnerUserId: 'partner' })) as {
      source: string;
      match_count: number;
    };
    expect(result.source).toBe('local');
    expect(result.match_count).toBe(4);
  });

  it('skips the probe when the partner has opted out, even if local chain is sparse', async () => {
    seedChain({ paired: 1 }); // below MIN_PAIRED_TURNS_BEFORE_PROBE
    setRoastOptedOut('partner', 'g1');

    const tools = buildRoastTools({ guild: makeGuild('g1'), session: makeSession('u1', 'g1') });
    const replyTool = tools.find((t) => t.name === 'getReplyChainBetween');

    const result = (await replyTool!.handler({ partnerUserId: 'partner' })) as {
      source: string;
      match_count: number;
      partner_unavailable?: boolean;
    };
    expect(result.source).toBe('local');
    expect(result.partner_unavailable).toBe(true);
    expect(result.match_count).toBe(1);
  });
});
