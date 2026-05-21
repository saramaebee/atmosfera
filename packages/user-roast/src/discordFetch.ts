import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildTextBasedChannel,
  type Snowflake,
} from 'discord.js';
import type { CachedMessage, RoastSession } from './sessionCache';

const PAGE_SIZE = 100;

export interface FetchOptions {
  channelId: Snowflake;
  beforeId?: Snowflake;
  limit?: number;
}

export interface FetchResult {
  messages: CachedMessage[];
  exhausted: boolean;
}

function botCanReadChannel(channel: GuildTextBasedChannel): boolean {
  const me = channel.guild.members.me;
  if (!me) return false;
  const perms = channel.permissionsFor(me);
  return Boolean(
    perms?.has(PermissionFlagsBits.ViewChannel) &&
      perms?.has(PermissionFlagsBits.ReadMessageHistory),
  );
}

export function readableTextChannels(guild: Guild): GuildTextBasedChannel[] {
  const out: GuildTextBasedChannel[] = [];
  for (const channel of guild.channels.cache.values()) {
    if (
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement ||
      channel.type === ChannelType.PublicThread
    ) {
      const tc = channel as GuildTextBasedChannel;
      if (botCanReadChannel(tc)) out.push(tc);
    }
  }
  return out;
}

export async function fetchChannelPage(
  channel: GuildTextBasedChannel,
  opts: { beforeId?: Snowflake; limit?: number } = {},
): Promise<FetchResult> {
  const limit = Math.min(opts.limit ?? PAGE_SIZE, PAGE_SIZE);
  const fetched = await channel.messages.fetch({
    limit,
    ...(opts.beforeId ? { before: opts.beforeId } : {}),
  });

  const messages: CachedMessage[] = [];
  for (const msg of fetched.values()) {
    if (msg.system) continue;
    messages.push({
      id: msg.id,
      channelId: channel.id,
      authorId: msg.author.id,
      createdAt: msg.createdTimestamp,
      content: msg.content,
      isReply: msg.reference !== null && msg.type === 19,
      replyToId: msg.reference?.messageId ?? null,
    });
  }

  return {
    messages,
    exhausted: fetched.size < limit,
  };
}

/**
 * Parallel probe across multiple channels. Updates session cache. Honors budget.
 */
export async function parallelProbe(params: {
  guild: Guild;
  channels: GuildTextBasedChannel[];
  perChannelLimit: number;
  session: RoastSession;
}): Promise<void> {
  const { channels, perChannelLimit, session } = params;
  if (session.budgetRemaining() === 0) return;

  const tasks = channels.map(async (channel) => {
    if (session.budgetRemaining() === 0) return;
    try {
      const result = await fetchChannelPage(channel, { limit: perChannelLimit });
      session.appendBatch(channel.id, result.messages, result.exhausted);
    } catch (err) {
      console.warn(`[roast] probe fetch failed for ${channel.id}:`, err);
    }
  });

  await Promise.all(tasks);
}

/**
 * Paginate further back in a single channel until matchPredicate has matchTarget
 * hits, the channel is exhausted, or fetch budget runs out.
 */
export async function deepenChannel(params: {
  channel: GuildTextBasedChannel;
  session: RoastSession;
  maxPages: number;
  matchPredicate: (msg: CachedMessage) => boolean;
  matchTarget: number;
}): Promise<number> {
  const { channel, session, maxPages, matchPredicate, matchTarget } = params;
  let batch = session.getBatch(channel.id);
  let matches = batch ? batch.messages.filter(matchPredicate).length : 0;

  for (let i = 0; i < maxPages; i++) {
    if (matches >= matchTarget) break;
    if (session.budgetRemaining() === 0) break;
    if (batch?.exhausted) break;

    const beforeId = batch?.oldestId ?? undefined;
    try {
      const result = await fetchChannelPage(channel, { beforeId });
      session.appendBatch(channel.id, result.messages, result.exhausted);
      batch = session.getBatch(channel.id);
      matches = batch ? batch.messages.filter(matchPredicate).length : 0;
    } catch (err) {
      console.warn(`[roast] deepen fetch failed for ${channel.id}:`, err);
      break;
    }
  }
  return matches;
}
