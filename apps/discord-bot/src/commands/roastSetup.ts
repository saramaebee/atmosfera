import { recordAuditEvent } from '@atmosfera/db';
import { getGuildConfig, setIndexingEnabled } from '@atmosfera/user-roast';
import { Command } from '@sapphire/framework';
import { chatInputRegisterOptions } from '../lib/commandScope';
import { applyScopeToBuilder, registerScope } from '../lib/permissions';
import { safeDeferReply, safeRespond } from '../lib/safeInteraction';

const SCOPE = { baseline: 'admin', ownerOverride: true } as const;
registerScope('roast-setup', SCOPE);

export class RoastSetupCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'roast-setup',
      requiredClientPermissions: ['SendMessages'],
      preconditions: ['AtmosferaScope'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        applyScopeToBuilder(
          builder
            .setName('roast-setup')
            .setDescription(
              'Enable user-roast in this server: opts into metadata-only activity indexing.',
            )
            .addBooleanOption((opt) =>
              opt
                .setName('enable')
                .setDescription('true to enable indexing, false to disable.')
                .setRequired(true),
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

    // Defer up front — DB reads + audit insert can flirt with the 3s ack window.
    await safeDeferReply(interaction, { ephemeral: true });

    const enable = interaction.options.getBoolean('enable', true);
    const prevCfg = getGuildConfig(interaction.guildId);
    setIndexingEnabled(interaction.guildId, enable);
    const cfg = getGuildConfig(interaction.guildId);

    recordAuditEvent(this.container.db, {
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      eventType: 'roast.indexing.toggle',
      subjectType: 'guild',
      subjectId: interaction.guildId,
      metadata: {
        previousIndexingEnabled: Boolean(prevCfg.indexing_enabled),
        newIndexingEnabled: Boolean(cfg.indexing_enabled),
      },
    });

    const lines = enable
      ? [
          '**Indexing enabled.** The bot will now record metadata-only activity for this server:',
          '- Per-channel hourly message counts (no content)',
          '- Reply/mention edges between members',
          '- 30-day per-message metadata window (timestamps, length buckets, attachment flags)',
          '',
          '**Retention:** 30 days for activity counts, interaction edges, and per-message metadata.',
          '**Privacy:** message content is never stored. Run `/privacy` for the full disclosure.',
          '',
          'Run `/roast user @user` once enough activity has been recorded. To disable, run `/roast-setup enable:false`.',
        ]
      : [
          '**Indexing disabled.** No new activity will be recorded for this server.',
          '',
          '`/roast user` will now fall back to live-probe mode (slower, shallower).',
          'Existing rows will purge on their normal retention schedule.',
        ];

    await safeRespond(interaction, { content: lines.join('\n'), ephemeral: true });

    this.container.logger.info(
      `[roast-setup] guild=${interaction.guildId} indexing=${cfg.indexing_enabled}`,
    );
  }
}
