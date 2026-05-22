import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';
import { setUserRoastDb } from './client';
import {
  applyMessageEdit,
  deleteMessageById,
  deleteMessagesByIds,
  deleteMessagesForUser,
  getLongestTargetMessages,
  getMessagesByChannelTime,
  getRecentTargetMessages,
  getReplyChainMessages,
  getTargetChannelCounts,
  getTargetMessagesByHourUtc,
  getTargetMessagesInChannel,
  purgeMessagesOlderThan,
  recordMessage,
  searchTargetMessagesText,
} from './messages';

function freshDb() {
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
    CREATE INDEX idx_messages_recent_created ON messages_recent (created_at);
    CREATE INDEX idx_messages_recent_guild_channel_author_time
      ON messages_recent (guild_id, channel_id, author_id, created_at);
  `);
  setUserRoastDb(db);
  return db;
}

function makeRow(overrides: Partial<Parameters<typeof recordMessage>[0]> = {}) {
  return {
    messageId: 'm1',
    guildId: 'g1',
    channelId: 'c1',
    authorId: 'u1',
    content: 'hello',
    createdAt: 1_000_000,
    isReply: false,
    replyToId: null,
    ...overrides,
  };
}

describe('recordMessage', () => {
  beforeEach(() => {
    freshDb();
  });

  it('inserts a new row', () => {
    recordMessage(makeRow());
    const got = getRecentTargetMessages('g1', 'u1', 0);
    expect(got).toHaveLength(1);
    expect(got[0]?.content).toBe('hello');
  });

  it('is idempotent on duplicate message_id', () => {
    recordMessage(makeRow({ content: 'first' }));
    recordMessage(makeRow({ content: 'second' }));
    const got = getRecentTargetMessages('g1', 'u1', 0);
    expect(got).toHaveLength(1);
    // INSERT OR IGNORE means the first write wins.
    expect(got[0]?.content).toBe('first');
  });

  it('truncates content past 2000 chars', () => {
    const big = 'x'.repeat(2500);
    recordMessage(makeRow({ content: big }));
    const got = getRecentTargetMessages('g1', 'u1', 0);
    expect(got[0]?.content.length).toBe(2000);
  });
});

describe('applyMessageEdit', () => {
  beforeEach(() => {
    freshDb();
  });

  it('updates content and editedAt for an existing row', () => {
    recordMessage(makeRow({ content: 'before' }));
    applyMessageEdit('m1', 'after', 1_100_000);
    const got = getRecentTargetMessages('g1', 'u1', 0);
    expect(got[0]?.content).toBe('after');
  });

  it('is a no-op on a missing row (aged out)', () => {
    applyMessageEdit('missing', 'whatever', 1_000_000);
    expect(getRecentTargetMessages('g1', 'u1', 0)).toHaveLength(0);
  });
});

describe('deleteMessageById / deleteMessagesByIds', () => {
  beforeEach(() => {
    freshDb();
  });

  it('removes a single row', () => {
    recordMessage(makeRow());
    deleteMessageById('m1');
    expect(getRecentTargetMessages('g1', 'u1', 0)).toHaveLength(0);
  });

  it('removes a batch of rows in one query', () => {
    recordMessage(makeRow({ messageId: 'a' }));
    recordMessage(makeRow({ messageId: 'b' }));
    recordMessage(makeRow({ messageId: 'c' }));
    deleteMessagesByIds(['a', 'c']);
    const got = getRecentTargetMessages('g1', 'u1', 0);
    expect(got.map((r) => r.id)).toEqual(['b']);
  });

  it('handles empty batch as a no-op', () => {
    recordMessage(makeRow());
    deleteMessagesByIds([]);
    expect(getRecentTargetMessages('g1', 'u1', 0)).toHaveLength(1);
  });
});

describe('deleteMessagesForUser (eager opt-out purge)', () => {
  beforeEach(() => {
    freshDb();
  });

  it('deletes every row for the (user, guild) pair', () => {
    recordMessage(makeRow({ messageId: 'a' }));
    recordMessage(makeRow({ messageId: 'b', createdAt: 1_000_500 }));
    expect(deleteMessagesForUser('u1', 'g1')).toBe(2);
    expect(getRecentTargetMessages('g1', 'u1', 0)).toHaveLength(0);
  });

  it('leaves rows in other guilds and other users alone', () => {
    recordMessage(makeRow({ messageId: 'a' })); // target row
    recordMessage(makeRow({ messageId: 'b', guildId: 'g2' })); // other guild
    recordMessage(makeRow({ messageId: 'c', authorId: 'u2' })); // other user
    expect(deleteMessagesForUser('u1', 'g1')).toBe(1);
    expect(getRecentTargetMessages('g1', 'u1', 0)).toHaveLength(0);
    expect(getRecentTargetMessages('g2', 'u1', 0)).toHaveLength(1);
    expect(getRecentTargetMessages('g1', 'u2', 0)).toHaveLength(1);
  });
});

describe('getRecentTargetMessages', () => {
  beforeEach(() => {
    freshDb();
  });

  it('returns rows newest-first', () => {
    recordMessage(makeRow({ messageId: 'old', createdAt: 1000 }));
    recordMessage(makeRow({ messageId: 'mid', createdAt: 2000 }));
    recordMessage(makeRow({ messageId: 'new', createdAt: 3000 }));
    const got = getRecentTargetMessages('g1', 'u1', 0);
    expect(got.map((r) => r.id)).toEqual(['new', 'mid', 'old']);
  });

  it('honors sinceMs', () => {
    recordMessage(makeRow({ messageId: 'old', createdAt: 1000 }));
    recordMessage(makeRow({ messageId: 'new', createdAt: 3000 }));
    const got = getRecentTargetMessages('g1', 'u1', 2000);
    expect(got.map((r) => r.id)).toEqual(['new']);
  });

  it('honors limit', () => {
    for (let i = 0; i < 5; i++) {
      recordMessage(makeRow({ messageId: `m${i}`, createdAt: 1000 + i }));
    }
    const got = getRecentTargetMessages('g1', 'u1', 0, 2);
    expect(got).toHaveLength(2);
  });

  it('is scoped to (guildId, authorId)', () => {
    recordMessage(makeRow({ messageId: 'a' }));
    recordMessage(makeRow({ messageId: 'b', authorId: 'u2' }));
    recordMessage(makeRow({ messageId: 'c', guildId: 'g2' }));
    const got = getRecentTargetMessages('g1', 'u1', 0);
    expect(got.map((r) => r.id)).toEqual(['a']);
  });
});

describe('purgeMessagesOlderThan', () => {
  beforeEach(() => {
    freshDb();
  });

  it('drops rows older than cutoff', () => {
    recordMessage(makeRow({ messageId: 'old', createdAt: 1000 }));
    recordMessage(makeRow({ messageId: 'new', createdAt: 5000 }));
    const purged = purgeMessagesOlderThan(2000);
    expect(purged).toBe(1);
    const remaining = getRecentTargetMessages('g1', 'u1', 0);
    expect(remaining.map((r) => r.id)).toEqual(['new']);
  });
});

describe('searchTargetMessagesText', () => {
  beforeEach(() => {
    freshDb();
  });

  it('matches case-insensitive substring', () => {
    recordMessage(makeRow({ messageId: 'a', content: 'I LOVE Severance' }));
    recordMessage(makeRow({ messageId: 'b', content: 'severance is mid' }));
    recordMessage(makeRow({ messageId: 'c', content: 'nothing to do with the show' }));
    const got = searchTargetMessagesText({
      guildId: 'g1',
      authorId: 'u1',
      keyword: 'severance',
      sinceMs: 0,
    });
    expect(got.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('treats LIKE wildcards in the keyword literally', () => {
    recordMessage(makeRow({ messageId: 'a', content: 'discount code 100% off' }));
    recordMessage(makeRow({ messageId: 'b', content: 'unrelated message' }));
    const got = searchTargetMessagesText({
      guildId: 'g1',
      authorId: 'u1',
      keyword: '100%',
      sinceMs: 0,
    });
    expect(got.map((r) => r.id)).toEqual(['a']);
  });

  it('honors channelId scoping', () => {
    recordMessage(makeRow({ messageId: 'a', channelId: 'c1', content: 'hello' }));
    recordMessage(makeRow({ messageId: 'b', channelId: 'c2', content: 'hello' }));
    const got = searchTargetMessagesText({
      guildId: 'g1',
      authorId: 'u1',
      keyword: 'hello',
      channelId: 'c2',
      sinceMs: 0,
    });
    expect(got.map((r) => r.id)).toEqual(['b']);
  });

  it('does not leak across guilds or authors', () => {
    recordMessage(makeRow({ messageId: 'a', guildId: 'g2', content: 'foo' }));
    recordMessage(makeRow({ messageId: 'b', authorId: 'u2', content: 'foo' }));
    recordMessage(makeRow({ messageId: 'c', content: 'foo' }));
    const got = searchTargetMessagesText({
      guildId: 'g1',
      authorId: 'u1',
      keyword: 'foo',
      sinceMs: 0,
    });
    expect(got.map((r) => r.id)).toEqual(['c']);
  });

  it('empty keyword returns nothing (no full table scan)', () => {
    recordMessage(makeRow());
    expect(
      searchTargetMessagesText({ guildId: 'g1', authorId: 'u1', keyword: '', sinceMs: 0 }),
    ).toHaveLength(0);
  });
});

describe('getMessagesByChannelTime', () => {
  beforeEach(() => {
    freshDb();
  });

  it('returns all authors in window, ascending', () => {
    recordMessage(makeRow({ messageId: 'a', authorId: 'u1', createdAt: 1000 }));
    recordMessage(makeRow({ messageId: 'b', authorId: 'u2', createdAt: 1500 }));
    recordMessage(makeRow({ messageId: 'c', authorId: 'u1', createdAt: 2500 }));
    recordMessage(makeRow({ messageId: 'd', authorId: 'u1', createdAt: 5000 })); // outside window
    const got = getMessagesByChannelTime({
      guildId: 'g1',
      channelId: 'c1',
      fromMs: 1000,
      toMs: 3000,
    });
    expect(got.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('scopes by channel and guild', () => {
    recordMessage(makeRow({ messageId: 'a', channelId: 'c1' }));
    recordMessage(makeRow({ messageId: 'b', channelId: 'c2' }));
    recordMessage(makeRow({ messageId: 'c', guildId: 'g2' }));
    const got = getMessagesByChannelTime({
      guildId: 'g1',
      channelId: 'c1',
      fromMs: 0,
      toMs: 9_999_999,
    });
    expect(got.map((r) => r.id)).toEqual(['a']);
  });
});

describe('getReplyChainMessages', () => {
  beforeEach(() => {
    freshDb();
  });

  it('returns target↔partner reply turns in both directions', () => {
    // partner posts first
    recordMessage(makeRow({ messageId: 'p1', authorId: 'partner', createdAt: 1000 }));
    // target replies
    recordMessage(
      makeRow({
        messageId: 't1',
        authorId: 'u1',
        createdAt: 1100,
        isReply: true,
        replyToId: 'p1',
      }),
    );
    // partner replies to target
    recordMessage(
      makeRow({
        messageId: 'p2',
        authorId: 'partner',
        createdAt: 1200,
        isReply: true,
        replyToId: 't1',
      }),
    );
    // unrelated reply by target
    recordMessage(makeRow({ messageId: 'other', authorId: 'other-user', createdAt: 1300 }));
    recordMessage(
      makeRow({
        messageId: 't2',
        authorId: 'u1',
        createdAt: 1400,
        isReply: true,
        replyToId: 'other',
      }),
    );

    const got = getReplyChainMessages({
      guildId: 'g1',
      userA: 'u1',
      userB: 'partner',
      sinceMs: 0,
    });
    // Only paired turns between the two users — newest first.
    expect(got.map((r) => r.id)).toEqual(['p2', 't1']);
  });

  it('respects sinceMs and channelId filters', () => {
    recordMessage(makeRow({ messageId: 'p1', authorId: 'partner', createdAt: 500 }));
    recordMessage(
      makeRow({
        messageId: 't1',
        authorId: 'u1',
        createdAt: 600,
        isReply: true,
        replyToId: 'p1',
        channelId: 'c1',
      }),
    );
    recordMessage(makeRow({ messageId: 'p2', authorId: 'partner', createdAt: 1500 }));
    recordMessage(
      makeRow({
        messageId: 't2',
        authorId: 'u1',
        createdAt: 1600,
        isReply: true,
        replyToId: 'p2',
        channelId: 'c2',
      }),
    );

    const sinceFiltered = getReplyChainMessages({
      guildId: 'g1',
      userA: 'u1',
      userB: 'partner',
      sinceMs: 1000,
    });
    expect(sinceFiltered.map((r) => r.id)).toEqual(['t2']);

    const channelFiltered = getReplyChainMessages({
      guildId: 'g1',
      userA: 'u1',
      userB: 'partner',
      sinceMs: 0,
      channelId: 'c1',
    });
    expect(channelFiltered.map((r) => r.id)).toEqual(['t1']);
  });

  it('does not cross guilds via reply_to_id', () => {
    recordMessage(makeRow({ messageId: 'p1', authorId: 'partner', guildId: 'g1' }));
    recordMessage(
      makeRow({
        messageId: 't1',
        authorId: 'u1',
        guildId: 'g2',
        isReply: true,
        replyToId: 'p1',
      }),
    );
    const got = getReplyChainMessages({
      guildId: 'g1',
      userA: 'u1',
      userB: 'partner',
      sinceMs: 0,
    });
    expect(got).toHaveLength(0);
  });
});

describe('getLongestTargetMessages', () => {
  beforeEach(() => {
    freshDb();
  });

  it('orders by content length descending', () => {
    recordMessage(makeRow({ messageId: 'short', content: 'hi' }));
    recordMessage(makeRow({ messageId: 'med', content: 'a'.repeat(50) }));
    recordMessage(makeRow({ messageId: 'long', content: 'a'.repeat(200) }));
    const got = getLongestTargetMessages({ guildId: 'g1', authorId: 'u1', sinceMs: 0 });
    expect(got.slice(0, 3).map((r) => r.id)).toEqual(['long', 'med', 'short']);
  });
});

describe('getTargetMessagesByHourUtc', () => {
  beforeEach(() => {
    freshDb();
  });

  it('filters to specified UTC hours', () => {
    const at = (h: number) => Date.UTC(2026, 4, 1, h, 0, 0, 0);
    recordMessage(makeRow({ messageId: 'h03', createdAt: at(3) }));
    recordMessage(makeRow({ messageId: 'h12', createdAt: at(12) }));
    recordMessage(makeRow({ messageId: 'h23', createdAt: at(23) }));

    const lateNight = getTargetMessagesByHourUtc({
      guildId: 'g1',
      authorId: 'u1',
      hoursUtc: [22, 23, 0, 1, 2, 3, 4],
      sinceMs: 0,
    });
    expect(lateNight.map((r) => r.id).sort()).toEqual(['h03', 'h23']);
  });

  it('empty hours returns nothing (guards against accidental match-all)', () => {
    recordMessage(makeRow());
    expect(
      getTargetMessagesByHourUtc({
        guildId: 'g1',
        authorId: 'u1',
        hoursUtc: [],
        sinceMs: 0,
      }),
    ).toHaveLength(0);
  });

  it('drops out-of-range hour ints', () => {
    const at = (h: number) => Date.UTC(2026, 4, 1, h, 0, 0, 0);
    recordMessage(makeRow({ messageId: 'h05', createdAt: at(5) }));
    const got = getTargetMessagesByHourUtc({
      guildId: 'g1',
      authorId: 'u1',
      hoursUtc: [5, 99, -1, 25],
      sinceMs: 0,
    });
    expect(got.map((r) => r.id)).toEqual(['h05']);
  });
});

describe('getTargetMessagesInChannel & getTargetChannelCounts', () => {
  beforeEach(() => {
    freshDb();
  });

  it('returns target messages in a single channel newest-first', () => {
    recordMessage(makeRow({ messageId: 'a', channelId: 'c1', createdAt: 1000 }));
    recordMessage(makeRow({ messageId: 'b', channelId: 'c1', createdAt: 2000 }));
    recordMessage(makeRow({ messageId: 'c', channelId: 'c2', createdAt: 3000 }));
    const got = getTargetMessagesInChannel({
      guildId: 'g1',
      authorId: 'u1',
      channelId: 'c1',
      sinceMs: 0,
    });
    expect(got.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('counts target messages per channel', () => {
    recordMessage(makeRow({ messageId: 'a', channelId: 'c1' }));
    recordMessage(makeRow({ messageId: 'b', channelId: 'c1' }));
    recordMessage(makeRow({ messageId: 'c', channelId: 'c2' }));
    recordMessage(makeRow({ messageId: 'd', channelId: 'c2', authorId: 'u2' })); // other user
    const got = getTargetChannelCounts({ guildId: 'g1', authorId: 'u1', sinceMs: 0 });
    expect(got).toEqual([
      { channel_id: 'c1', count: 2 },
      { channel_id: 'c2', count: 1 },
    ]);
  });
});
