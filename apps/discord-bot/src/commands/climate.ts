import { Command } from '@sapphire/framework';
import { MessageFlags } from 'discord.js';
import { buildRenderedMessage } from '../lib/charts';
import { resolveCitiesOrPrompt } from '../lib/cities';
import { applyScopeToBuilder, registerScope } from '../lib/permissions';
import { addRoastOptions, maybeGenerateRoast, parseRoastOptions } from '../lib/roast-options';

const devGuildId = process.env.DISCORD_DEV_GUILD_ID;

const SCOPE = { baseline: 'everyone' } as const;
registerScope('climate', SCOPE);

export class ClimateCommand extends Command {
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
          addRoastOptions(
            builder
              .setName('climate')
              .setDescription('Temperature climatology heatmap for a city')
              .addStringOption((opt) =>
                opt
                  .setName('city')
                  .setDescription('e.g. "Buenos Aires" or "Columbia, South Carolina"')
                  .setRequired(true),
              ),
          ),
          SCOPE,
        ),
      devGuildId ? { guildIds: [devGuildId], idHints: [] } : { idHints: [] },
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const query = interaction.options.getString('city', true);
    const roast = parseRoastOptions(interaction);

    const cities = await resolveCitiesOrPrompt(interaction, 'climate', [query]);
    if (!cities) return;

    await interaction.deferReply();

    const roastResult = await maybeGenerateRoast(roast, cities[0]!);
    const rendered = await buildRenderedMessage({
      command: 'climate',
      cities,
      roast: roastResult.text,
    });

    await interaction.editReply(rendered);

    if (roastResult.error) {
      await interaction.followUp({ content: roastResult.error, flags: MessageFlags.Ephemeral });
    }
  }
}
