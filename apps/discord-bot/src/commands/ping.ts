import { Command } from '@sapphire/framework';
import { applyScopeToBuilder, registerScope } from '../lib/permissions';

const devGuildId = process.env.DISCORD_DEV_GUILD_ID;

const SCOPE = { baseline: 'everyone' } as const;
registerScope('ping', SCOPE);

export class PingCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      requiredClientPermissions: ['SendMessages'],
      preconditions: ['AtmosferaScope'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) => applyScopeToBuilder(builder.setName('ping').setDescription('Pong!'), SCOPE),
      devGuildId ? { guildIds: [devGuildId], idHints: [] } : { idHints: [] },
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    return interaction.reply('Pong!');
  }
}
