import { Command } from '@sapphire/framework';
import { buildRenderedMessage } from '../lib/charts';
import { resolveCitiesOrPrompt } from '../lib/cities';
import { applyScopeToBuilder, registerScope } from '../lib/permissions';
import { addThemeOption, getThemeOption } from '../lib/theme-option';

const devGuildId = process.env.DISCORD_DEV_GUILD_ID;

const SCOPE = { baseline: 'everyone' } as const;
registerScope('muggy', SCOPE);

export class MuggyCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      requiredClientPermissions: ['SendMessages', 'EmbedLinks', 'AttachFiles'],
      preconditions: ['AtmosferaScope'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        applyScopeToBuilder(
          addThemeOption(
            builder
              .setName('muggy')
              .setDescription('Muggy probability across the year for a city')
              .addStringOption((opt) =>
                opt
                  .setName('city')
                  .setDescription('e.g. "Buenos Aires" or "Columbia, South Carolina"')
                  .setRequired(true),
              )
              .addBooleanOption((opt) =>
                opt
                  .setName('wetbulb')
                  .setDescription('Add wet-bulb heat-stress summary (default: off)')
                  .setRequired(false),
              ),
          ),
          SCOPE,
        ),
      devGuildId ? { guildIds: [devGuildId], idHints: [] } : { idHints: [] },
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const query = interaction.options.getString('city', true);
    const wetBulb = interaction.options.getBoolean('wetbulb') ?? false;
    const theme = getThemeOption(interaction);

    const cities = await resolveCitiesOrPrompt(interaction, 'muggy', [query], { theme, wetBulb });
    if (!cities) return;

    await interaction.deferReply();

    const rendered = await buildRenderedMessage({
      command: 'muggy',
      cities,
      wetBulb,
      theme,
    });

    await interaction.editReply(rendered);
  }
}
