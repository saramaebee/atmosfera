import { renderMuggyComparisonSvg, svgToPng } from '@atmosfera/charts';
import { loadClimateCube } from '@atmosfera/climate';
import { Command } from '@sapphire/framework';
import { AttachmentBuilder } from 'discord.js';
import { cityDisplayName, resolveCityOrReply } from '../lib/cities';

const devGuildId = process.env.DISCORD_DEV_GUILD_ID;

export class MuggyCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName('muggy')
          .setDescription('Muggy probability across the year for a city')
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
    if (!city) return; // resolveCityOrReply already sent an ephemeral reply

    // Only defer (publicly) once we know we're committing to a render.
    await interaction.deferReply();

    const cube = await loadClimateCube({
      latitude: city.latitude,
      longitude: city.longitude,
      timezone: city.timezone,
    });

    const svg = renderMuggyComparisonSvg([{ name: city.canonicalName, cube }]);
    const png = svgToPng(svg);

    const attachment = new AttachmentBuilder(png, {
      name: `muggy-${slugify(city.canonicalName)}.png`,
    });

    await interaction.editReply({
      content: `**${cityDisplayName(city)}** — muggy probability climatology (${cube.window.startYear}–${cube.window.endYear}).`,
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
