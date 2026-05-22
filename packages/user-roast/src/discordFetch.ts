import {
  ChannelType,
  type Guild,
  type GuildTextBasedChannel,
  PermissionFlagsBits,
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
 * Time-bounded parallel probe. For each channel, pages back until the oldest
 * message in the latest page is older than `cutoffMs`, the channel is
 * exhausted, or the session fetch budget is hit. Used to gather the past
 * week's worth of messages per channel for roast synthesis, regardless of
 * how chatty the channel is.
 */
export async function parallelProbeUntil(params: {
  guild: Guild;
  channels: GuildTextBasedChannel[];
  cutoffMs: number;
  session: RoastSession;
  /** Hard cap on Discord pages fetched per channel. Defaults to 10 (≈1000 msgs). */
  maxPagesPerChannel?: number;
}): Promise<void> {
  const { channels, cutoffMs, session, maxPagesPerChannel = 10 } = params;
  if (session.budgetRemaining() === 0) return;

  const tasks = channels.map(async (channel) => {
    let beforeId: Snowflake | undefined;
    for (let page = 0; page < maxPagesPerChannel; page++) {
      if (session.budgetRemaining() === 0) return;
      try {
        const res = await fetchChannelPage(channel, { beforeId });
        if (res.messages.length === 0) return;
        session.appendBatch(channel.id, res.messages, res.exhausted);
        if (res.exhausted) return;
        // Discord returns messages newest-first; last entry is oldest in batch.
        const oldest = res.messages[res.messages.length - 1];
        if (!oldest) return;
        if (oldest.createdAt < cutoffMs) return;
        beforeId = oldest.id;
      } catch (err) {
        console.warn(`[roast] probeUntil fetch failed for ${channel.id}:`, err);
        return;
      }
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
