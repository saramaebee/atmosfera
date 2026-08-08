import {
  type CommandPermissionRule,
  type Principal,
  listAuditEvents,
  listRulesForCommand,
  listRulesForGuild,
  parseAuditMetadata,
  removeRule,
  upsertRule,
} from '@atmosfera/db';
import { Command } from '@sapphire/framework';
import {
  EmbedBuilder,
  type GuildBasedChannel,
  type GuildMember,
  type Role,
  type User,
} from 'discord.js';
import { chatInputRegisterOptions } from '../lib/commandScope';
import { applyScopeToBuilder, getScope, listScopes, registerScope } from '../lib/permissions';

const SCOPE = { baseline: 'admin' } as const;
registerScope('permissions', SCOPE);

const PROTECTED_REJECT =
  "🛡️ That command is **protected** — users always retain access. You can grant additional roles/users via `/permissions grant`, but you can't restrict it.";

// Discord caps slash-command option choices at 25.
const MAX_COMMAND_CHOICES = 25;

export class PermissionsCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'permissions',
      description: 'Manage per-server slash-command access rules.',
      requiredClientPermissions: ['SendMessages', 'EmbedLinks'],
      preconditions: ['AtmosferaScope'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    const commandChoices = buildCommandChoices();
    const totalScopes = listScopes().size;
    if (totalScopes > MAX_COMMAND_CHOICES) {
      this.container.logger.warn(
        `[permissions] ${totalScopes} commands registered but only ${MAX_COMMAND_CHOICES} can appear in /permissions choices (Discord cap). Excess commands will be invisible to admins via the slash UI.`,
      );
    }

    registry.registerChatInputCommand(
      (builder) =>
        applyScopeToBuilder(
          builder
            .setName('permissions')
            .setDescription('Manage per-server slash-command access rules.')
            .addSubcommand((sub) =>
              sub
                .setName('grant')
                .setDescription('Allow a role or user to run a command.')
                .addMentionableOption((o) =>
                  o
                    .setName('principal')
                    .setDescription('Role or user to grant access to.')
                    .setRequired(true),
                )
                .addStringOption((o) =>
                  o
                    .setName('command')
                    .setDescription('Command to grant access to.')
                    .setRequired(true)
                    .addChoices(...commandChoices),
                )
                .addStringOption((o) =>
                  o.setName('reason').setDescription('Optional audit-log note.').setRequired(false),
                ),
            )
            .addSubcommand((sub) =>
              sub
                .setName('deny')
                .setDescription(
                  'Block a role or user from running a command (protected commands cannot be denied).',
                )
                .addMentionableOption((o) =>
                  o.setName('principal').setDescription('Role or user to block.').setRequired(true),
                )
                .addStringOption((o) =>
                  o
                    .setName('command')
                    .setDescription('Command to block.')
                    .setRequired(true)
                    .addChoices(...commandChoices),
                )
                .addStringOption((o) =>
                  o.setName('reason').setDescription('Optional audit-log note.').setRequired(false),
                ),
            )
            .addSubcommand((sub) =>
              sub
                .setName('revoke')
                .setDescription('Remove any existing rule for a role or user on a command.')
                .addMentionableOption((o) =>
                  o
                    .setName('principal')
                    .setDescription('Role or user whose rule should be removed.')
                    .setRequired(true),
                )
                .addStringOption((o) =>
                  o
                    .setName('command')
                    .setDescription('Command to remove the rule for.')
                    .setRequired(true)
                    .addChoices(...commandChoices),
                ),
            )
            .addSubcommand((sub) =>
              sub
                .setName('list')
                .setDescription('List access rules in this server.')
                .addStringOption((o) =>
                  o
                    .setName('command')
                    .setDescription('Optionally filter to one command.')
                    .setRequired(false)
                    .addChoices(...commandChoices),
                ),
            )
            .addSubcommand((sub) =>
              sub
                .setName('audit')
                .setDescription('Show recent permission-change events for this server.')
                .addIntegerOption((o) =>
                  o
                    .setName('limit')
                    .setDescription('How many entries to show (default 25, max 50).')
                    .setRequired(false)
                    .setMinValue(1)
                    .setMaxValue(50),
                ),
            ),
          SCOPE,
        ),
      chatInputRegisterOptions(),
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ content: 'Server only.', ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand(true);
    switch (sub) {
      case 'grant':
        return this.runUpsert(interaction, 'allow');
      case 'deny':
        return this.runUpsert(interaction, 'deny');
      case 'revoke':
        return this.runRevoke(interaction);
      case 'list':
        return this.runList(interaction);
      case 'audit':
        return this.runAudit(interaction);
    }
  }

  private async runUpsert(
    interaction: Command.ChatInputCommandInteraction,
    effect: 'allow' | 'deny',
  ): Promise<void> {
    const guildId = interaction.guildId!;
    const commandName = interaction.options.getString('command', true);
    const reason = interaction.options.getString('reason') ?? undefined;

    const principal = resolvePrincipalOption(interaction);
    if (!principal) {
      await interaction.reply({
        content: 'Principal must be a role or a server member.',
        ephemeral: true,
      });
      return;
    }

    const scope = getScope(commandName);
    if (effect === 'deny' && scope?.protected) {
      await interaction.reply({ content: PROTECTED_REJECT, ephemeral: true });
      return;
    }

    const { rule, previousEffect } = upsertRule(this.container.db, {
      guildId,
      commandName,
      principal: { type: principal.type, id: principal.id },
      effect,
      actorId: interaction.user.id,
      reason,
    });

    const verb =
      effect === 'allow'
        ? previousEffect === 'deny'
          ? 'Lifted block — now allowed'
          : 'Granted'
        : 'Blocked';
    await interaction.reply({
      content: `✅ ${verb}: ${principalLabel(principal)} → \`/${rule.commandName}\`.`,
      ephemeral: true,
    });
  }

  private async runRevoke(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const commandName = interaction.options.getString('command', true);
    const principal = resolvePrincipalOption(interaction);
    if (!principal) {
      await interaction.reply({
        content: 'Principal must be a role or a server member.',
        ephemeral: true,
      });
      return;
    }

    const { removed } = removeRule(this.container.db, {
      guildId,
      commandName,
      principal: { type: principal.type, id: principal.id },
      actorId: interaction.user.id,
    });

    await interaction.reply({
      content: removed
        ? `✅ Removed rule (${removed.effect}) for ${principalLabel(principal)} on \`/${commandName}\`.`
        : `No rule existed for ${principalLabel(principal)} on \`/${commandName}\`.`,
      ephemeral: true,
    });
  }

  private async runList(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const commandFilter = interaction.options.getString('command');
    const rules = commandFilter
      ? listRulesForCommand(this.container.db, guildId, commandFilter)
      : listRulesForGuild(this.container.db, guildId);

    if (rules.length === 0) {
      await interaction.reply({
        content: commandFilter
          ? `No rules configured for \`/${commandFilter}\` in this server.`
          : 'No rules configured in this server.',
        ephemeral: true,
      });
      return;
    }

    const grouped = new Map<string, CommandPermissionRule[]>();
    for (const r of rules) {
      const arr = grouped.get(r.commandName) ?? [];
      arr.push(r);
      grouped.set(r.commandName, arr);
    }

    const sections = [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cmd, rs]) => {
        const lines = rs
          .map((r) => {
            const principal =
              r.principalType === 'user' ? `<@${r.principalId}>` : `<@&${r.principalId}>`;
            const icon = r.effect === 'allow' ? '✅' : '🚫';
            return `${icon} ${principal} — ${r.effect}`;
          })
          .join('\n');
        return `**/${cmd}**\n${lines}`;
      });

    const embed = new EmbedBuilder()
      .setTitle('Permission rules')
      .setDescription(sections.join('\n\n').slice(0, 4000))
      .setColor(0x5865f2);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private async runAudit(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const limit = interaction.options.getInteger('limit') ?? 25;
    const events = listAuditEvents(this.container.db, {
      guildId,
      eventTypePattern: 'permission.%',
      limit,
    });

    if (events.length === 0) {
      await interaction.reply({
        content: 'No permission-change events recorded yet.',
        ephemeral: true,
      });
      return;
    }

    const lines = events.map((e) => {
      const ts = Math.floor(e.createdAt / 1000);
      const meta = parseAuditMetadata(e);
      const principalRef =
        meta?.principalType === 'user'
          ? `<@${String(meta.principalId)}>`
          : meta?.principalType === 'role'
            ? `<@&${String(meta.principalId)}>`
            : '?';
      const action = e.eventType.replace(/^permission\./, '');
      return `<t:${ts}:R> · <@${e.actorId}> ${action} ${principalRef} → \`/${e.subjectId}\``;
    });

    const embed = new EmbedBuilder()
      .setTitle('Permission audit log')
      .setDescription(lines.join('\n').slice(0, 4000))
      .setColor(0xa1a1aa);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

function buildCommandChoices(): Array<{ name: string; value: string }> {
  // ownerOnly commands are excluded: the precondition never reaches the RBAC
  // check for them, so per-guild rules would be dead weight.
  const all = [...listScopes().entries()]
    .filter(([, scope]) => !scope.ownerOnly)
    .map(([name, scope]) => ({
      name: scope.protected ? `${name}  (protected)` : name,
      value: name,
    }));
  all.sort((a, b) => a.value.localeCompare(b.value));
  return all.slice(0, MAX_COMMAND_CHOICES);
}

interface ResolvedPrincipal extends Principal {
  display: string;
}

function resolvePrincipalOption(
  interaction: Command.ChatInputCommandInteraction,
): ResolvedPrincipal | null {
  const mentionable = interaction.options.getMentionable('principal', true) as
    | Role
    | GuildMember
    | User
    | GuildBasedChannel
    | null;
  if (!mentionable) return null;

  if (isRole(mentionable)) {
    return { type: 'role', id: mentionable.id, display: `@${mentionable.name}` };
  }
  if (isGuildMember(mentionable)) {
    return {
      type: 'user',
      id: mentionable.id,
      display: `@${mentionable.displayName ?? mentionable.user.username}`,
    };
  }
  if (isUser(mentionable)) {
    return { type: 'user', id: mentionable.id, display: `@${mentionable.username}` };
  }
  return null;
}

function isRole(value: unknown): value is Role {
  return (
    typeof value === 'object' &&
    value !== null &&
    'permissions' in value &&
    'members' in value &&
    !('user' in value)
  );
}

function isGuildMember(value: unknown): value is GuildMember {
  return typeof value === 'object' && value !== null && 'user' in value && 'guild' in value;
}

function isUser(value: unknown): value is User {
  return (
    typeof value === 'object' &&
    value !== null &&
    'username' in value &&
    !('guild' in value) &&
    !('members' in value)
  );
}

function principalLabel(p: ResolvedPrincipal): string {
  return `${p.type === 'role' ? '🪪' : '👤'} ${p.display}`;
}
