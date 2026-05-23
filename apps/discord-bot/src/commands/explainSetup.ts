import { type ExplainLanguage, type ExplainTier, recordAuditEvent } from '@atmosfera/db';
import { listGuildRoles, removeGuildRole, setGuildRole } from '@atmosfera/explain';
import { Command } from '@sapphire/framework';
import { chatInputRegisterOptions } from '../lib/commandScope';
import { applyScopeToBuilder, registerScope } from '../lib/permissions';
import { safeDeferReply, safeRespond } from '../lib/safeInteraction';

const SCOPE = { baseline: 'admin', ownerOverride: true } as const;
registerScope('explain-setup', SCOPE);

const LANGUAGE_CHOICES: { name: string; value: ExplainLanguage }[] = [
  { name: 'English', value: 'en' },
  { name: 'Spanish', value: 'es' },
  { name: 'Other (native of a third language)', value: 'other' },
];

const TIER_CHOICES: { name: string; value: ExplainTier }[] = [
  { name: 'native', value: 'native' },
  { name: 'fluent', value: 'fluent' },
  { name: 'intermediate', value: 'intermediate' },
  { name: 'beginner', value: 'beginner' },
];

export class ExplainSetupCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'explain-setup',
      description:
        'Map server roles to language proficiency so /explain weights native-speaker context.',
      requiredClientPermissions: ['SendMessages', 'EmbedLinks'],
      preconditions: ['AtmosferaScope'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        applyScopeToBuilder(
          builder
            .setName('explain-setup')
            .setDescription(
              'Configure how /explain interprets server roles (native-speaker weighting).',
            )
            .addSubcommand((sc) =>
              sc
                .setName('add')
                .setDescription(
                  'Map a role to a (language, tier) pair, or overwrite an existing mapping.',
                )
                .addRoleOption((o) =>
                  o.setName('role').setDescription('The role to map.').setRequired(true),
                )
                .addStringOption((o) =>
                  o
                    .setName('language')
                    .setDescription('Which language this role identifies.')
                    .setRequired(true)
                    .addChoices(...LANGUAGE_CHOICES),
                )
                .addStringOption((o) =>
                  o
                    .setName('tier')
                    .setDescription("Speaker's relationship to that language.")
                    .setRequired(true)
                    .addChoices(...TIER_CHOICES),
                ),
            )
            .addSubcommand((sc) =>
              sc
                .setName('remove')
                .setDescription('Remove a role mapping.')
                .addRoleOption((o) =>
                  o
                    .setName('role')
                    .setDescription('The role whose mapping to remove.')
                    .setRequired(true),
                ),
            )
            .addSubcommand((sc) =>
              sc
                .setName('list')
                .setDescription('List all role mappings configured for this server.'),
            ),
          SCOPE,
        ),
      chatInputRegisterOptions(),
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Server only.', ephemeral: true });
      return;
    }
    await safeDeferReply(interaction, { ephemeral: true });

    const sub = interaction.options.getSubcommand(true);
    if (sub === 'add') {
      await this.handleAdd(interaction);
    } else if (sub === 'remove') {
      await this.handleRemove(interaction);
    } else if (sub === 'list') {
      await this.handleList(interaction);
    } else {
      await safeRespond(interaction, { content: `Unknown subcommand: ${sub}`, ephemeral: true });
    }
  }

  private async handleAdd(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const role = interaction.options.getRole('role', true);
    const language = interaction.options.getString('language', true) as ExplainLanguage;
    const tier = interaction.options.getString('tier', true) as ExplainTier;

    const { previous, current } = setGuildRole({
      guildId,
      roleId: role.id,
      language,
      tier,
      setBy: interaction.user.id,
    });

    recordAuditEvent(this.container.db, {
      guildId,
      actorId: interaction.user.id,
      eventType: 'explain.role.add',
      subjectType: 'role',
      subjectId: role.id,
      metadata: {
        roleName: role.name,
        language: current.language,
        tier: current.tier,
        previousLanguage: previous?.language ?? null,
        previousTier: previous?.tier ?? null,
        via: 'slash',
      },
    });

    const verb = previous ? 'Updated' : 'Added';
    const prevNote = previous
      ? ` (previously ${formatLanguage(previous.language)} / ${previous.tier})`
      : '';
    await safeRespond(interaction, {
      content: `${verb} mapping: <@&${role.id}> → **${formatLanguage(current.language)} / ${current.tier}**${prevNote}.`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }

  private async handleRemove(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const role = interaction.options.getRole('role', true);
    const removed = removeGuildRole(guildId, role.id);
    if (!removed) {
      await safeRespond(interaction, {
        content: `No mapping exists for <@&${role.id}>.`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    recordAuditEvent(this.container.db, {
      guildId,
      actorId: interaction.user.id,
      eventType: 'explain.role.remove',
      subjectType: 'role',
      subjectId: role.id,
      metadata: {
        roleName: role.name,
        previousLanguage: removed.language,
        previousTier: removed.tier,
        via: 'slash',
      },
    });

    await safeRespond(interaction, {
      content: `Removed mapping for <@&${role.id}> (was **${formatLanguage(removed.language)} / ${removed.tier}**).`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }

  private async handleList(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const rows = listGuildRoles(guildId);
    if (rows.length === 0) {
      await safeRespond(interaction, {
        content:
          'No role mappings configured. `/explain` will fall back to AI-inferred authority.\n\nUse `/explain-setup add` to map a server role to a language + tier.',
        ephemeral: true,
      });
      return;
    }
    const lines = rows.map(
      (r) => `- <@&${r.roleId}> → **${formatLanguage(r.language)} / ${r.tier}**`,
    );
    await safeRespond(interaction, {
      content: `**${rows.length} role mapping${rows.length === 1 ? '' : 's'}:**\n${lines.join('\n')}`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }
}

function formatLanguage(lang: ExplainLanguage): string {
  return lang === 'en' ? 'English' : lang === 'es' ? 'Spanish' : 'Other';
}
