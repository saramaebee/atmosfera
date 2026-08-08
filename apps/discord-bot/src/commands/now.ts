import { Command } from '@sapphire/framework';
import { buildRenderedMessage } from '../lib/charts';
import { resolveCitiesOrPrompt } from '../lib/cities';
import { applyScopeToBuilder, registerScope } from '../lib/permissions';

const devGuildId = process.env.DISCORD_DEV_GUILD_ID;

const SCOPE = { baseline: 'everyone' } as const;
registerScope('now', SCOPE);

export class NowCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      requiredClientPermissions: ['SendMessages', 'AttachFiles'],
      preconditions: ['AtmosferaScope'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        applyScopeToBuilder(
          builder
            .setName('now')
            .setDescription('Current weather and next 24 hours for a city')
            .addStringOption((opt) =>
              opt
                .setName('city')
                .setDescription('e.g. "Buenos Aires" or "Columbia, South Carolina"')
                .setRequired(true),
            ),
          SCOPE,
        ),
      devGuildId ? { guildIds: [devGuildId], idHints: [] } : { idHints: [] },
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const query = interaction.options.getString('city', true);

    const cities = await resolveCitiesOrPrompt(interaction, 'now', [query]);
    if (!cities) return;

    await interaction.deferReply();

    const rendered = await buildRenderedMessage({ command: 'now', cities });
    await interaction.editReply(rendered);
  }
}
