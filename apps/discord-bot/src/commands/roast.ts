import { BlockedBySafetyError } from '@atmosfera/gemini';
import {
  getGuildConfig,
  getRoastOptoutState,
  hasBrutalOptin,
  runRoast,
  type RoastTone,
} from '@atmosfera/user-roast';
import { Command } from '@sapphire/framework';
import type { GuildMember } from 'discord.js';
import { chatInputRegisterOptions } from '../lib/commandScope';
import { applyScopeToBuilder, registerScope } from '../lib/permissions';
import { sendUserRoastPreview } from '../lib/userRoastPreview';

const SCOPE = { baseline: 'everyone' } as const;
registerScope('roast', SCOPE);

export class RoastCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'roast',
      description: 'Roast a server member based on their message patterns.',
      requiredClientPermissions: [
        'SendMessages',
        'SendMessagesInThreads',
        'EmbedLinks',
        'ViewChannel',
        'ReadMessageHistory',
      ],
      preconditions: ['AtmosferaScope'],
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        applyScopeToBuilder(
          builder
            .setName('roast')
            .setDescription('Roast a server member based on their message patterns.')
            .setDMPermission(false)
            .addUserOption((o) =>
              o.setName('user').setDescription('Who to roast.').setRequired(true),
            )
            .addBooleanOption((o) =>
              o
                .setName('brutal')
                .setDescription('Brutal tone (requires target to have opted in).')
                .setRequired(false),
            ),
          SCOPE,
        ),
      chatInputRegisterOptions(),
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
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
    const src =
      err.source === 'gemini' ? "Gemini's server-side filter" : "atmosfera's safety policy";
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
