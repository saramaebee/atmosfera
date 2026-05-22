import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { setUserRoastDb } from './client';
import { clearBrutalOptin, hasBrutalOptin, setBrutalOptin } from './config';

function freshDb() {
  const db = new Database(':memory:');
  // Just the table we need for these tests — keeps the fixture small.
  db.exec(`
    CREATE TABLE brutal_optin (
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      opted_in_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, guild_id)
    );
  `);
  setUserRoastDb(db);
  return db;
}

describe('hasBrutalOptin', () => {
  it('returns false when the row is absent (regression: bun:sqlite returns null, not undefined)', () => {
    freshDb();
    expect(hasBrutalOptin('user-1', 'guild-1')).toBe(false);
  });

  it('returns true after setBrutalOptin', () => {
    freshDb();
    setBrutalOptin('user-1', 'guild-1');
    expect(hasBrutalOptin('user-1', 'guild-1')).toBe(true);
  });

  it('returns false after clearBrutalOptin', () => {
    freshDb();
    setBrutalOptin('user-1', 'guild-1');
    clearBrutalOptin('user-1', 'guild-1');
    expect(hasBrutalOptin('user-1', 'guild-1')).toBe(false);
  });

  it('is scoped per (user, guild)', () => {
    freshDb();
    setBrutalOptin('user-1', 'guild-1');
    expect(hasBrutalOptin('user-1', 'guild-1')).toBe(true);
    expect(hasBrutalOptin('user-2', 'guild-1')).toBe(false);
    expect(hasBrutalOptin('user-1', 'guild-2')).toBe(false);
  });
});
