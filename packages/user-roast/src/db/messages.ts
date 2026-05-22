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
