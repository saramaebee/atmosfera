import { evaluateAccess } from '@atmosfera/db';
import { AllFlowsPrecondition } from '@sapphire/framework';
import {
  type ChatInputCommandInteraction,
  type ContextMenuCommandInteraction,
  type GuildMember,
  type Message,
  PermissionFlagsBits,
} from 'discord.js';
import { getScope, isBotOwner } from '../lib/permissions';

export const ATMOSFERA_SCOPE_IDENTIFIERS = {
  Admin: 'AtmosferaScopeAdmin',
  DeniedRule: 'AtmosferaScopeDeniedRule',
  OwnerOnly: 'AtmosferaScopeOwnerOnly',
  ServerOnly: 'AtmosferaScopeServerOnly',
} as const;

export class AtmosferaScopePrecondition extends AllFlowsPrecondition {
  public override chatInputRun(
    interaction: ChatInputCommandInteraction,
    command: { name: string },
  ): AllFlowsPrecondition.Result {
    return this.evaluate(command.name, interaction);
  }

  public override contextMenuRun(
    interaction: ContextMenuCommandInteraction,
    command: { name: string },
  ): AllFlowsPrecondition.Result {
    return this.evaluate(command.name, interaction);
  }

  public override messageRun(
    _message: Message,
    _command: { name: string },
  ): AllFlowsPrecondition.Result {
    // We don't load message commands in atmosfera, but the abstract requires it.
    return this.ok();
  }

  private evaluate(
    commandName: string,
    interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction,
  ): AllFlowsPrecondition.Result {
    const scope = getScope(commandName);
    // No scope registered → permissive. The regression test guards against
    // shipping a command without a scope, so this should only happen during
    // bring-up.
    if (!scope) return this.ok();

    const userId = interaction.user.id;
    const isProtected = scope.protected === true;

    // Owner-only commands short-circuit everything else: guild/RBAC/baseline
    // evaluation is meaningless when only DISCORD_OWNER_IDS may ever run it.
    if (scope.ownerOnly) {
      if (isBotOwner(userId)) return this.ok();
      return this.error({
        identifier: ATMOSFERA_SCOPE_IDENTIFIERS.OwnerOnly,
        message: 'This command is restricted to the bot owner.',
      });
    }

    // Owner override short-circuit. Bot owners bypass the user-scope check
    // but not requiredClientPermissions (Sapphire enforces that separately).
    if (scope.ownerOverride && isBotOwner(userId)) return this.ok();

    if (!interaction.inGuild() || !interaction.guildId) {
      // Out-of-guild invocations: admin commands are server-only by default
      // (applyScopeToBuilder sets setDMPermission(false), so this is mostly a
      // belt-and-suspenders check). Everyone commands run fine in DMs.
      if (scope.baseline === 'admin') {
        return this.error({
          identifier: ATMOSFERA_SCOPE_IDENTIFIERS.ServerOnly,
          message: 'This command can only be used in a server.',
        });
      }
      return this.ok();
    }

    const member = interaction.member as GuildMember | null;
    const roleIds: readonly string[] = member?.roles
      ? 'cache' in member.roles
        ? [...member.roles.cache.keys()]
        : Array.isArray(member.roles)
          ? member.roles
          : []
      : [];

    const verdict = evaluateAccess(this.container.db, {
      guildId: interaction.guildId,
      commandName,
      userId,
      roleIds,
    });

    if (verdict === 'allow') return this.ok();

    if (verdict === 'deny') {
      // Protected commands ignore restrictive rules — users always retain
      // access. /permissions itself refuses to add deny rules against
      // protected commands, but if one slipped in we still honor the
      // immunity here.
      if (isProtected) return this.ok();
      return this.error({
        identifier: ATMOSFERA_SCOPE_IDENTIFIERS.DeniedRule,
        message: 'A server admin has blocked this command for you in this server.',
      });
    }

    // verdict === 'baseline' — fall back to the compiled-in scope.
    if (scope.baseline === 'everyone') return this.ok();

    // baseline === 'admin': require ManageGuild.
    const memberPerms = member?.permissions;
    if (
      memberPerms !== undefined &&
      typeof memberPerms !== 'string' &&
      memberPerms.has(PermissionFlagsBits.ManageGuild)
    ) {
      return this.ok();
    }

    return this.error({
      identifier: ATMOSFERA_SCOPE_IDENTIFIERS.Admin,
      message:
        'This command requires the Manage Server permission, or a role granted access via `/permissions grant`.',
    });
  }
}

declare module '@sapphire/framework' {
  interface Preconditions {
    AtmosferaScope: never;
  }
}
