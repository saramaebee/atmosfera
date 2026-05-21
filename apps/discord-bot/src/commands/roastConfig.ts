import { recordAuditEvent } from '@atmosfera/db';
import {
  getGuildConfig,
  setBrutalAllowed,
  setMessageEnabled,
  setSlashEnabled,
} from '@atmosfera/user-roast';
import { Command } from '@sapphire/framework';
import { chatInputRegisterOptions } from '../lib/commandScope';
import { applyScopeToBuilder, registerScope } from '../lib/permissions';
import { safeDeferReply, safeRespond } from '../lib/safeInteraction';

const SCOPE = { baseline: 'admin', ownerOverride: true } as const;
registerScope('roast-config', SCOPE);

export class RoastConfigCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'roast-config',
      requiredClientPermissions: ['SendMessages'],
      preconditions: ['AtmosferaScope'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        applyScopeToBuilder(
          builder
            .setName('roast-config')
            .setDescription('Configure user-roast triggers and tone allowances for this server.')
            .addBooleanOption((o) =>
              o
                .setName('slash')
                .setDescription('Allow /roast user as a slash command in this server.'),
            )
            .addBooleanOption((o) =>
              o
                .setName('message')
                .setDescription('Reserved — message-prefix commands are not active in atmosfera.'),
            )
            .addBooleanOption((o) =>
              o
                .setName('brutal_allowed')
                .setDescription('Allow brutal tone (users still must opt in individually).'),
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

    // Defer up front — DB reads + audit insert can flirt with the 3s
    // interaction-ack window, especially right after a cold start.
    await safeDeferReply(interaction, { ephemeral: true });

    const slash = interaction.options.getBoolean('slash');
    const message = interaction.options.getBoolean('message');
    const brutal = interaction.options.getBoolean('brutal_allowed');

    const prevCfg = getGuildConfig(interaction.guildId);

    if (slash !== null) setSlashEnabled(interaction.guildId, slash);
    if (message !== null) setMessageEnabled(interaction.guildId, message);
    if (brutal !== null) setBrutalAllowed(interaction.guildId, brutal);

    const cfg = getGuildConfig(interaction.guildId);

    if (slash !== null || message !== null || brutal !== null) {
      recordAuditEvent(this.container.db, {
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        eventType: 'roast.config.update',
        subjectType: 'guild',
        subjectId: interaction.guildId,
        metadata: {
          previous: {
            slash_enabled: Boolean(prevCfg.slash_enabled),
            message_enabled: Boolean(prevCfg.message_enabled),
            brutal_allowed: Boolean(prevCfg.brutal_allowed),
          },
          next: {
            slash_enabled: Boolean(cfg.slash_enabled),
            message_enabled: Boolean(cfg.message_enabled),
            brutal_allowed: Boolean(cfg.brutal_allowed),
          },
          changed: {
            slash: slash !== null,
            message: message !== null,
            brutal_allowed: brutal !== null,
          },
        },
      });
    }
    await safeRespond(interaction, {
      content: [
        '**Current config**',
        `- Indexing: ${cfg.indexing_enabled ? 'on' : 'off'}`,
        `- /roast user slash: ${cfg.slash_enabled ? 'on' : 'off'}`,
        `- Brutal tone allowed: ${cfg.brutal_allowed ? 'yes (per-user opt-in still required)' : 'no'}`,
      ].join('\n'),
      ephemeral: true,
    });
  }
}
