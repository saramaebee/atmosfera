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

export class CompareCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName('compare')
          .setDescription('Compare two cities — muggy probability + temperature heatmap')
          .addStringOption((opt) =>
            opt
              .setName('city_a')
              .setDescription('First city, e.g. "Buenos Aires"')
              .setRequired(true),
          )
          .addStringOption((opt) =>
            opt.setName('city_b').setDescription('Second city, e.g. "Tokyo"').setRequired(true),
          ),
      devGuildId ? { guildIds: [devGuildId], idHints: [] } : { idHints: [] },
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const queryA = interaction.options.getString('city_a', true);
    const queryB = interaction.options.getString('city_b', true);

    const cities = await resolveCitiesOrReply(interaction, [queryA, queryB]);
    if (!cities) return;

    const [cityA, cityB] = cities;
    if (!cityA || !cityB) return; // invariant: length 2 in success path

    await interaction.deferReply();

    // Build cubes in parallel (Open-Meteo fetch is rate-limited per-host but
    // parallel is fine for two cities; the slow path is the year-by-year fetch
    // inside each cube build).
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

    const muggySvg = renderMuggyComparisonSvg(series);
    const heatmapSvg = renderTemperatureComparisonSvg(series);
    const muggyPng = svgToPng(muggySvg);
    const heatmapPng = svgToPng(heatmapSvg);

    const slug = `${slugify(cityA.canonicalName)}-vs-${slugify(cityB.canonicalName)}`;

    await interaction.editReply({
      content: `**${cityDisplayName(cityA)}** vs **${cityDisplayName(cityB)}** — climatology ${cubeA.window.startYear}–${cubeA.window.endYear}.`,
      files: [
        new AttachmentBuilder(heatmapPng, { name: `heatmap-${slug}.png` }),
        new AttachmentBuilder(muggyPng, { name: `muggy-${slug}.png` }),
      ],
    });
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
