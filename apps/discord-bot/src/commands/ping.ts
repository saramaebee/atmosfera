import { Command } from '@sapphire/framework';

const devGuildId = process.env.DISCORD_DEV_GUILD_ID;

export class PingCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) => builder.setName('ping').setDescription('Pong!'),
      devGuildId ? { guildIds: [devGuildId], idHints: [] } : { idHints: [] },
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    return interaction.reply('Pong!');
  }
}
