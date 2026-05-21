import type { Guild, Snowflake } from 'discord.js';
import {
  computeLongestStreak,
  getUserActivityStats,
  getUserChannelDistribution,
  getUserHourHistogram,
  getUserPostingDays,
  getUserRankInGuild,
  getUserRecentLengthBucketHistogram,
} from './db/activity';
import { getGuildConfig } from './db/config';
import { type Partner, getTopPartnersForUser } from './db/interactions';
import { parallelProbe, readableTextChannels } from './discordFetch';
import type { RoastSession } from './sessionCache';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Fingerprint {
  source: 'index' | 'live-probe';
  guildId: Snowflake;
  targetUserId: Snowflake;
  windowDays: number;

  totalMessages: number;
  avgMessageLength: number;
  attachmentRate: number;
  activeChannels: number;
  totalGuildChannels: number;

  rank: { position: number; total: number };
  topChannels: { channelId: string; channelName: string | null; msgCount: number }[];
  hourHistogram: number[];
  longestStreakDays: number;
  topPartners: { userId: string; displayName: string | null; replies: number; mentions: number }[];
  lengthBucketHistogram: number[];
}

async function indexBackedFingerprint(
  guild: Guild,
  targetId: Snowflake,
  windowDays: number,
): Promise<Fingerprint | null> {
  const sinceMs = Date.now() - windowDays * DAY_MS;
  const stats = getUserActivityStats(guild.id, targetId, sinceMs);
  if (stats.total_messages === 0) return null;

  const dist = getUserChannelDistribution(guild.id, targetId, sinceMs);
  const histo = getUserHourHistogram(guild.id, targetId, sinceMs);
  const rank = getUserRankInGuild(guild.id, targetId, sinceMs);
  const days = getUserPostingDays(guild.id, targetId, sinceMs);
  const streak = computeLongestStreak(days);
  const partners: Partner[] = getTopPartnersForUser(guild.id, targetId, sinceMs, 8);
  const lengthHisto = getUserRecentLengthBucketHistogram(
    guild.id,
    targetId,
    Date.now() - 7 * DAY_MS,
  );

  const topChannels = dist.slice(0, 5).map((c) => ({
    channelId: c.channel_id,
    channelName: guild.channels.cache.get(c.channel_id)?.name ?? null,
    msgCount: c.msg_count,
  }));

  const enrichedPartners = await Promise.all(
    partners.map(async (p) => {
      const member =
        guild.members.cache.get(p.partner_id) ??
        (await guild.members.fetch(p.partner_id).catch(() => null));
      return {
        userId: p.partner_id,
        displayName: member?.displayName ?? null,
        replies: p.replies,
        mentions: p.mentions,
      };
    }),
  );

  return {
    source: 'index',
    guildId: guild.id,
    targetUserId: targetId,
    windowDays,
    totalMessages: stats.total_messages,
    avgMessageLength: stats.total_messages > 0 ? stats.total_length / stats.total_messages : 0,
    attachmentRate: stats.total_messages > 0 ? stats.attachment_count / stats.total_messages : 0,
    activeChannels: stats.active_channels,
    totalGuildChannels: readableTextChannels(guild).length,
    rank,
    topChannels,
    hourHistogram: histo.map((h) => h.msg_count),
    longestStreakDays: streak,
    topPartners: enrichedPartners,
    lengthBucketHistogram: lengthHisto,
  };
}

