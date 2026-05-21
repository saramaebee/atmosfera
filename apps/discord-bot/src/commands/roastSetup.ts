import { getGuildConfig, setIndexingEnabled } from '@atmosfera/user-roast';
import { Command } from '@sapphire/framework';
import { PermissionFlagsBits } from 'discord.js';
import { chatInputRegisterOptions } from '../lib/commandScope';

export class RoastSetupCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'roast-setup' });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName('roast-setup')
          .setDescription('Enable user-roast in this server: opts into metadata-only activity indexing.')
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
          .setDMPermission(false)
          .addBooleanOption((opt) =>
            opt
              .setName('enable')
              .setDescription('true to enable indexing, false to disable.')
              .setRequired(true),
          ),
      chatInputRegisterOptions(),
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Server only.', ephemeral: true });
      return;
    }

    const enable = interaction.options.getBoolean('enable', true);
    setIndexingEnabled(interaction.guildId, enable);
    const cfg = getGuildConfig(interaction.guildId);

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

    await interaction.reply({ content: lines.join('\n'), ephemeral: true });

    this.container.logger.info(
      `[roast-setup] guild=${interaction.guildId} indexing=${cfg.indexing_enabled}`,
    );
  }
}
