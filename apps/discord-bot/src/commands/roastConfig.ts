import {
  getGuildConfig,
  setBrutalAllowed,
  setMessageEnabled,
  setSlashEnabled,
} from '@atmosfera/user-roast';
import { Command } from '@sapphire/framework';
import { PermissionFlagsBits } from 'discord.js';
import { chatInputRegisterOptions } from '../lib/commandScope';

export class RoastConfigCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'roast-config' });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName('roast-config')
          .setDescription('Configure user-roast triggers and tone allowances for this server.')
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
          .setDMPermission(false)
          .addBooleanOption((o) =>
            o.setName('slash').setDescription('Allow /roast user as a slash command in this server.'),
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
      chatInputRegisterOptions(),
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Server only.', ephemeral: true });
      return;
    }

    const slash = interaction.options.getBoolean('slash');
    const message = interaction.options.getBoolean('message');
    const brutal = interaction.options.getBoolean('brutal_allowed');

    if (slash !== null) setSlashEnabled(interaction.guildId, slash);
    if (message !== null) setMessageEnabled(interaction.guildId, message);
    if (brutal !== null) setBrutalAllowed(interaction.guildId, brutal);

    const cfg = getGuildConfig(interaction.guildId);
    await interaction.reply({
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