async function liveProbeFingerprint(params: {
  guild: Guild;
  targetUserId: Snowflake;
  invokerUserId: Snowflake;
  session: RoastSession;
}): Promise<Fingerprint> {
  const { guild, targetUserId, session } = params;

  const channels = readableTextChannels(guild);
  await parallelProbe({
    guild,
    channels: channels.slice(0, 12),
    perChannelLimit: 50,
    session,
  });

  const targetMessages = session.allTargetMessages();
  const channelCounts = new Map<string, number>();
  const partnerCounts = new Map<string, { replies: number; mentions: number }>();
  const hourCounts: number[] = new Array<number>(24).fill(0);
  const lenBuckets: number[] = [0, 0, 0, 0, 0];
  let totalLen = 0;

  function bumpBucket(idx: number) {
    lenBuckets[idx] = (lenBuckets[idx] ?? 0) + 1;
  }

  for (const m of targetMessages) {
    channelCounts.set(m.channelId, (channelCounts.get(m.channelId) ?? 0) + 1);
    const hour = new Date(m.createdAt).getUTCHours();
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
    const len = m.content.length;
    totalLen += len;
    if (len <= 5) bumpBucket(0);
    else if (len <= 30) bumpBucket(1);
    else if (len <= 120) bumpBucket(2);
    else if (len <= 500) bumpBucket(3);
    else bumpBucket(4);
    if (m.isReply && m.replyToId) {
      const all = session.getBatch(m.channelId)?.messages ?? [];
      const referenced = all.find((x) => x.id === m.replyToId);
      if (referenced && referenced.authorId !== targetUserId) {
        const entry = partnerCounts.get(referenced.authorId) ?? { replies: 0, mentions: 0 };
        entry.replies += 1;
        partnerCounts.set(referenced.authorId, entry);
      }
    }
  }

  const topChannels = [...channelCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([channelId, msgCount]) => ({
      channelId,
      channelName: guild.channels.cache.get(channelId)?.name ?? null,
      msgCount,
    }));

  const partnerEntries = await Promise.all(
    [...partnerCounts.entries()]
      .sort((a, b) => b[1].replies - a[1].replies)
      .slice(0, 8)
      .map(async ([userId, counts]) => {
        const member =
          guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
        return {
          userId,
          displayName: member?.displayName ?? null,
          replies: counts.replies,
          mentions: counts.mentions,
        };
      }),
  );

  return {
    source: 'live-probe',
    guildId: guild.id,
    targetUserId,
    windowDays: 0,
    totalMessages: targetMessages.length,
    avgMessageLength: targetMessages.length > 0 ? totalLen / targetMessages.length : 0,
    attachmentRate: 0,
    activeChannels: channelCounts.size,
    totalGuildChannels: channels.length,
    rank: { position: -1, total: -1 },
    topChannels,
    hourHistogram: hourCounts,
    longestStreakDays: 0,
    topPartners: partnerEntries,
    lengthBucketHistogram: lenBuckets,
  };
}

export async function buildFingerprint(params: {
  guild: Guild;
  targetUserId: Snowflake;
  invokerUserId: Snowflake;
  session: RoastSession;
  windowDays?: number;
}): Promise<Fingerprint> {
  const windowDays = params.windowDays ?? 30;
  const config = getGuildConfig(params.guild.id);

  if (config.indexing_enabled) {
    const indexed = await indexBackedFingerprint(params.guild, params.targetUserId, windowDays);
    if (indexed) return indexed;
  }

  return liveProbeFingerprint(params);
}

export function summarizeFingerprint(fp: Fingerprint, targetDisplay: string): string {
  const peakHour = fp.hourHistogram.indexOf(Math.max(...fp.hourHistogram));
  const partners = fp.topPartners
    .slice(0, 5)
    .map((p) => `${p.displayName ?? p.userId} (${p.replies}r/${p.mentions}m)`)
    .join(', ');
  const channels = fp.topChannels
    .map((c) => `#${c.channelName ?? c.channelId} (${c.msgCount} msgs)`)
    .join(', ');

  const rank =
    fp.rank.position > 0
      ? `Ranked #${fp.rank.position} of ${fp.rank.total} posters`
      : 'Rank unknown (no index)';

  const channelsIgnored = Math.max(fp.totalGuildChannels - fp.activeChannels, 0);
  const channelContext =
    fp.totalGuildChannels <= 1
      ? `Server has only ${fp.totalGuildChannels} readable channel — channel choice is NOT a viable roast angle.`
      : `Server has ${fp.totalGuildChannels} readable channels; target posts in ${fp.activeChannels} of them (ignores ${channelsIgnored}).`;
  return `Target: ${targetDisplay}
Data source: ${fp.source}${fp.windowDays ? ` (last ${fp.windowDays}d)` : ''}
Total messages observed: ${fp.totalMessages}
Avg message length: ${fp.avgMessageLength.toFixed(1)} chars
${channelContext}
${rank}
Longest posting streak: ${fp.longestStreakDays} days
Peak posting hour (UTC): ${peakHour}:00
Top channels: ${channels || '(none observed)'}
Top interaction partners: ${partners || '(none observed)'}
Hour-of-day histogram (UTC, 0-23): [${fp.hourHistogram.join(', ')}]
Length-bucket histogram [tiny, short, med, long, wall]: [${fp.lengthBucketHistogram.join(', ')}]`;
}
