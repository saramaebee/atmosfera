import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';
import { setUserRoastDb } from './client';
import {
  applyMessageEdit,
  deleteMessageById,
  deleteMessagesByIds,
  deleteMessagesForUser,
  getRecentTargetMessages,
  purgeMessagesOlderThan,
  recordMessage,
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
