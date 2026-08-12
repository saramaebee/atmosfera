import { fetchRadarCatalog } from '@atmosfera/climate';
import { listBotOwnerIds } from '@atmosfera/config';
import { BucketScope, Command } from '@sapphire/framework';
import { MessageFlags } from 'discord.js';
import { type RadarMode, buildRenderedMessage } from '../lib/charts';
import { resolveCitiesOrPrompt } from '../lib/cities';
import { chatInputRegisterOptions } from '../lib/commandScope';
import { applyScopeToBuilder, registerScope } from '../lib/permissions';

const SCOPE = { baseline: 'everyone' } as const;
registerScope('radar', SCOPE);

const NOWCAST_UNAVAILABLE =
  'Nowcast radar is unavailable right now — our data provider (RainViewer) ' +
  "isn't currently publishing forecast frames on their free API. " +
  'Past radar still works: try `/radar` with mode **Past 2 hours**.';

export class RadarCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      requiredClientPermissions: ['SendMessages', 'AttachFiles'],
      preconditions: ['AtmosferaScope'],
      // Each build costs ~5 s of CPU; the cooldown is the guard against a
      // user looping /radar (concurrent duplicates coalesce in charts.ts).
      cooldownDelay: 30_000,
      cooldownLimit: 1,
      cooldownScope: BucketScope.User,
      // Bot owners bypass the cooldown (mirrors ownerOverride in the RBAC
      // layer). Env is read once at construction — owner changes need a
      // restart anyway (see listBotOwnerIds).
      cooldownFilteredUsers: [...listBotOwnerIds()],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        applyScopeToBuilder(
          builder
            .setName('radar')
            .setDescription('Animated precipitation radar for a city — past 2 hours or nowcast')
            .addStringOption((opt) =>
              opt
                .setName('city')
                .setDescription('e.g. "Buenos Aires" or "Columbia, South Carolina"')
                .setRequired(true),
            )
            .addStringOption((opt) =>
              opt
                .setName('mode')
                .setDescription('Past loop or nowcast (default: past)')
                .addChoices(
                  { name: 'Past 2 hours', value: 'past' },
                  { name: 'Nowcast (next ~30 min)', value: 'nowcast' },
                ),
            ),
          SCOPE,
        ),
      chatInputRegisterOptions(),
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const query = interaction.options.getString('city', true);
    const mode = (interaction.options.getString('mode') ?? 'past') as RadarMode;

    // Availability is checked against the live catalog, before geocoding: no
    // point resolving a city for frames that don't exist. The catalog is
    // cached (3 min TTL), so this is instant when warm and the subsequent GIF
    // build sees the same frames. Ephemeral replies must happen before the
    // public deferReply, which is why this can't live in buildRadarMessage.
    if (mode === 'nowcast') {
      let nowcastAvailable: boolean;
      try {
        nowcastAvailable = (await fetchRadarCatalog()).radar.nowcast.length > 0;
      } catch {
        nowcastAvailable = false;
      }
      if (!nowcastAvailable) {
        await interaction.reply({ content: NOWCAST_UNAVAILABLE, flags: MessageFlags.Ephemeral });
        return;
      }
    }

    const cities = await resolveCitiesOrPrompt(interaction, 'radar', [query], undefined, mode);
    if (!cities) return;

    await interaction.deferReply();

    const rendered = await buildRenderedMessage({ command: 'radar', cities, radarMode: mode });
    await interaction.editReply(rendered);
  }
}
