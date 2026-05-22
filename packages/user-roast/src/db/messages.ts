import type { CachedMessage } from '../sessionCache';
import { getDb } from './client';

/**
 * Discord caps message content at 2000 chars; clamp on the way in so a
 * misbehaving client or a future Discord API change can't blow up a row.
 */
const MAX_CONTENT_CHARS = 2000;

export interface MessageRow {
  messageId: string;
  guildId: string;
  channelId: string;
  authorId: string;
  content: string;
  createdAt: number;
  isReply: boolean;
  replyToId: string | null;
}

/**
 * Write a freshly-seen message. Idempotent via INSERT OR IGNORE so duplicate
 * gateway deliveries (reconnects, partial retransmits) don't blow up.
 */
export function recordMessage(row: MessageRow): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO messages_recent
       (message_id, guild_id, channel_id, author_id, content, created_at,
        edited_at, is_reply, reply_to_id)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    row.messageId,
    row.guildId,
    row.channelId,
    row.authorId,
    row.content.slice(0, MAX_CONTENT_CHARS),
    row.createdAt,
    row.isReply ? 1 : 0,
    row.replyToId,
  );
}

/**
 * Replace stored content to mirror an in-Discord edit. No-op if the row
 * already aged out of the 7d window — that's fine, the message is gone from
 * our index anyway and Discord still has the source of truth.
 */
export function applyMessageEdit(messageId: string, newContent: string, editedAt: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE messages_recent
        SET content = ?, edited_at = ?
      WHERE message_id = ?`,
  ).run(newContent.slice(0, MAX_CONTENT_CHARS), editedAt, messageId);
}

/** Hard-delete a row to mirror an in-Discord delete. */
export function deleteMessageById(messageId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM messages_recent WHERE message_id = ?').run(messageId);
}

/**
 * Hard-delete a batch of rows. Used by MessageDeleteBulk (Discord's
 * mod-tool-driven bulk purge). Empty input is a no-op.
 */
export function deleteMessagesByIds(messageIds: string[]): void {
  if (messageIds.length === 0) return;
  const db = getDb();
  const placeholders = messageIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM messages_recent WHERE message_id IN (${placeholders})`).run(
    ...messageIds,
  );
}

/**
 * Eager-purge a user's stored content in a single guild. Invoked when the
 * user opts out of being roasted (either via slash command or the web /me
 * page) so existing content disappears immediately rather than waiting for
 * the 7d window to roll it off.
 */
export function deleteMessagesForUser(authorId: string, guildId: string): number {
  const db = getDb();
  const res = db
    .prepare('DELETE FROM messages_recent WHERE author_id = ? AND guild_id = ?')
    .run(authorId, guildId);
  return Number(res.changes);
}

/**
 * Roast-hot-path read: every message the target authored in the guild since
 * `sinceMs`, newest first, capped at `limit`. Returned as `CachedMessage`
 * so the caller can feed `RoastSession.appendBatch` with no adapter glue.
 */
export function getRecentTargetMessages(
  guildId: string,
  targetUserId: string,
  sinceMs: number,
  limit = 200,
): CachedMessage[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT message_id, channel_id, author_id, created_at, content,
              is_reply, reply_to_id
         FROM messages_recent
        WHERE guild_id = ? AND author_id = ? AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(guildId, targetUserId, sinceMs, limit) as Array<{
    message_id: string;
    channel_id: string;
    author_id: string;
    created_at: number;
    content: string;
    is_reply: number;
    reply_to_id: string | null;
  }>;

  return rows.map((r) => ({
    id: r.message_id,
    channelId: r.channel_id,
    authorId: r.author_id,
    createdAt: r.created_at,
    content: r.content,
    isReply: r.is_reply === 1,
    replyToId: r.reply_to_id,
  }));
}

/**
 * Purge rows older than `cutoffMs`. Returns the count of deleted rows so the
 * daily purge job can log it alongside the other tables.
 */
export function purgeMessagesOlderThan(cutoffMs: number): number {
  const db = getDb();
  const res = db.prepare('DELETE FROM messages_recent WHERE created_at < ?').run(cutoffMs);
  return Number(res.changes);
}

