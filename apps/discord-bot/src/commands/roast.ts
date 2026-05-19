import { loadClimateCube } from '@atmosfera/climate';
import { getEnv } from '@atmosfera/config';
import { RoastApiKeyMissingError, getRoast } from '@atmosfera/roast';
import { Command } from '@sapphire/framework';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { cityDisplayName, resolveCitiesOrPrompt } from '../lib/cities';
import { addRoastOptions, parseRoastOptions } from '../lib/roast-options';

const devGuildId = process.env.DISCORD_DEV_GUILD_ID;

export class RoastCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        addRoastOptions(
          builder
            .setName('roast')
            .setDescription("Roast a city's climate (text only, no chart)")
            .addStringOption((opt) =>
              opt
                .setName('city')
                .setDescription('e.g. "Buenos Aires" or "Columbia, South Carolina"')
                .setRequired(true),
            ),
        ),
      devGuildId ? { guildIds: [devGuildId], idHints: [] } : { idHints: [] },
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const query = interaction.options.getString('city', true);
    const parsed = parseRoastOptions(interaction);

    const env = getEnv();
    if (!env.GEMINI_API_KEY) {
      await interaction.reply({
        content: 'Roast unavailable — `GEMINI_API_KEY` not configured.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cities = await resolveCitiesOrPrompt(interaction, 'roast', [query]);
    if (!cities) return;
    const city = cities[0]!;

    await interaction.deferReply();

    const cube = await loadClimateCube({
      latitude: city.latitude,
      longitude: city.longitude,
      timezone: city.timezone,
    });

    let text: string;
    try {
      text = await getRoast(
        {
          tone: parsed.tone,
          culture: parsed.culture,
          length: parsed.length,
          apiKey: env.GEMINI_API_KEY,
        },
        city,
        cube,
      );
    } catch (e) {
      if (e instanceof RoastApiKeyMissingError) {
        await interaction.editReply('Roast unavailable — `GEMINI_API_KEY` not configured.');
        return;
      }
      await interaction.editReply(`Roast failed: ${(e as Error).message}`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🔥 ${cityDisplayName(city)}`)
      .setDescription(text)
      .setColor(0xf97316)
      .setFooter({
        text: `Climatology ${cube.window.startYear}–${cube.window.endYear} · ${parsed.tone} · ${parsed.length}${parsed.culture ? '' : ' · no-culture'}`,
      });

    await interaction.editReply({ embeds: [embed] });
  }
}
