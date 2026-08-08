import { Command } from '@sapphire/framework';
import { type CompareChartChoice, buildRenderedMessage } from '../lib/charts';
import { resolveCitiesOrPrompt } from '../lib/cities';
import { applyScopeToBuilder, registerScope } from '../lib/permissions';

const devGuildId = process.env.DISCORD_DEV_GUILD_ID;

const SCOPE = { baseline: 'everyone' } as const;
registerScope('compare', SCOPE);

export class CompareCommand extends Command {
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
          builder
            .setName('compare')
            .setDescription('Compare two cities — temperature heatmap and/or muggy probability')
            .addStringOption((opt) =>
              opt
                .setName('city_a')
                .setDescription('First city, e.g. "Buenos Aires"')
                .setRequired(true),
            )
            .addStringOption((opt) =>
              opt.setName('city_b').setDescription('Second city, e.g. "Tokyo"').setRequired(true),
            )
            .addStringOption((opt) =>
              opt
                .setName('chart')
                .setDescription('Which chart to show (default: heatmap)')
                .setRequired(false)
                .addChoices(
                  { name: 'Temperature heatmap', value: 'heatmap' },
                  { name: 'Muggy probability', value: 'muggy' },
                  { name: 'Wet-day probability', value: 'wetday' },
                  { name: 'All three', value: 'all' },
                ),
            )
            .addBooleanOption((opt) =>
              opt
                .setName('wetbulb')
                .setDescription(
                  'Add wet-bulb heat-stress summary per city (pairs best with chart:muggy)',
                )
                .setRequired(false),
            ),
          SCOPE,
        ),
      devGuildId ? { guildIds: [devGuildId], idHints: [] } : { idHints: [] },
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const queryA = interaction.options.getString('city_a', true);
    const queryB = interaction.options.getString('city_b', true);
    const chart = (interaction.options.getString('chart') ?? 'heatmap') as CompareChartChoice;
    const wetBulb = interaction.options.getBoolean('wetbulb') ?? false;

    const cities = await resolveCitiesOrPrompt(interaction, 'compare', [queryA, queryB], chart);
    if (!cities) return;

    await interaction.deferReply();

    const rendered = await buildRenderedMessage({
      command: 'compare',
      cities,
      chart,
      wetBulb,
    });

    await interaction.editReply(rendered);
  }
}
