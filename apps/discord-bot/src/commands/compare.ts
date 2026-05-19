import {
  type CitySeries,
  renderMuggyComparisonSvg,
  renderTemperatureComparisonSvg,
  svgToPng,
} from '@atmosfera/charts';
import { loadClimateCube } from '@atmosfera/climate';
import { Command } from '@sapphire/framework';
import { AttachmentBuilder } from 'discord.js';
import { cityDisplayName, resolveCitiesOrReply } from '../lib/cities';

const devGuildId = process.env.DISCORD_DEV_GUILD_ID;

type ChartChoice = 'both' | 'heatmap' | 'muggy';

export class CompareCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
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
                { name: 'Both', value: 'both' },
              ),
          ),
      devGuildId ? { guildIds: [devGuildId], idHints: [] } : { idHints: [] },
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const queryA = interaction.options.getString('city_a', true);
    const queryB = interaction.options.getString('city_b', true);
    const chart = (interaction.options.getString('chart') ?? 'heatmap') as ChartChoice;

    const cities = await resolveCitiesOrReply(interaction, [queryA, queryB]);
    if (!cities) return;

    const [cityA, cityB] = cities;
    if (!cityA || !cityB) return;

    await interaction.deferReply();

    const [cubeA, cubeB] = await Promise.all([
      loadClimateCube({
        latitude: cityA.latitude,
        longitude: cityA.longitude,
        timezone: cityA.timezone,
      }),
      loadClimateCube({
        latitude: cityB.latitude,
        longitude: cityB.longitude,
        timezone: cityB.timezone,
      }),
    ]);

    const series: CitySeries[] = [
      { name: cityA.canonicalName, cube: cubeA },
      { name: cityB.canonicalName, cube: cubeB },
    ];

    const slug = `${slugify(cityA.canonicalName)}-vs-${slugify(cityB.canonicalName)}`;
    const files: AttachmentBuilder[] = [];

    if (chart === 'heatmap' || chart === 'both') {
      const png = svgToPng(renderTemperatureComparisonSvg(series));
      files.push(new AttachmentBuilder(png, { name: `heatmap-${slug}.png` }));
    }
    if (chart === 'muggy' || chart === 'both') {
      const png = svgToPng(renderMuggyComparisonSvg(series));
      files.push(new AttachmentBuilder(png, { name: `muggy-${slug}.png` }));
    }

    await interaction.editReply({
      content: `**${cityDisplayName(cityA)}** vs **${cityDisplayName(cityB)}** — climatology ${cubeA.window.startYear}–${cubeA.window.endYear}.`,
      files,
    });
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
