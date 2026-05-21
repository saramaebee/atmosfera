import { getDb } from './client';

export interface InteractionEdge {
  guildId: string;
  channelId: string;
  authorId: string;
  targetId: string;
  kind: 'reply' | 'mention';
  createdAt: number;
}

export function recordInteractions(edges: InteractionEdge[]): void {
  if (edges.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO interactions (guild_id, channel_id, author_id, target_id, kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const txn = db.transaction((es: InteractionEdge[]) => {
    for (const e of es) {
      stmt.run(e.guildId, e.channelId, e.authorId, e.targetId, e.kind, e.createdAt);
    }
  });
  txn(edges);
}

export interface Partner {
  partner_id: string;
  replies: number;
  mentions: number;
  score: number;
}

export function getTopPartnersForUser(
  guildId: string,
  userId: string,
  sinceMs: number,
  limit = 10,
): Partner[] {
  return getDb()
    .prepare(
      `SELECT partner_id,
              SUM(CASE WHEN kind = 'reply' THEN 1 ELSE 0 END) AS replies,
              SUM(CASE WHEN kind = 'mention' THEN 1 ELSE 0 END) AS mentions,
              SUM(CASE WHEN kind = 'reply' THEN 2 ELSE 1 END) AS score
       FROM (
         SELECT target_id AS partner_id, kind FROM interactions
           WHERE guild_id = ? AND author_id = ? AND created_at >= ?
         UNION ALL
         SELECT author_id AS partner_id, kind FROM interactions
           WHERE guild_id = ? AND target_id = ? AND created_at >= ?
       )
       GROUP BY partner_id
       ORDER BY score DESC
       LIMIT ?`,
    )
    .all(guildId, userId, sinceMs, guildId, userId, sinceMs, limit) as Partner[];
}

export interface ChannelHeat {
  channel_id: string;
  edges: number;
}

export function getHotChannelsForPair(
  guildId: string,
  userA: string,
  userB: string,
  sinceMs: number,
  limit = 5,
): ChannelHeat[] {
  return getDb()
    .prepare(
      `SELECT channel_id, COUNT(*) AS edges
       FROM interactions
       WHERE guild_id = ? AND created_at >= ?
         AND ((author_id = ? AND target_id = ?) OR (author_id = ? AND target_id = ?))
       GROUP BY channel_id
       ORDER BY edges DESC
       LIMIT ?`,
    )
    .all(guildId, sinceMs, userA, userB, userB, userA, limit) as ChannelHeat[];
}
