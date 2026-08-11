import { describe, expect, it } from 'bun:test';
import { listAuditEvents } from './audit';
import { createDb, migrateDb } from './client';
import {
  evaluateAccess,
  listRulesForCommand,
  listRulesForGuild,
  removeRule,
  upsertRule,
} from './permissions';

function freshDb() {
  const db = createDb(':memory:');
  migrateDb(db);
  return db;
}

const GUILD = 'guild-1';
const CMD = 'muggy';
const ADMIN_ACTOR = 'admin-user';
const TARGET_USER = 'user-42';
const MOD_ROLE = 'role-mods';
const TROUBLEMAKER_ROLE = 'role-troublemakers';

describe('evaluateAccess', () => {
  it('returns baseline when no rules exist', () => {
    const db = freshDb();
    const verdict = evaluateAccess(db, {
      guildId: GUILD,
      commandName: CMD,
      userId: TARGET_USER,
      roleIds: [MOD_ROLE],
    });
    expect(verdict).toBe('baseline');
  });

  it('explicit user allow beats role baseline', () => {
    const db = freshDb();
    upsertRule(db, {
      guildId: GUILD,
      commandName: CMD,
      principal: { type: 'user', id: TARGET_USER },
      effect: 'allow',
      actorId: ADMIN_ACTOR,
    });
    expect(
      evaluateAccess(db, {
        guildId: GUILD,
        commandName: CMD,
        userId: TARGET_USER,
        roleIds: [],
      }),
    ).toBe('allow');
  });

  it('explicit user deny beats matching role allow', () => {
    const db = freshDb();
    upsertRule(db, {
      guildId: GUILD,
      commandName: CMD,
      principal: { type: 'role', id: MOD_ROLE },
      effect: 'allow',
      actorId: ADMIN_ACTOR,
    });
    upsertRule(db, {
      guildId: GUILD,
      commandName: CMD,
      principal: { type: 'user', id: TARGET_USER },
      effect: 'deny',
      actorId: ADMIN_ACTOR,
    });
    expect(
      evaluateAccess(db, {
        guildId: GUILD,
        commandName: CMD,
        userId: TARGET_USER,
        roleIds: [MOD_ROLE],
      }),
    ).toBe('deny');
  });

  it('role deny beats role allow when both match the user', () => {
    const db = freshDb();
    upsertRule(db, {
      guildId: GUILD,
      commandName: CMD,
      principal: { type: 'role', id: MOD_ROLE },
      effect: 'allow',
      actorId: ADMIN_ACTOR,
    });
    upsertRule(db, {
      guildId: GUILD,
      commandName: CMD,
      principal: { type: 'role', id: TROUBLEMAKER_ROLE },
      effect: 'deny',
      actorId: ADMIN_ACTOR,
    });
    expect(
      evaluateAccess(db, {
        guildId: GUILD,
        commandName: CMD,
        userId: TARGET_USER,
        roleIds: [MOD_ROLE, TROUBLEMAKER_ROLE],
      }),
    ).toBe('deny');
  });

  it('role allow is returned when user matches an allow-role and no deny applies', () => {
    const db = freshDb();
    upsertRule(db, {
      guildId: GUILD,
      commandName: CMD,
      principal: { type: 'role', id: MOD_ROLE },
      effect: 'allow',
      actorId: ADMIN_ACTOR,
    });
    expect(
      evaluateAccess(db, {
        guildId: GUILD,
        commandName: CMD,
        userId: TARGET_USER,
        roleIds: [MOD_ROLE],
      }),
    ).toBe('allow');
  });

  it('rules that do not match the user fall back to baseline', () => {
    const db = freshDb();
    upsertRule(db, {
      guildId: GUILD,
      commandName: CMD,
      principal: { type: 'role', id: MOD_ROLE },
      effect: 'allow',
      actorId: ADMIN_ACTOR,
    });
    expect(
      evaluateAccess(db, {
        guildId: GUILD,
        commandName: CMD,
        userId: TARGET_USER,
        roleIds: ['some-other-role'],
      }),
    ).toBe('baseline');
  });

  it('rules for other guilds or commands are ignored', () => {
    const db = freshDb();
    upsertRule(db, {
      guildId: 'other-guild',
      commandName: CMD,
      principal: { type: 'user', id: TARGET_USER },
      effect: 'deny',
      actorId: ADMIN_ACTOR,
    });
    upsertRule(db, {
      guildId: GUILD,
      commandName: 'other-command',
      principal: { type: 'user', id: TARGET_USER },
      effect: 'deny',
      actorId: ADMIN_ACTOR,
    });
    expect(
      evaluateAccess(db, {
        guildId: GUILD,
        commandName: CMD,
        userId: TARGET_USER,
        roleIds: [],
      }),
    ).toBe('baseline');
  });
});

