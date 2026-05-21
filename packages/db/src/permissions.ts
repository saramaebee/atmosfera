import { and, eq } from 'drizzle-orm';
import type { Db } from './client';
import {
  type CommandPermissionRule,
  type PermissionEffect,
  type PrincipalType,
  auditLog,
  commandPermissionRules,
} from './schema';

export interface Principal {
  type: PrincipalType;
  id: string;
}

export interface UpsertRuleInput {
  guildId: string;
  commandName: string;
  principal: Principal;
  effect: PermissionEffect;
  actorId: string;
  reason?: string;
}

export interface UpsertRuleResult {
  rule: CommandPermissionRule;
  /** The effect that existed before this call, or null if no prior rule. */
  previousEffect: PermissionEffect | null;
}

export function upsertRule(db: Db, input: UpsertRuleInput): UpsertRuleResult {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(commandPermissionRules)
      .where(
        and(
          eq(commandPermissionRules.guildId, input.guildId),
          eq(commandPermissionRules.commandName, input.commandName),
          eq(commandPermissionRules.principalType, input.principal.type),
          eq(commandPermissionRules.principalId, input.principal.id),
        ),
      )
      .get();

    const previousEffect = existing?.effect ?? null;
    const now = Date.now();

    const upserted = tx
      .insert(commandPermissionRules)
      .values({
        guildId: input.guildId,
        commandName: input.commandName,
        principalType: input.principal.type,
        principalId: input.principal.id,
        effect: input.effect,
        grantedBy: input.actorId,
        grantedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          commandPermissionRules.guildId,
          commandPermissionRules.commandName,
          commandPermissionRules.principalType,
          commandPermissionRules.principalId,
        ],
        set: {
          effect: input.effect,
          grantedBy: input.actorId,
          grantedAt: now,
        },
      })
      .returning()
      .get();

    if (!upserted) throw new Error('upsertRule: insert returned no row');

    const eventType =
      input.effect === 'allow'
        ? previousEffect === 'deny'
          ? 'permission.undeny'
          : 'permission.grant'
        : 'permission.deny';

    tx.insert(auditLog)
      .values({
        guildId: input.guildId,
        actorId: input.actorId,
        eventType,
        subjectType: 'command',
        subjectId: input.commandName,
        metadata: JSON.stringify({
          principalType: input.principal.type,
          principalId: input.principal.id,
          previousEffect,
          newEffect: input.effect,
          ...(input.reason ? { reason: input.reason } : {}),
        }),
        createdAt: now,
      })
      .run();

    return { rule: upserted, previousEffect };
  });
}

export interface RemoveRuleInput {
  guildId: string;
  commandName: string;
  principal: Principal;
  actorId: string;
}

export interface RemoveRuleResult {
  removed: CommandPermissionRule | null;
}

export function removeRule(db: Db, input: RemoveRuleInput): RemoveRuleResult {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(commandPermissionRules)
      .where(
        and(
          eq(commandPermissionRules.guildId, input.guildId),
          eq(commandPermissionRules.commandName, input.commandName),
          eq(commandPermissionRules.principalType, input.principal.type),
          eq(commandPermissionRules.principalId, input.principal.id),
        ),
      )
      .get();

    if (!existing) return { removed: null };

    tx.delete(commandPermissionRules)
      .where(
        and(
          eq(commandPermissionRules.guildId, input.guildId),
          eq(commandPermissionRules.commandName, input.commandName),
          eq(commandPermissionRules.principalType, input.principal.type),
          eq(commandPermissionRules.principalId, input.principal.id),
        ),
      )
      .run();

    tx.insert(auditLog)
      .values({
        guildId: input.guildId,
        actorId: input.actorId,
        eventType: 'permission.revoke',
        subjectType: 'command',
        subjectId: input.commandName,
        metadata: JSON.stringify({
          principalType: input.principal.type,
          principalId: input.principal.id,
          previousEffect: existing.effect,
        }),
        createdAt: Date.now(),
      })
      .run();

    return { removed: existing };
  });
}

export function listRulesForGuild(db: Db, guildId: string): CommandPermissionRule[] {
  return db
    .select()
    .from(commandPermissionRules)
    .where(eq(commandPermissionRules.guildId, guildId))
    .all();
}

export function listRulesForCommand(
  db: Db,
  guildId: string,
  commandName: string,
): CommandPermissionRule[] {
  return db
    .select()
    .from(commandPermissionRules)
    .where(
      and(
        eq(commandPermissionRules.guildId, guildId),
        eq(commandPermissionRules.commandName, commandName),
      ),
    )
    .all();
}

export type AccessVerdict = 'allow' | 'deny' | 'baseline';

export interface EvaluateAccessInput {
  guildId: string;
  commandName: string;
  userId: string;
  roleIds: readonly string[];
}

/**
 * Evaluate explicit RBAC rules for a (guild, command, user).
 *
 * Precedence:
 *   1. explicit user rule for this user → its effect
 *   2. any role-level deny matching one of the user's roles → deny
 *   3. any role-level allow matching one of the user's roles → allow
 *   4. no matching rule → 'baseline'
 *
 * Caller layers protected/owner/scope-baseline checks around this.
 */
export function evaluateAccess(db: Db, input: EvaluateAccessInput): AccessVerdict {
  const rules = listRulesForCommand(db, input.guildId, input.commandName);
  if (rules.length === 0) return 'baseline';

  const userRule = rules.find((r) => r.principalType === 'user' && r.principalId === input.userId);
  if (userRule) return userRule.effect;

  const roleIdSet = new Set(input.roleIds);
  let sawAllow = false;
  for (const rule of rules) {
    if (rule.principalType !== 'role') continue;
    if (!roleIdSet.has(rule.principalId)) continue;
    if (rule.effect === 'deny') return 'deny';
    if (rule.effect === 'allow') sawAllow = true;
  }

  if (sawAllow) return 'allow';
  return 'baseline';
}
