import { renderTemperatureComparisonSvg, svgToPng } from '@atmosfera/charts';
import { loadClimateCube } from '@atmosfera/climate';
import { Command } from '@sapphire/framework';
import { AttachmentBuilder } from 'discord.js';
import { cityDisplayName, resolveCityOrReply } from '../lib/cities';

const devGuildId = process.env.DISCORD_DEV_GUILD_ID;

export class ClimateCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName('climate')
          .setDescription('Temperature climatology heatmap for a city')
          .addStringOption((opt) =>
            opt
              .setName('city')
              .setDescription('e.g. "Buenos Aires" or "Columbia, South Carolina"')
              .setRequired(true),
          ),
      devGuildId ? { guildIds: [devGuildId], idHints: [] } : { idHints: [] },
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const query = interaction.options.getString('city', true);

    const city = await resolveCityOrReply(interaction, query);
    if (!city) return;

    await interaction.deferReply();

    const cube = await loadClimateCube({
      latitude: city.latitude,
      longitude: city.longitude,
      timezone: city.timezone,
    });

    const svg = renderTemperatureComparisonSvg([{ name: city.canonicalName, cube }]);
    const png = svgToPng(svg);

    const attachment = new AttachmentBuilder(png, {
      name: `climate-${slugify(city.canonicalName)}.png`,
    });

    await interaction.editReply({
      content: `**${cityDisplayName(city)}** — temperature climatology (${cube.window.startYear}–${cube.window.endYear}).`,
      files: [attachment],
    });
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
