import { Listener } from '@sapphire/framework';
import { Events, type Message, type User } from 'discord.js';
import {
  getGuildConfig,
  recordActivity,
  recordInteractions,
  type InteractionEdge,
} from '@atmosfera/user-roast';

/**
 * Extract metadata-only stats from a Discord message. The full text is read
 * locally only — none of it is returned, stored, or persisted.
 */
function extractMessageStats(message: Message) {
  const text = message.content ?? '';
  return {
    length: text.length,
    mentionCount: message.mentions.users.size,
    hasAttachment: message.attachments.size > 0,
  };
}

export class MessageActivityListener extends Listener<typeof Events.MessageCreate> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, { ...options, event: Events.MessageCreate });
  }

  public override async run(message: Message): Promise<void> {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (message.system) return;

    const config = getGuildConfig(message.guild.id);
    if (!config.indexing_enabled) return;

    const guildId = message.guild.id;
    const channelId = message.channelId;
    const authorId = message.author.id;
    const createdAt = message.createdTimestamp;

    // Dedup: reply target appears in mentions too; count once as reply.
    let repliedToId: string | null = null;
    if (message.reference && message.type === 19 /* Reply */) {
      try {
        const target = await message.fetchReference();
        if (target && !target.author.bot && target.author.id !== authorId) {
          repliedToId = target.author.id;
        }
      } catch {
        // Reference deleted or inaccessible.
      }
    }

    const edges: InteractionEdge[] = [];
    if (repliedToId) {
      edges.push({
        guildId,
        channelId,
        authorId,
        targetId: repliedToId,
        kind: 'reply',
        createdAt,
      });
    }

    const seen = new Set<string>();
    if (repliedToId) seen.add(repliedToId);
    seen.add(authorId);

    for (const mentioned of message.mentions.users.values() as IterableIterator<User>) {
      if (mentioned.bot) continue;
      if (seen.has(mentioned.id)) continue;
      seen.add(mentioned.id);
      edges.push({
        guildId,
        channelId,
        authorId,
        targetId: mentioned.id,
        kind: 'mention',
        createdAt,
      });
    }

    const stats = extractMessageStats(message);

    recordActivity({
      guildId,
      userId: authorId,
      channelId,
      createdAt,
      length: stats.length,
      mentionCount: stats.mentionCount,
      hasAttachment: stats.hasAttachment,
      isReply: repliedToId !== null,
    });

    recordInteractions(edges);
  }
}
