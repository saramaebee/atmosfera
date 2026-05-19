import { Command } from '@sapphire/framework';
import { buildRenderedMessage } from '../lib/charts';
import { resolveCitiesOrPrompt } from '../lib/cities';

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

    const cities = await resolveCitiesOrPrompt(interaction, 'climate', [query]);
    if (!cities) return;

    await interaction.deferReply();
    const rendered = await buildRenderedMessage({ command: 'climate', cities });
    await interaction.editReply(rendered);
  }
}
