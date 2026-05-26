import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import {
  addExplainChannel,
  isExplainAllowedInChannel,
  listExplainChannels,
  removeExplainChannel,
} from './channels';
import { setExplainDb } from './client';
import { getExplainMode, setExplainMode } from './settings';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE explain_guild_channels (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      set_by TEXT NOT NULL,
      set_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    );
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

describe('isExplainAllowedInChannel', () => {
  it('allows any channel by default (mode everywhere, no rows)', () => {
    freshDb();
    expect(isExplainAllowedInChannel('guild-1', 'any-channel')).toBe(true);
  });

  it('restricts to the allowlist once a channel is added', () => {
    freshDb();
    const res = addExplainChannel({ guildId: 'guild-1', channelId: 'chan-a', setBy: 'admin-1' });
    expect(res).toEqual({ added: true, mode: 'allowlist' });
    expect(getExplainMode('guild-1')).toBe('allowlist');
    expect(isExplainAllowedInChannel('guild-1', 'chan-a')).toBe(true);
    expect(isExplainAllowedInChannel('guild-1', 'chan-b')).toBe(false);
  });

  it('reverts to everywhere after the last channel is removed', () => {
    freshDb();
    addExplainChannel({ guildId: 'guild-1', channelId: 'chan-a', setBy: 'admin-1' });
    const { removed, mode } = removeExplainChannel({
      guildId: 'guild-1',
      channelId: 'chan-a',
      setBy: 'admin-1',
    });
    expect(removed?.channelId).toBe('chan-a');
    expect(mode).toBe('everywhere');
    expect(isExplainAllowedInChannel('guild-1', 'chan-b')).toBe(true);
  });

  it('keeps allowlist mode when other channels remain', () => {
    freshDb();
    addExplainChannel({ guildId: 'guild-1', channelId: 'chan-a', setBy: 'admin-1' });
    addExplainChannel({ guildId: 'guild-1', channelId: 'chan-b', setBy: 'admin-1' });
    const { mode } = removeExplainChannel({
      guildId: 'guild-1',
      channelId: 'chan-a',
      setBy: 'admin-1',
    });
    expect(mode).toBe('allowlist');
    expect(isExplainAllowedInChannel('guild-1', 'chan-b')).toBe(true);
    expect(isExplainAllowedInChannel('guild-1', 'chan-a')).toBe(false);
  });

  it('blocks every channel in off mode, even allow-listed ones', () => {
    freshDb();
    addExplainChannel({ guildId: 'guild-1', channelId: 'chan-a', setBy: 'admin-1' });
    setExplainMode({ guildId: 'guild-1', mode: 'off', setBy: 'admin-1' });
    expect(isExplainAllowedInChannel('guild-1', 'chan-a')).toBe(false);
    expect(isExplainAllowedInChannel('guild-1', 'chan-b')).toBe(false);
  });

  it('is scoped per guild (guild A allowlist does not gate guild B)', () => {
    freshDb();
    addExplainChannel({ guildId: 'guild-1', channelId: 'chan-a', setBy: 'admin-1' });
    expect(isExplainAllowedInChannel('guild-2', 'chan-a')).toBe(true);
    expect(isExplainAllowedInChannel('guild-2', 'chan-z')).toBe(true);
  });
});

describe('addExplainChannel', () => {
  it('reports added=false on duplicate but keeps allowlist mode', () => {
    freshDb();
    expect(addExplainChannel({ guildId: 'g', channelId: 'c', setBy: 'a' })).toEqual({
      added: true,
      mode: 'allowlist',
    });
    expect(addExplainChannel({ guildId: 'g', channelId: 'c', setBy: 'a' })).toEqual({
      added: false,
      mode: 'allowlist',
    });
    expect(listExplainChannels('g')).toHaveLength(1);
  });
});

describe('removeExplainChannel', () => {
  it('returns null when absent and leaves mode untouched', () => {
    freshDb();
    const { removed, mode } = removeExplainChannel({ guildId: 'g', channelId: 'x', setBy: 'a' });
    expect(removed).toBeNull();
    expect(mode).toBe('everywhere');
  });
});

describe('listExplainChannels', () => {
  it('returns rows for the guild only', () => {
    freshDb();
    addExplainChannel({ guildId: 'g1', channelId: 'a', setBy: 'x' });
    addExplainChannel({ guildId: 'g1', channelId: 'b', setBy: 'x' });
    addExplainChannel({ guildId: 'g2', channelId: 'c', setBy: 'x' });
    expect(
      listExplainChannels('g1')
        .map((row) => row.channelId)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(listExplainChannels('g2').map((row) => row.channelId)).toEqual(['c']);
  });
});
