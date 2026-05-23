import type { Guild, GuildTextBasedChannel, Snowflake } from 'discord.js';
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
import { getRecentTargetMessages } from './db/messages';
import { parallelProbeUntil, readableTextChannels } from './discordFetch';
import type { CachedMessage, RoastSession } from './sessionCache';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Past-week message text is what synthesis needs as a sample — keep this in
 * sync with the user-visible "references last 7 days" expectation. */
const SAMPLE_WINDOW_DAYS = 7;
/** Top channels per target to live-probe deeply. Narrow + deep beats wide +
 * shallow for finding the target's actual recent messages. */
const PROBE_CHANNEL_COUNT = 6;
/** If the local messages_recent store already has at least this many of the
 * target's messages, skip the live Discord probe entirely. The threshold
 * mirrors `sampleMessages.slice(0, 30)` in pipeline.ts — once we hit that
 * many, the synthesis prompt is saturated. */
const DB_SEED_SUFFICIENT_THRESHOLD = 30;
/** Hard cap on rows pulled from messages_recent into the session — keeps the
 * synthesis prompt bounded even on hyper-active users. */
const DB_SEED_LIMIT = 200;

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

/** Build a fingerprint from messages already sitting in the session cache.
 * Assumes the caller has already probed live data. */
async function computeFingerprintFromSession(params: {
  guild: Guild;
  targetUserId: Snowflake;
  session: RoastSession;
}): Promise<Fingerprint> {
  const { guild, targetUserId, session } = params;

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
    windowDays: SAMPLE_WINDOW_DAYS,
    totalMessages: targetMessages.length,
    avgMessageLength: targetMessages.length > 0 ? totalLen / targetMessages.length : 0,
    attachmentRate: 0,
    activeChannels: channelCounts.size,
    totalGuildChannels: readableTextChannels(guild).length,
    rank: { position: -1, total: -1 },
    topChannels,
    hourHistogram: hourCounts,
    longestStreakDays: 0,
    topPartners: partnerEntries,
    lengthBucketHistogram: lenBuckets,
  };
}

/**
 * Pick the channels to live-probe for the target's recent message text.
 * Prefers the index's top channels for the target (they're where they
 * actually post). Falls back to / pads with the first readable channels by
 * position when the index has no signal yet.
 */
function pickProbeChannels(
  guild: Guild,
  indexed: Fingerprint | null,
  count: number,
): GuildTextBasedChannel[] {
  const readable = readableTextChannels(guild);
  const byId = new Map(readable.map((c) => [c.id, c]));
  const picked: GuildTextBasedChannel[] = [];
  const seen = new Set<string>();
  if (indexed) {
    for (const tc of indexed.topChannels) {
      const ch = byId.get(tc.channelId);
      if (ch && !seen.has(ch.id)) {
        picked.push(ch);
        seen.add(ch.id);
        if (picked.length >= count) return picked;
      }
    }
  }
  for (const ch of readable) {
    if (seen.has(ch.id)) continue;
    picked.push(ch);
    seen.add(ch.id);
    if (picked.length >= count) return picked;
  }
  return picked;
}

/**
 * Seed the session cache with rows from messages_recent for this target,
 * grouped by channel so RoastSession can dedupe against any later live probe.
 * Returns the number of rows seeded (caller uses this to decide whether to
 * skip the probe).
 */
function seedSessionFromDb(params: {
  session: RoastSession;
  guildId: Snowflake;
  targetUserId: Snowflake;
  sinceMs: number;
}): number {
  const rows = getRecentTargetMessages(
    params.guildId,
    params.targetUserId,
    params.sinceMs,
    DB_SEED_LIMIT,
  );
  if (rows.length === 0) return 0;
  const byChannel = new Map<string, CachedMessage[]>();
  for (const row of rows) {
    const list = byChannel.get(row.channelId) ?? [];
    list.push(row);
    byChannel.set(row.channelId, list);
  }
  for (const [channelId, msgs] of byChannel) {
    // exhausted=false: the messages_recent store is target-only, so we may
    // still want a live probe later to capture the target's conversational
    // partners' messages (used for reply-edge stitching).
    params.session.appendBatch(channelId, msgs, false);
  }
  return rows.length;
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

  // Stats branch: aggregate counts/ranks/histograms from the index when
  // indexing is enabled; otherwise we'll compute them from the live probe.
  const indexed = config.indexing_enabled
    ? await indexBackedFingerprint(params.guild, params.targetUserId, windowDays)
    : null;

  // Sample-text branch: seed from the local 7d content table first. If we
  // got enough rows for synthesis, skip the live probe — that's the steady-
  // state path and the whole point of storing content. Cold-start guilds and
  // hyper-quiet users fall through to the probe as a backfill.
  const cutoffMs = Date.now() - SAMPLE_WINDOW_DAYS * DAY_MS;
  const seeded = config.indexing_enabled
    ? seedSessionFromDb({
        session: params.session,
        guildId: params.guild.id,
        targetUserId: params.targetUserId,
        sinceMs: cutoffMs,
      })
    : 0;

  if (seeded < DB_SEED_SUFFICIENT_THRESHOLD) {
    const channels = pickProbeChannels(params.guild, indexed, PROBE_CHANNEL_COUNT);
    await parallelProbeUntil({
      guild: params.guild,
      channels,
      cutoffMs,
      session: params.session,
    });
  }

  if (indexed) return indexed;
  return computeFingerprintFromSession({
    guild: params.guild,
    targetUserId: params.targetUserId,
    session: params.session,
  });
}

export interface SummarizeFingerprintOptions {
  /**
   * When true, omit the channel-distribution + hour/length histograms from
   * the summary. Knob (`roast_deemphasize_channel_dist`) for A/B-ing whether
   * the model's "monoculture" tendency disappears without that signal.
   */
  deemphasizeChannelDist?: boolean;
}

export function summarizeFingerprint(
  fp: Fingerprint,
  targetDisplay: string,
  options: SummarizeFingerprintOptions = {},
): string {
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
  const channelContext = options.deemphasizeChannelDist
    ? null
    : fp.totalGuildChannels <= 1
      ? `Server has only ${fp.totalGuildChannels} readable channel — channel choice is NOT a viable roast angle.`
      : `Server has ${fp.totalGuildChannels} readable channels; target posts in ${fp.activeChannels} of them (ignores ${channelsIgnored}).`;

  const lines = [
    `Target: ${targetDisplay}`,
    `Data source: ${fp.source}${fp.windowDays ? ` (last ${fp.windowDays}d)` : ''}`,
    `Total messages observed: ${fp.totalMessages}`,
    `Avg message length: ${fp.avgMessageLength.toFixed(1)} chars`,
  ];
  if (channelContext) lines.push(channelContext);
  lines.push(rank);
  lines.push(`Longest posting streak: ${fp.longestStreakDays} days`);
  if (!options.deemphasizeChannelDist) {
    lines.push(`Peak posting hour (UTC): ${peakHour}:00`);
    lines.push(`Top channels: ${channels || '(none observed)'}`);
  }
  lines.push(`Top interaction partners: ${partners || '(none observed)'}`);
  if (!options.deemphasizeChannelDist) {
    lines.push(`Hour-of-day histogram (UTC, 0-23): [${fp.hourHistogram.join(', ')}]`);
    lines.push(
      `Length-bucket histogram [tiny, short, med, long, wall]: [${fp.lengthBucketHistogram.join(', ')}]`,
    );
  }
  return lines.join('\n');
}
