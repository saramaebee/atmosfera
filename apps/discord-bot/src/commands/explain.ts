import {
  getExplainMode,
  isExplainAllowedInChannel,
  listExplainChannels,
  runExplain,
} from '@atmosfera/explain';
import { BlockedBySafetyError } from '@atmosfera/gemini';
import { Command } from '@sapphire/framework';
import {
  type ApplicationCommandDataResolvable,
  ApplicationCommandType,
  EmbedBuilder,
  type GuildTextBasedChannel,
  type Message,
  type MessageContextMenuCommandInteraction,
} from 'discord.js';
import { registerScope } from '../lib/permissions';

const SCOPE = { baseline: 'everyone' } as const;
registerScope('Explain', SCOPE);

export const EXPLAIN_COMMAND_NAME = 'Explain';

/**
 * The Discord application-command definition for Explain. Unlike every other
 * command, Explain is NOT registered through Sapphire — its per-guild presence
 * is managed manually (see explainCommandSync) so a guild in 'off' mode has the
 * command fully removed (invisible in the right-click → Apps menu). Sapphire
 * still routes the interaction to this piece by command name, so the
 * AtmosferaScope precondition and requiredClientPermissions still apply.
 */
export function buildExplainCommandData(): ApplicationCommandDataResolvable {
  return { name: EXPLAIN_COMMAND_NAME, type: ApplicationCommandType.Message };
}

const MAX_POINT_BODY = 350;
const EMBED_COLOR = 0x6c8eef;

export class ExplainCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'Explain',
      // Public reply in-channel → SendMessages + EmbedLinks. Context fetch reads
      // surrounding messages → ViewChannel + ReadMessageHistory.
      requiredClientPermissions: [
        'SendMessages',
        'EmbedLinks',
        'ViewChannel',
        'ReadMessageHistory',
      ],
      preconditions: ['AtmosferaScope'],
    });
  }

  // NOTE: intentionally no registerApplicationCommands override. Explain is
  // registered per-guild via discord.js (explainCommandSync), not Sapphire, so
  // that 'off' guilds have it removed entirely. Sapphire still dispatches the
  // interaction to this piece by command name.

  public override async contextMenuRun(interaction: Command.ContextMenuCommandInteraction) {
    if (!interaction.isMessageContextMenuCommand()) {
      await interaction.reply({ content: 'This command only works on messages.', ephemeral: true });
      return;
    }
    const msgInteraction = interaction as MessageContextMenuCommandInteraction;
    if (!msgInteraction.inGuild() || !msgInteraction.guild) {
      await msgInteraction.reply({ content: 'Server only.', ephemeral: true });
      return;
    }

    // Per-guild availability gate. In 'off' mode the command is normally
    // deregistered (this is defense-in-depth against a stale client); in
    // 'allowlist' mode it's restricted to specific channels. Must run before
    // deferReply() so the rejection can be ephemeral.
    if (!isExplainAllowedInChannel(msgInteraction.guildId, msgInteraction.channelId)) {
      let content: string;
      if (getExplainMode(msgInteraction.guildId) === 'off') {
        content = 'The Explain command is currently disabled in this server.';
      } else {
        const allowed = listExplainChannels(msgInteraction.guildId);
        const mentions = allowed.map((c) => `<#${c.channelId}>`).join(', ');
        content = `The Explain command can't be used in this channel. Allowed channel${
          allowed.length === 1 ? '' : 's'
        }: ${mentions}.`;
      }
      await msgInteraction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }

    const targetMessage = msgInteraction.targetMessage as Message;
    if (!targetMessage.content || !targetMessage.content.trim()) {
      await msgInteraction.reply({
        content: 'That message has no text content to explain (attachments/embeds only).',
        ephemeral: true,
      });
      return;
    }

    const channel = msgInteraction.channel as GuildTextBasedChannel | null;
    if (!channel) {
      await msgInteraction.reply({ content: 'Could not resolve channel.', ephemeral: true });
      return;
    }

    // Public deferred reply — explanations are for the whole channel.
    await msgInteraction.deferReply();

    try {
      const result = await runExplain({ channel, targetMessage });

      const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setAuthor({
          name: `Explaining a message by ${targetMessage.author.displayName ?? targetMessage.author.username}`,
          iconURL: targetMessage.author.displayAvatarURL({ size: 64 }),
        })
        .setTitle(formatTitle(result.targetLanguage, result.oneLineSummary))
        .addFields(
          result.points.slice(0, 4).map((p) => ({
            name: truncate(p.heading, 80),
            value: truncate(p.body, MAX_POINT_BODY),
            inline: false,
          })),
        );

      const footerParts: string[] = [];
      if (result.nativeContextSources.length > 0) {
        const mentions = result.nativeContextSources.map((id) => `<@${id}>`).join(', ');
        footerParts.push(`Drawing on explanations from: ${mentions}`);
      } else if (!result.hadNativeRolesConfigured) {
        footerParts.push('No native-speaker roles configured for this server.');
      }
      footerParts.push(`Invoked by ${msgInteraction.user.username}`);
      embed.setFooter({ text: footerParts.join(' · ') });
      embed.setURL(targetMessage.url);

      await msgInteraction.editReply({
        embeds: [embed],
        // Allow user mentions in the embed body so source-attribution pings work.
        allowedMentions: { users: result.nativeContextSources },
      });
    } catch (err) {
      this.container.logger.error('explain pipeline failed:', err);
      await msgInteraction.editReply({ content: formatErrorMessage(err) });
    }
  }
}

function formatTitle(lang: 'english' | 'spanish' | 'mixed' | 'other', summary: string): string {
  const label =
    lang === 'english'
      ? 'English'
      : lang === 'spanish'
        ? 'Spanish'
        : lang === 'mixed'
          ? 'Mixed EN/ES'
          : 'Other';
  return `${label} — ${truncate(summary, 220)}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatErrorMessage(err: unknown, max = 1800): string {
  if (err instanceof BlockedBySafetyError) {
    return "🛑 Couldn't generate an explanation — the model's safety filter blocked the response. Try a different message.";
  }
  const raw = err instanceof Error ? err.message : String(err);
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const truncated = collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
  return `Explanation failed: ${truncated}.`;
}
