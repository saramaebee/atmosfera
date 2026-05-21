import { loadClimateCube } from '@atmosfera/climate';
import { RoastApiKeyMissingError, getRoast } from '@atmosfera/city-roast';
import { getEnv } from '@atmosfera/config';
import { BlockedBySafetyError } from '@atmosfera/gemini';
import {
  getGuildConfig,
  getRoastOptoutState,
  hasBrutalOptin,
  runRoast,
  type RoastTone,
} from '@atmosfera/user-roast';
import { Command } from '@sapphire/framework';
import { EmbedBuilder, type GuildMember, MessageFlags } from 'discord.js';
import { cityDisplayName, resolveCitiesOrPrompt } from '../lib/cities';
import { chatInputRegisterOptions } from '../lib/commandScope';
import { addRoastOptions, parseRoastOptions } from '../lib/roast-options';
import { sendUserRoastPreview } from '../lib/userRoastPreview';

export class RoastCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, { ...options, name: 'roast', description: 'Roast a city or a server member.' });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName('roast')
          .setDescription('Roast a city or a server member.')
          .setDMPermission(false)
          .addSubcommand((sub) =>
            addRoastOptions(
              sub
                .setName('city')
                .setDescription("Roast a city's climate (text only, no chart).")
                .addStringOption((opt) =>
                  opt
                    .setName('city')
                    .setDescription('e.g. "Buenos Aires" or "Columbia, South Carolina"')
                    .setRequired(true),
                ),
            ),
          )
          .addSubcommand((sub) =>
            sub
              .setName('user')
              .setDescription('Roast a server member based on their message patterns.')
              .addUserOption((o) =>
                o.setName('user').setDescription('Who to roast.').setRequired(true),
              )
              .addBooleanOption((o) =>
                o
                  .setName('brutal')
                  .setDescription('Brutal tone (requires target to have opted in).')
                  .setRequired(false),
              ),
          ),
      chatInputRegisterOptions(),
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand(true);
    if (sub === 'city') return this.runCity(interaction);
    if (sub === 'user') return this.runUser(interaction);
  }

  private async runCity(interaction: Command.ChatInputCommandInteraction): Promise<void> {
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

  private async runUser(interaction: Command.ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({ content: 'Server only.', ephemeral: true });
      return;
    }

    const cfg = getGuildConfig(interaction.guildId);
    if (!cfg.slash_enabled) {
      await interaction.reply({
        content: 'User-roasting is disabled in this server.',
        ephemeral: true,
      });
      return;
    }

    const targetUser = interaction.options.getUser('user', true);
    const brutal = interaction.options.getBoolean('brutal') ?? false;
    const invokerMember = interaction.member as GuildMember | null;
    if (!invokerMember) {
      await interaction.reply({ content: 'Could not resolve invoker.', ephemeral: true });
      return;
    }

    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.reply({ content: 'Target not in this server.', ephemeral: true });
      return;
    }
    if (targetMember.user.bot) {
      await interaction.reply({
        content: "I don't roast bots. Have some self-respect.",
        ephemeral: true,
      });
      return;
    }

    const participation = checkParticipation({
      invokerId: invokerMember.id,
      targetId: targetMember.id,
      targetDisplay: targetMember.displayName,
      guildId: interaction.guildId,
    });
    if (participation.error) {
      await interaction.reply({ content: participation.error, ephemeral: true });
      return;
    }

    const toneCheck = resolveTone({
      guildId: interaction.guildId,
      targetId: targetMember.id,
      brutal,
    });
    if (toneCheck.error) {
      await interaction.reply({ content: toneCheck.error, ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await runRoast({
        guild: interaction.guild,
        target: targetMember,
        invoker: invokerMember,
        tone: toneCheck.tone,
      });

      await sendUserRoastPreview({
        invokerId: interaction.user.id,
        invocationId: result.invocationId,
        targetDisplay: targetMember.displayName,
        roast: result,
        interaction,
      });
    } catch (err) {
      this.container.logger.error('roast pipeline failed:', err);
      await interaction.editReply({ content: formatErrorMessage(err) });
    }
  }
}

function checkParticipation(params: {
  invokerId: string;
  targetId: string;
  targetDisplay: string;
  guildId: string;
}): { error: string | null } {
  const invokerState = getRoastOptoutState(params.invokerId, params.guildId);
  if (invokerState.optedOut) {
    return {
      error:
        "You opted out of roasting in this server. If you can't take it, you don't get to dish it. Re-enable with `/roast-user-config participation enable:true` (30-day lock-in).",
    };
  }
  if (params.invokerId !== params.targetId) {
    const targetState = getRoastOptoutState(params.targetId, params.guildId);
    if (targetState.optedOut) {
      return {
        error: `**${params.targetDisplay}** opted out of roasting. Pick on someone your own size — or, you know, anyone who didn't lock the door.`,
      };
    }
  }
  return { error: null };
}

function resolveTone(params: {
  guildId: string;
  targetId: string;
  brutal: boolean;
}): { tone: RoastTone; error: null } | { tone: RoastTone; error: string } {
  if (!params.brutal) return { tone: 'sharp', error: null };
  const cfg = getGuildConfig(params.guildId);
  if (!cfg.brutal_allowed) {
    return {
      tone: 'sharp',
      error:
        'Brutal tone is not allowed in this server. Ask an admin to enable it via `/roast-config brutal_allowed:true`.',
    };
  }
  if (!hasBrutalOptin(params.targetId, params.guildId)) {
    return {
      tone: 'sharp',
      error:
        "Target hasn't opted into brutal-mode roasts. They can opt in with `/roast-user-config brutal enable:true`.",
    };
  }
  return { tone: 'brutal', error: null };
}

function formatErrorMessage(err: unknown, max = 1800): string {
  if (err instanceof BlockedBySafetyError) {
    const src = err.source === 'gemini' ? "Gemini's server-side filter" : "atmosfera's safety policy";
    return `🛑 Roast blocked by ${src} — flagged as **${friendlyCategory(err.category)}** (${err.probability}). Try a different target, tone, or angle.`;
  }
  const raw = err instanceof Error ? err.message : String(err);
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const truncated = collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
  return `Roast failed: ${truncated}.`;
}

function friendlyCategory(category: string): string {
  switch (category) {
    case 'HARM_CATEGORY_HARASSMENT':
      return 'harassment';
    case 'HARM_CATEGORY_HATE_SPEECH':
      return 'hate speech';
    case 'HARM_CATEGORY_SEXUALLY_EXPLICIT':
      return 'sexually explicit content';
    case 'HARM_CATEGORY_DANGEROUS_CONTENT':
      return 'dangerous content';
    default:
      return category;
  }
}