interface MessageRowSelect {
  message_id: string;
  channel_id: string;
  author_id: string;
  created_at: number;
  content: string;
  is_reply: number;
  reply_to_id: string | null;
}

function rowToCached(r: MessageRowSelect): CachedMessage {
  return {
    id: r.message_id,
    channelId: r.channel_id,
    authorId: r.author_id,
    createdAt: r.created_at,
    content: r.content,
    isReply: r.is_reply === 1,
    replyToId: r.reply_to_id,
  };
}

const SELECT_COLS = 'message_id, channel_id, author_id, created_at, content, is_reply, reply_to_id';

/**
 * Escape LIKE wildcards in a user-supplied keyword so a search for "100%
 * legit" doesn't degenerate into a full table scan match-all. Pair with
 * ESCAPE '\\' in the query.
 */
function escapeLike(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Case-insensitive substring search across the target's messages. Scoped to
 * (guild, author) and optionally to a single channel. Uses
 * idx_messages_recent_guild_author_time (or the channel composite when
 * channelId is set). Returns newest-first.
 */
export function searchTargetMessagesText(params: {
  guildId: string;
  authorId: string;
  keyword: string;
  channelId?: string | null;
  sinceMs: number;
  limit?: number;
}): CachedMessage[] {
  const { guildId, authorId, keyword, channelId, sinceMs, limit = 20 } = params;
  if (!keyword) return [];
  const db = getDb();
  const pattern = `%${escapeLike(keyword.toLowerCase())}%`;
  const rows = channelId
    ? db
        .prepare(
          `SELECT ${SELECT_COLS}
             FROM messages_recent
            WHERE guild_id = ? AND author_id = ? AND channel_id = ?
              AND created_at >= ?
              AND LOWER(content) LIKE ? ESCAPE '\\'
            ORDER BY created_at DESC
            LIMIT ?`,
        )
        .all(guildId, authorId, channelId, sinceMs, pattern, limit)
    : db
        .prepare(
          `SELECT ${SELECT_COLS}
             FROM messages_recent
            WHERE guild_id = ? AND author_id = ? AND created_at >= ?
              AND LOWER(content) LIKE ? ESCAPE '\\'
            ORDER BY created_at DESC
            LIMIT ?`,
        )
        .all(guildId, authorId, sinceMs, pattern, limit);
  return (rows as MessageRowSelect[]).map(rowToCached);
}

/**
 * Every message in a channel within a time window, any author. Used by the
 * synthesis `getMessagesNearTime` tool to reconstruct context around a
 * specific moment. Chronological (ascending) so the result reads naturally.
 */
export function getMessagesByChannelTime(params: {
  guildId: string;
  channelId: string;
  fromMs: number;
  toMs: number;
  limit?: number;
}): CachedMessage[] {
  const { guildId, channelId, fromMs, toMs, limit = 40 } = params;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLS}
         FROM messages_recent
        WHERE guild_id = ? AND channel_id = ?
          AND created_at >= ? AND created_at <= ?
        ORDER BY created_at ASC
        LIMIT ?`,
    )
    .all(guildId, channelId, fromMs, toMs, limit);
  return (rows as MessageRowSelect[]).map(rowToCached);
}

/**
 * Replies between userA and userB in either direction. A "reply turn" is a
 * message authored by one user whose `reply_to_id` resolves to a message
 * authored by the other. Returns the *reply* side (m1) of each pair,
 * newest-first. The original message (m2) can be re-fetched by message_id
 * if needed.
 */
export function getReplyChainMessages(params: {
  guildId: string;
  userA: string;
  userB: string;
  sinceMs: number;
  channelId?: string | null;
  limit?: number;
}): CachedMessage[] {
  const { guildId, userA, userB, sinceMs, channelId, limit = 30 } = params;
  const db = getDb();
  const baseSql = `
    SELECT m1.message_id, m1.channel_id, m1.author_id, m1.created_at, m1.content,
           m1.is_reply, m1.reply_to_id
      FROM messages_recent AS m1
      JOIN messages_recent AS m2
        ON m1.reply_to_id = m2.message_id
       AND m1.guild_id = m2.guild_id
     WHERE m1.guild_id = ?
       AND m1.created_at >= ?
       AND (
         (m1.author_id = ? AND m2.author_id = ?)
         OR
         (m1.author_id = ? AND m2.author_id = ?)
       )`;
  const rows = channelId
    ? db
        .prepare(`${baseSql} AND m1.channel_id = ? ORDER BY m1.created_at DESC LIMIT ?`)
        .all(guildId, sinceMs, userA, userB, userB, userA, channelId, limit)
    : db
        .prepare(`${baseSql} ORDER BY m1.created_at DESC LIMIT ?`)
        .all(guildId, sinceMs, userA, userB, userB, userA, limit);
  return (rows as MessageRowSelect[]).map(rowToCached);
}

/**
 * The target's longest messages — by content length, descending. Surfaces
 * "actually-wrote-a-thesis" specimens that the chronological newest-first
 * default would miss.
 */
export function getLongestTargetMessages(params: {
  guildId: string;
  authorId: string;
  sinceMs: number;
  limit?: number;
}): CachedMessage[] {
  const { guildId, authorId, sinceMs, limit = 10 } = params;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLS}
         FROM messages_recent
        WHERE guild_id = ? AND author_id = ? AND created_at >= ?
        ORDER BY LENGTH(content) DESC, created_at DESC
        LIMIT ?`,
    )
    .all(guildId, authorId, sinceMs, limit);
  return (rows as MessageRowSelect[]).map(rowToCached);
}

