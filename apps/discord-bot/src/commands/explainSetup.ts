import {
  type ExplainLanguage,
  type ExplainMode,
  type ExplainTier,
  recordAuditEvent,
} from '@atmosfera/db';
import {
  addExplainChannel,
  getExplainMode,
  listExplainChannels,
  listGuildRoles,
  removeExplainChannel,
  removeGuildRole,
  setExplainMode,
  setGuildRole,
} from '@atmosfera/explain';
import { Command } from '@sapphire/framework';
import { ChannelType } from 'discord.js';
import { chatInputRegisterOptions } from '../lib/commandScope';
import { reconcileExplainCommand } from '../lib/explainCommandSync';
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
        'Configure Explain: map roles to language proficiency, and restrict it to specific channels.',
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
              'Configure Explain: role weighting (native-speaker context) and channel access.',
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
            )
            .addSubcommandGroup((g) =>
              g
                .setName('channels')
                .setDescription('Restrict the Explain command to specific channels.')
                .addSubcommand((sc) =>
                  sc
                    .setName('add')
                    .setDescription(
                      'Allow Explain in a channel. Adding the first channel restricts it to that list.',
                    )
                    .addChannelOption((o) =>
                      o
                        .setName('channel')
                        .setDescription('The channel where Explain should be allowed.')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true),
                    ),
                )
                .addSubcommand((sc) =>
                  sc
                    .setName('remove')
                    .setDescription('Remove a channel from the Explain allowlist.')
                    .addChannelOption((o) =>
                      o
                        .setName('channel')
                        .setDescription('The channel to remove from the allowlist.')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true),
                    ),
                )
                .addSubcommand((sc) =>
                  sc
                    .setName('list')
                    .setDescription('Show the current Explain mode and any channel restriction.'),
                )
                .addSubcommand((sc) =>
                  sc
                    .setName('allow-all')
                    .setDescription(
                      'Allow Explain everywhere in this server (clears the restriction).',
                    ),
                )
                .addSubcommand((sc) =>
                  sc
                    .setName('disable-all')
                    .setDescription(
                      'Turn Explain off in this server (removes it from the Apps menu).',
                    ),
                ),
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

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(true);

    if (group === 'channels') {
      if (sub === 'add') {
        await this.handleChannelAdd(interaction);
      } else if (sub === 'remove') {
        await this.handleChannelRemove(interaction);
      } else if (sub === 'list') {
        await this.handleChannelList(interaction);
      } else if (sub === 'allow-all') {
        await this.handleModeChange(interaction, 'everywhere');
      } else if (sub === 'disable-all') {
        await this.handleModeChange(interaction, 'off');
      } else {
        await safeRespond(interaction, { content: `Unknown subcommand: ${sub}`, ephemeral: true });
      }
      return;
    }

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

  private async handleChannelAdd(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const channel = interaction.options.getChannel('channel', true);
    const { added } = addExplainChannel({
      guildId,
      channelId: channel.id,
      setBy: interaction.user.id,
    });
    // Adding activates allowlist mode (and re-enables if the guild was off), so
    // make sure the command is registered in the guild.
    await this.reconcile(guildId);

    if (!added) {
      await safeRespond(interaction, {
        content: `<#${channel.id}> is already on the Explain allowlist.`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    recordAuditEvent(this.container.db, {
      guildId,
      actorId: interaction.user.id,
      eventType: 'explain.channel.add',
      subjectType: 'channel',
      subjectId: channel.id,
      metadata: { channelName: channel.name, mode: 'allowlist', via: 'slash' },
    });

    const total = listExplainChannels(guildId).length;
    await safeRespond(interaction, {
      content:
        `Added <#${channel.id}> to the Explain allowlist. ` +
        `Explain is now restricted to ${total} channel${total === 1 ? '' : 's'}.`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }

  private async handleChannelRemove(
    interaction: Command.ChatInputCommandInteraction,
  ): Promise<void> {
    const guildId = interaction.guildId!;
    const channel = interaction.options.getChannel('channel', true);
    const { removed, mode } = removeExplainChannel({
      guildId,
      channelId: channel.id,
      setBy: interaction.user.id,
    });
    if (!removed) {
      await safeRespond(interaction, {
        content: `<#${channel.id}> is not on the Explain allowlist.`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    recordAuditEvent(this.container.db, {
      guildId,
      actorId: interaction.user.id,
      eventType: 'explain.channel.remove',
      subjectType: 'channel',
      subjectId: channel.id,
      metadata: { channelName: channel.name, mode, via: 'slash' },
    });
    await this.reconcile(guildId);

    const total = listExplainChannels(guildId).length;
    const note =
      mode === 'everywhere'
        ? ' The allowlist is now empty — Explain works in every channel again.'
        : ` Explain is now restricted to ${total} channel${total === 1 ? '' : 's'}.`;
    await safeRespond(interaction, {
      content: `Removed <#${channel.id}> from the Explain allowlist.${note}`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }

  private async handleChannelList(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const mode = getExplainMode(guildId);
    const rows = listExplainChannels(guildId);

    const header = `**Explain mode: ${formatMode(mode)}.**`;
    let body: string;
    if (mode === 'off') {
      body = 'The command is removed from this server (not shown in the Apps menu).';
    } else if (mode === 'everywhere') {
      body =
        rows.length === 0
          ? 'Works in every channel. Use `/explain-setup channels add` to restrict it.'
          : `Works in every channel. ${rows.length} saved channel${rows.length === 1 ? '' : 's'} (inactive — add another or it stays everywhere).`;
    } else {
      const lines = rows.map((r) => `- <#${r.channelId}>`);
      body = `Restricted to ${rows.length} channel${rows.length === 1 ? '' : 's'}:\n${lines.join('\n')}`;
    }
    await safeRespond(interaction, {
      content: `${header}\n${body}`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }

  private async handleModeChange(
    interaction: Command.ChatInputCommandInteraction,
    mode: Extract<ExplainMode, 'everywhere' | 'off'>,
  ): Promise<void> {
    const guildId = interaction.guildId!;
    const { previous } = setExplainMode({ guildId, mode, setBy: interaction.user.id });
    recordAuditEvent(this.container.db, {
      guildId,
      actorId: interaction.user.id,
      eventType: 'explain.mode.set',
      subjectType: 'guild',
      subjectId: guildId,
      metadata: { mode, previous, via: 'slash' },
    });
    await this.reconcile(guildId);

    const content =
      mode === 'off'
        ? 'Explain is now **disabled** in this server and removed from the right-click → Apps menu.'
        : 'Explain is now **enabled in every channel** in this server.';
    await safeRespond(interaction, { content, ephemeral: true });
  }

  /** Sync the per-guild Explain command with the guild's (just-changed) mode. */
  private async reconcile(guildId: string): Promise<void> {
    await reconcileExplainCommand(this.container.client, guildId);
  }
}

function formatLanguage(lang: ExplainLanguage): string {
  return lang === 'en' ? 'English' : lang === 'es' ? 'Spanish' : 'Other';
}

function formatMode(mode: ExplainMode): string {
  return mode === 'everywhere'
    ? 'everywhere'
    : mode === 'allowlist'
      ? 'only specific channels'
      : 'disabled';
}
