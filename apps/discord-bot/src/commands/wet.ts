import { Command } from '@sapphire/framework';
import { MessageFlags } from 'discord.js';
import { buildRenderedMessage } from '../lib/charts';
import { resolveCitiesOrPrompt } from '../lib/cities';
import { addRoastOptions, maybeGenerateRoast, parseRoastOptions } from '../lib/roast-options';

const devGuildId = process.env.DISCORD_DEV_GUILD_ID;

export class WetCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        addRoastOptions(
          builder
            .setName('wet')
            .setDescription('Wet-day probability across the year for a city')
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
    const roast = parseRoastOptions(interaction);

    const cities = await resolveCitiesOrPrompt(interaction, 'wet', [query]);
    if (!cities) return;

    await interaction.deferReply();

    const roastResult = await maybeGenerateRoast(roast, cities[0]!);
    const rendered = await buildRenderedMessage({
      command: 'wet',
      cities,
      roast: roastResult.text,
    });

    await interaction.editReply(rendered);

    if (roastResult.error) {
      await interaction.followUp({ content: roastResult.error, flags: MessageFlags.Ephemeral });
    }
  }
}