/**
 * Target messages posted at specific UTC hours. Empty `hoursUtc` returns
 * nothing (would otherwise match everything — almost certainly a bug at the
 * caller). The model passes e.g. `[22,23,0,1,2,3,4]` for "late-night UTC".
 */
export function getTargetMessagesByHourUtc(params: {
  guildId: string;
  authorId: string;
  hoursUtc: number[];
  sinceMs: number;
  limit?: number;
}): CachedMessage[] {
  const { guildId, authorId, hoursUtc, sinceMs, limit = 20 } = params;
  if (hoursUtc.length === 0) return [];
  const hours = [...new Set(hoursUtc.filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))];
  if (hours.length === 0) return [];
  const placeholders = hours.map(() => '?').join(',');
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLS}
         FROM messages_recent
        WHERE guild_id = ? AND author_id = ? AND created_at >= ?
          AND CAST(strftime('%H', created_at / 1000, 'unixepoch') AS INTEGER) IN (${placeholders})
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(guildId, authorId, sinceMs, ...hours, limit);
  return (rows as MessageRowSelect[]).map(rowToCached);
}

/**
 * Per-channel slice of the target's messages — for hypothesize exploration
 * ("show me what they say in #serious vs #shitposting"). Chronological
 * newest-first, uses idx_messages_recent_guild_channel_author_time.
 */
export function getTargetMessagesInChannel(params: {
  guildId: string;
  authorId: string;
  channelId: string;
  sinceMs: number;
  limit?: number;
}): CachedMessage[] {
  const { guildId, authorId, channelId, sinceMs, limit = 20 } = params;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLS}
         FROM messages_recent
        WHERE guild_id = ? AND channel_id = ? AND author_id = ?
          AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(guildId, channelId, authorId, sinceMs, limit);
  return (rows as MessageRowSelect[]).map(rowToCached);
}

/**
 * Channel distribution for the target — how many messages they posted per
 * channel since `sinceMs`. Sorted by count desc.
 */
export interface ChannelCount {
  channel_id: string;
  count: number;
}

export function getTargetChannelCounts(params: {
  guildId: string;
  authorId: string;
  sinceMs: number;
  limit?: number;
}): ChannelCount[] {
  const { guildId, authorId, sinceMs, limit = 20 } = params;
  const db = getDb();
  return db
    .prepare(
      `SELECT channel_id, COUNT(*) AS count
         FROM messages_recent
        WHERE guild_id = ? AND author_id = ? AND created_at >= ?
        GROUP BY channel_id
        ORDER BY count DESC
        LIMIT ?`,
    )
    .all(guildId, authorId, sinceMs, limit) as ChannelCount[];
}
