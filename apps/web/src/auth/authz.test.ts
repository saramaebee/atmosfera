import { describe, expect, it } from 'bun:test';
import type { WebSession } from '@atmosfera/db';
import { createDb, migrateDb, upsertBotGuild } from '@atmosfera/db';
import { setWebDb } from '../state';
import type { SessionContext } from '../types';
import { hasManageGuild, listSwitchableGuilds, roleFor } from './authz';

function freshDb() {
  const db = createDb(':memory:');
  migrateDb(db);
  setWebDb(db);
  return db;
}

function makeSession(opts: {
  userId: string;
  isOwner: boolean;
  oauthGuilds: { id: string; name: string; permissions: string }[];
}): SessionContext {
  const session: WebSession = {
    id: 'sess-1',
    discordUserId: opts.userId,
    discordUsername: 'tester',
    discordGlobalName: null,
    discordAvatarHash: null,
    accessTokenEnc: '',
    refreshTokenEnc: '',
    accessTokenExpiresAt: Date.now() + 60_000,
    oauthGuildsJson: '[]',
    oauthGuildsFetchedAt: Date.now(),
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  };
  return {
    session,
    oauthGuilds: opts.oauthGuilds.map((g) => ({
      id: g.id,
      name: g.name,
      icon: null,
      permissions: g.permissions,
    })),
    isOwner: opts.isOwner,
  };
}

const MANAGE_GUILD_BIT = '32'; // 0x20

describe('hasManageGuild', () => {
  it('detects the Manage Guild bit', () => {
    expect(hasManageGuild('32')).toBe(true);
    expect(hasManageGuild('8')).toBe(false); // administrator alone (we don't treat it as MANAGE_GUILD)
    expect(hasManageGuild('0')).toBe(false);
    expect(hasManageGuild('not-a-number')).toBe(false);
  });

  it('handles JS-unsafe bitfields (decimal string longer than Number.MAX_SAFE_INTEGER)', () => {
    // ADMINISTRATOR + MANAGE_GUILD + manage_channels = bitfield with the bit set
    expect(hasManageGuild('1152921504606846976')).toBe(false); // bit 60 only
    expect(hasManageGuild('1152921504606846976' /* +0x20 */)).toBe(false);
    expect(hasManageGuild((1152921504606846976n | 0x20n).toString())).toBe(true);
  });
});

describe('roleFor', () => {
  it('bot owner short-circuits to owner regardless of OAuth guilds', () => {
    const ctx = makeSession({ userId: 'me', isOwner: true, oauthGuilds: [] });
    expect(roleFor(ctx, 'g1')).toBe('owner');
  });

  it('admin when user is in the guild and has Manage Server', () => {
    const ctx = makeSession({
      userId: 'me',
      isOwner: false,
      oauthGuilds: [{ id: 'g1', name: 'one', permissions: MANAGE_GUILD_BIT }],
    });
    expect(roleFor(ctx, 'g1')).toBe('admin');
  });

  it('member when user is in the guild without Manage Server', () => {
    const ctx = makeSession({
      userId: 'me',
      isOwner: false,
      oauthGuilds: [{ id: 'g1', name: 'one', permissions: '0' }],
    });
    expect(roleFor(ctx, 'g1')).toBe('member');
  });

  it('none when user is not in the guild', () => {
    const ctx = makeSession({
      userId: 'me',
      isOwner: false,
      oauthGuilds: [{ id: 'g1', name: 'one', permissions: MANAGE_GUILD_BIT }],
    });
    expect(roleFor(ctx, 'other-guild')).toBe('none');
  });
});

describe('listSwitchableGuilds', () => {
  it('non-owners see only the intersection of OAuth and active bot guilds', () => {
    const db = freshDb();
    upsertBotGuild(db, { guildId: 'g1', name: 'one', iconHash: null, memberCount: 1 });
    upsertBotGuild(db, { guildId: 'g2', name: 'two', iconHash: null, memberCount: 1 });
    upsertBotGuild(db, { guildId: 'g3', name: 'three', iconHash: null, memberCount: 1 });

    const ctx = makeSession({
      userId: 'me',
      isOwner: false,
      oauthGuilds: [
        { id: 'g1', name: 'one', permissions: MANAGE_GUILD_BIT },
        { id: 'g3', name: 'three', permissions: '0' },
        { id: 'g99', name: 'bot-not-here', permissions: MANAGE_GUILD_BIT },
      ],
    });
    const list = listSwitchableGuilds(ctx);
    expect(list.map((g) => g.id).sort()).toEqual(['g1', 'g3']);
    expect(list.find((g) => g.id === 'g1')?.role).toBe('admin');
    expect(list.find((g) => g.id === 'g3')?.role).toBe('member');
  });

  it('owners see every active bot guild — including those they are not in', () => {
    const db = freshDb();
    upsertBotGuild(db, { guildId: 'g1', name: 'one', iconHash: null, memberCount: 1 });
    upsertBotGuild(db, { guildId: 'g2', name: 'two', iconHash: null, memberCount: 1 });

    const ctx = makeSession({
      userId: 'sara',
      isOwner: true,
      // OAuth only knows about g1; owner should still see g2 in the switcher.
      oauthGuilds: [{ id: 'g1', name: 'one', permissions: MANAGE_GUILD_BIT }],
    });
    const list = listSwitchableGuilds(ctx);
    expect(list.map((g) => g.id).sort()).toEqual(['g1', 'g2']);
    // Owner rows are tagged 'owner' regardless of personal membership.
    for (const g of list) expect(g.role).toBe('owner');
  });
});
