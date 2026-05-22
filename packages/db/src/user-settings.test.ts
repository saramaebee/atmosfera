import { describe, expect, it } from 'bun:test';
import { createDb, migrateDb } from './client';
import { brutalOptin, roastOptout } from './schema';
import { listNotableUserSettings } from './user-settings';

function freshDb() {
  const db = createDb(':memory:');
  migrateDb(db);
  return db;
}

const GUILD = 'g1';

describe('listNotableUserSettings', () => {
  it('returns empty when nothing is set', () => {
    const db = freshDb();
    expect(listNotableUserSettings(db, GUILD)).toEqual([]);
  });

  it('surfaces brutal opt-ins', () => {
    const db = freshDb();
    db.insert(brutalOptin).values({ userId: 'u1', guildId: GUILD, optedInAt: Date.now() }).run();
    const out = listNotableUserSettings(db, GUILD);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ userId: 'u1', brutalOptin: true, optedOut: false });
  });

  it('surfaces opted-out users', () => {
    const db = freshDb();
    db.insert(roastOptout)
      .values({
        userId: 'u2',
        guildId: GUILD,
        optedOut: 1,
        lockedUntil: null,
        updatedAt: Date.now(),
      })
      .run();
    const out = listNotableUserSettings(db, GUILD);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ userId: 'u2', optedOut: true });
  });

  it('does not surface opted-in users whose lock has expired', () => {
    const db = freshDb();
    db.insert(roastOptout)
      .values({
        userId: 'u3',
        guildId: GUILD,
        optedOut: 0,
        lockedUntil: Date.now() - 1000,
        updatedAt: Date.now(),
      })
      .run();
    expect(listNotableUserSettings(db, GUILD)).toEqual([]);
  });

  it('does surface opted-in users whose lock has not yet expired', () => {
    const db = freshDb();
    db.insert(roastOptout)
      .values({
        userId: 'u4',
        guildId: GUILD,
        optedOut: 0,
        lockedUntil: Date.now() + 60_000,
        updatedAt: Date.now(),
      })
      .run();
    const out = listNotableUserSettings(db, GUILD);
    expect(out).toHaveLength(1);
    expect(out[0].lockedUntil).not.toBeNull();
  });

  it('merges brutal opt-in with active opt-out lock for the same user', () => {
    const db = freshDb();
    db.insert(brutalOptin).values({ userId: 'u5', guildId: GUILD, optedInAt: Date.now() }).run();
    db.insert(roastOptout)
      .values({
        userId: 'u5',
        guildId: GUILD,
        optedOut: 0,
        lockedUntil: Date.now() + 60_000,
        updatedAt: Date.now(),
      })
      .run();
    const out = listNotableUserSettings(db, GUILD);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ userId: 'u5', brutalOptin: true });
    expect(out[0].lockedUntil).not.toBeNull();
  });
});
