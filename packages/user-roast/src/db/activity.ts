import { getDb } from './client';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function lengthBucket(len: number): number {
  if (len <= 5) return 0;
  if (len <= 30) return 1;
  if (len <= 120) return 2;
  if (len <= 500) return 3;
  return 4;
}

function hourBucket(ts: number): number {
  return Math.floor(ts / HOUR_MS) * HOUR_MS;
}

export interface ActivityEvent {
  guildId: string;
  userId: string;
  channelId: string;
  createdAt: number;
  length: number;
  mentionCount: number;
  hasAttachment: boolean;
  isReply: boolean;
}

export function recordActivity(event: ActivityEvent): void {
  const db = getDb();
  const bucket = hourBucket(event.createdAt);

  const txn = db.transaction((e: ActivityEvent) => {
    db.prepare(
      `INSERT INTO activity_hourly
         (guild_id, user_id, channel_id, hour_bucket, msg_count, total_length, mention_count, attachment_count)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(guild_id, user_id, channel_id, hour_bucket) DO UPDATE SET
         msg_count = msg_count + 1,
         total_length = total_length + excluded.total_length,
         mention_count = mention_count + excluded.mention_count,
         attachment_count = attachment_count + excluded.attachment_count`,
    ).run(
      e.guildId,
      e.userId,
      e.channelId,
      bucket,
      e.length,
      e.mentionCount,
      e.hasAttachment ? 1 : 0,
    );

    db.prepare(
      `INSERT INTO activity_recent
         (guild_id, user_id, channel_id, created_at, length_bucket, has_attachment, is_reply, mention_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      e.guildId,
      e.userId,
      e.channelId,
      e.createdAt,
      lengthBucket(e.length),
      e.hasAttachment ? 1 : 0,
      e.isReply ? 1 : 0,
      e.mentionCount,
    );
  });

  txn(event);
}

// ── Fingerprint queries ──

export interface ChannelActivity {
  channel_id: string;
  msg_count: number;
  total_length: number;
}

export function getUserChannelDistribution(
  guildId: string,
  userId: string,
  sinceMs: number,
): ChannelActivity[] {
  return getDb()
    .prepare(
      `SELECT channel_id, SUM(msg_count) AS msg_count, SUM(total_length) AS total_length
       FROM activity_hourly
       WHERE guild_id = ? AND user_id = ? AND hour_bucket >= ?
       GROUP BY channel_id
       ORDER BY msg_count DESC`,
    )
    .all(guildId, userId, sinceMs) as ChannelActivity[];
}

export interface HourBucket {
  hour_of_day: number;
  msg_count: number;
}

export function getUserHourHistogram(
  guildId: string,
  userId: string,
  sinceMs: number,
): HourBucket[] {
  const rows = getDb()
    .prepare(
      `SELECT hour_bucket, SUM(msg_count) AS msg_count
       FROM activity_hourly
       WHERE guild_id = ? AND user_id = ? AND hour_bucket >= ?
       GROUP BY hour_bucket`,
    )
    .all(guildId, userId, sinceMs) as { hour_bucket: number; msg_count: number }[];

  const histogram = new Array<number>(24).fill(0);
  for (const r of rows) {
    const hourOfDay = new Date(r.hour_bucket).getUTCHours();
    histogram[hourOfDay] = (histogram[hourOfDay] ?? 0) + r.msg_count;
  }
  return histogram.map((count, hour_of_day) => ({ hour_of_day, msg_count: count }));
}

export interface UserActivityStats {
  total_messages: number;
  total_length: number;
  attachment_count: number;
  mention_count: number;
  active_hours: number;
  active_channels: number;
}

export function getUserActivityStats(
  guildId: string,
  userId: string,
  sinceMs: number,
): UserActivityStats {
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(msg_count), 0) AS total_messages,
         COALESCE(SUM(total_length), 0) AS total_length,
         COALESCE(SUM(attachment_count), 0) AS attachment_count,
         COALESCE(SUM(mention_count), 0) AS mention_count,
         COUNT(DISTINCT hour_bucket) AS active_hours,
         COUNT(DISTINCT channel_id) AS active_channels
       FROM activity_hourly
       WHERE guild_id = ? AND user_id = ? AND hour_bucket >= ?`,
    )
    .get(guildId, userId, sinceMs) as UserActivityStats;
  return row;
}

export interface RankedUser {
  user_id: string;
  msg_count: number;
}

export function getGuildPosterLeaderboard(
  guildId: string,
  sinceMs: number,
  limit = 50,
): RankedUser[] {
  return getDb()
    .prepare(
      `SELECT user_id, SUM(msg_count) AS msg_count
       FROM activity_hourly
       WHERE guild_id = ? AND hour_bucket >= ?
       GROUP BY user_id
       ORDER BY msg_count DESC
       LIMIT ?`,
    )
    .all(guildId, sinceMs, limit) as RankedUser[];
}

export function getUserRankInGuild(
  guildId: string,
  userId: string,
  sinceMs: number,
): { position: number; total: number } {
  const board = getGuildPosterLeaderboard(guildId, sinceMs, 10_000);
  const idx = board.findIndex((u) => u.user_id === userId);
  return {
    position: idx === -1 ? -1 : idx + 1,
    total: board.length,
  };
}

export function getUserPostingDays(
  guildId: string,
  userId: string,
  sinceMs: number,
): number[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT (hour_bucket / ?) AS day
       FROM activity_hourly
       WHERE guild_id = ? AND user_id = ? AND hour_bucket >= ?
       ORDER BY day ASC`,
    )
    .all(DAY_MS, guildId, userId, sinceMs) as { day: number }[];
  return rows.map((r) => r.day);
}

export function computeLongestStreak(days: number[]): number {
  if (days.length === 0) return 0;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1];
    const curr = days[i];
    if (prev === undefined || curr === undefined) continue;
    if (curr - prev === 1) {
      current += 1;
      if (current > longest) longest = current;
    } else if (curr !== prev) {
      current = 1;
    }
  }
  return longest;
}

export function getUserRecentLengthBucketHistogram(
  guildId: string,
  userId: string,
  sinceMs: number,
): number[] {
  const rows = getDb()
    .prepare(
      `SELECT length_bucket, COUNT(*) AS count
       FROM activity_recent
       WHERE guild_id = ? AND user_id = ? AND created_at >= ?
       GROUP BY length_bucket`,
    )
    .all(guildId, userId, sinceMs) as { length_bucket: number; count: number }[];
  const histogram: number[] = [0, 0, 0, 0, 0];
  for (const r of rows) {
    const idx = r.length_bucket;
    if (idx >= 0 && idx <= 4) {
      histogram[idx] = r.count;
    }
  }
  return histogram;
}
