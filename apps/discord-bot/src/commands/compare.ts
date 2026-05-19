import { Command } from '@sapphire/framework';
import { MessageFlags } from 'discord.js';
import { type CompareChartChoice, buildRenderedMessage } from '../lib/charts';
import { resolveCitiesOrPrompt } from '../lib/cities';
import {
  addRoastOptions,
  maybeGenerateContrastRoast,
  parseRoastOptions,
} from '../lib/roast-options';

const devGuildId = process.env.DISCORD_DEV_GUILD_ID;

export class CompareCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        addRoastOptions(
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
            ),
        ),
      devGuildId ? { guildIds: [devGuildId], idHints: [] } : { idHints: [] },
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const queryA = interaction.options.getString('city_a', true);
    const queryB = interaction.options.getString('city_b', true);
    const chart = (interaction.options.getString('chart') ?? 'heatmap') as CompareChartChoice;
    const roast = parseRoastOptions(interaction);

    const cities = await resolveCitiesOrPrompt(interaction, 'compare', [queryA, queryB], chart);
    if (!cities) return;

    await interaction.deferReply();

    const roastResult = await maybeGenerateContrastRoast(roast, cities[0]!, cities[1]!);
    const rendered = await buildRenderedMessage({
      command: 'compare',
      cities,
      chart,
      roast: roastResult.text,
    });

    await interaction.editReply(rendered);

    if (roastResult.error) {
      await interaction.followUp({ content: roastResult.error, flags: MessageFlags.Ephemeral });
    }
  }
}
