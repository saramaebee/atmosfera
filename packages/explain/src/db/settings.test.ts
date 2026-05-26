import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { setExplainDb } from './client';
import { getExplainMode, setExplainMode, shouldExplainExist } from './settings';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE explain_guild_settings (
      guild_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      set_by TEXT NOT NULL,
      set_at INTEGER NOT NULL
    );
  `);
  setExplainDb(db);
  return db;
}

describe('getExplainMode', () => {
  it("defaults to 'everywhere' when no row exists", () => {
    freshDb();
    expect(getExplainMode('guild-1')).toBe('everywhere');
  });
});

describe('setExplainMode', () => {
  it('persists the mode and returns the previous value', () => {
    freshDb();
    expect(setExplainMode({ guildId: 'g', mode: 'off', setBy: 'a' })).toEqual({
      previous: 'everywhere',
    });
    expect(getExplainMode('g')).toBe('off');
    expect(setExplainMode({ guildId: 'g', mode: 'allowlist', setBy: 'a' })).toEqual({
      previous: 'off',
    });
    expect(getExplainMode('g')).toBe('allowlist');
  });

  it('is scoped per guild', () => {
    freshDb();
    setExplainMode({ guildId: 'g1', mode: 'off', setBy: 'a' });
    expect(getExplainMode('g2')).toBe('everywhere');
  });
});

describe('shouldExplainExist', () => {
  it('is true unless the guild is off', () => {
    expect(shouldExplainExist('everywhere')).toBe(true);
    expect(shouldExplainExist('allowlist')).toBe(true);
    expect(shouldExplainExist('off')).toBe(false);
  });
});