describe('upsertRule + audit', () => {
  it('records permission.grant on first allow', () => {
    const db = freshDb();
    const result = upsertRule(db, {
      guildId: GUILD,
      commandName: CMD,
      principal: { type: 'role', id: MOD_ROLE },
      effect: 'allow',
      actorId: ADMIN_ACTOR,
    });
    expect(result.previousEffect).toBeNull();

    const events = listAuditEvents(db, { guildId: GUILD });
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('permission.grant');
    expect(events[0]!.actorId).toBe(ADMIN_ACTOR);
    expect(events[0]!.subjectId).toBe(CMD);
  });

  it('records permission.deny when adding a deny rule', () => {
    const db = freshDb();
    upsertRule(db, {
      guildId: GUILD,
      commandName: CMD,
      principal: { type: 'role', id: TROUBLEMAKER_ROLE },
      effect: 'deny',
      actorId: ADMIN_ACTOR,
    });
    const events = listAuditEvents(db, { guildId: GUILD });
    expect(events[0]!.eventType).toBe('permission.deny');
  });

  it('records permission.undeny when allow replaces a prior deny', () => {
    const db = freshDb();
    const principal = { type: 'role' as const, id: MOD_ROLE };
    upsertRule(db, {
      guildId: GUILD,
      commandName: CMD,
      principal,
      effect: 'deny',
      actorId: ADMIN_ACTOR,
    });
    const result = upsertRule(db, {
      guildId: GUILD,
      commandName: CMD,
      principal,
      effect: 'allow',
      actorId: ADMIN_ACTOR,
    });
    expect(result.previousEffect).toBe('deny');

    const events = listAuditEvents(db, { guildId: GUILD });
    expect(events.map((e) => e.eventType)).toEqual(['permission.undeny', 'permission.deny']);
  });
});

describe('removeRule', () => {
  it('returns null and writes no audit when no rule exists', () => {
    const db = freshDb();
    const result = removeRule(db, {
      guildId: GUILD,
      commandName: CMD,
      principal: { type: 'user', id: TARGET_USER },
      actorId: ADMIN_ACTOR,
    });
    expect(result.removed).toBeNull();
    expect(listAuditEvents(db, { guildId: GUILD })).toHaveLength(0);
  });

  it('deletes the rule and records permission.revoke', () => {
    const db = freshDb();
    upsertRule(db, {
      guildId: GUILD,
      commandName: CMD,
      principal: { type: 'user', id: TARGET_USER },
      effect: 'allow',
      actorId: ADMIN_ACTOR,
    });
    const result = removeRule(db, {
      guildId: GUILD,
      commandName: CMD,
      principal: { type: 'user', id: TARGET_USER },
      actorId: ADMIN_ACTOR,
    });
    expect(result.removed?.effect).toBe('allow');

    expect(listRulesForCommand(db, GUILD, CMD)).toHaveLength(0);

    const events = listAuditEvents(db, { guildId: GUILD });
    expect(events.map((e) => e.eventType)).toEqual(['permission.revoke', 'permission.grant']);
  });
});

describe('list helpers', () => {
  it('listRulesForGuild returns rules across multiple commands', () => {
    const db = freshDb();
    upsertRule(db, {
      guildId: GUILD,
      commandName: 'muggy',
      principal: { type: 'role', id: MOD_ROLE },
      effect: 'allow',
      actorId: ADMIN_ACTOR,
    });
    upsertRule(db, {
      guildId: GUILD,
      commandName: 'climate',
      principal: { type: 'role', id: MOD_ROLE },
      effect: 'allow',
      actorId: ADMIN_ACTOR,
    });
    expect(listRulesForGuild(db, GUILD)).toHaveLength(2);
  });
});
