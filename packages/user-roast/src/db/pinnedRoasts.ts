import { getDb } from './client';

export type PinnedRoastTone = 'sharp' | 'brutal';

export interface PinnedRoast {
  invocationId: string;
  guildId: string;
  targetId: string;
  invokerId: string;
  tone: PinnedRoastTone;
  roastText: string;
  channelId: string;
  messageId: string;
  pinnedAt: number;
  roastCreatedAt: number;
  voteCount: number;
}

export type PinnedRoastInput = Omit<PinnedRoast, 'voteCount'>;

interface DbRow {
  invocation_id: string;
  guild_id: string;
  target_id: string;
  invoker_id: string;
  tone: PinnedRoastTone;
  roast_text: string;
  channel_id: string;
  message_id: string;
  pinned_at: number;
  roast_created_at: number;
  vote_count: number;
}

const SELECT_WITH_VOTES = `
  SELECT p.invocation_id, p.guild_id, p.target_id, p.invoker_id, p.tone,
         p.roast_text, p.channel_id, p.message_id, p.pinned_at, p.roast_created_at,
         (SELECT COUNT(*) FROM pinned_roast_votes v WHERE v.invocation_id = p.invocation_id) AS vote_count
  FROM pinned_roasts p
`;

function mapRow(r: DbRow): PinnedRoast {
  return {
    invocationId: r.invocation_id,
    guildId: r.guild_id,
    targetId: r.target_id,
    invokerId: r.invoker_id,
    tone: r.tone,
    roastText: r.roast_text,
    channelId: r.channel_id,
    messageId: r.message_id,
    pinnedAt: r.pinned_at,
    roastCreatedAt: r.roast_created_at,
    voteCount: r.vote_count,
  };
}

const MIN_PREFIX_LEN = 8;

/** Returns false if invocation_id is already pinned (UNIQUE conflict). */
export function pinRoast(row: PinnedRoastInput): boolean {
  const res = getDb()
    .prepare(
      `INSERT OR IGNORE INTO pinned_roasts
         (invocation_id, guild_id, target_id, invoker_id, tone,
          roast_text, channel_id, message_id, pinned_at, roast_created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.invocationId,
      row.guildId,
      row.targetId,
      row.invokerId,
      row.tone,
      row.roastText,
      row.channelId,
      row.messageId,
      row.pinnedAt,
      row.roastCreatedAt,
    );
  return res.changes > 0;
}

/**
 * Resolve an invocation ID by exact match or unambiguous prefix (>= 8 chars)
 * within the caller's pins.
 */
export function resolvePinnedRoastId(
  guildId: string,
  ownerId: string,
  idOrPrefix: string,
): string | null {
  if (!idOrPrefix) return null;
  const trimmed = idOrPrefix.trim();
  if (!trimmed) return null;

  const exact = getDb()
    .prepare(
      `SELECT invocation_id FROM pinned_roasts
       WHERE guild_id = ? AND target_id = ? AND invocation_id = ?`,
    )
    .get(guildId, ownerId, trimmed) as { invocation_id: string } | undefined;
  if (exact) return exact.invocation_id;

  if (trimmed.length < MIN_PREFIX_LEN) return null;

  const matches = getDb()
    .prepare(
      `SELECT invocation_id FROM pinned_roasts
       WHERE guild_id = ? AND target_id = ? AND invocation_id LIKE ?
       LIMIT 2`,
    )
    .all(guildId, ownerId, `${trimmed}%`) as { invocation_id: string }[];
  if (matches.length === 1 && matches[0]) return matches[0].invocation_id;
  return null;
}

export function getPinnedRoast(
  guildId: string,
  ownerId: string,
  idOrPrefix: string,
): PinnedRoast | null {
  const id = resolvePinnedRoastId(guildId, ownerId, idOrPrefix);
  if (!id) return null;
  const row = getDb()
    .prepare(
      `${SELECT_WITH_VOTES} WHERE p.guild_id = ? AND p.target_id = ? AND p.invocation_id = ?`,
    )
    .get(guildId, ownerId, id) as DbRow | undefined;
  return row ? mapRow(row) : null;
}

export function listPinnedRoastsForUser(
  guildId: string,
  ownerId: string,
  limit = 10,
): PinnedRoast[] {
  const rows = getDb()
    .prepare(
      `${SELECT_WITH_VOTES}
       WHERE p.guild_id = ? AND p.target_id = ?
       ORDER BY vote_count DESC, p.pinned_at DESC
       LIMIT ?`,
    )
    .all(guildId, ownerId, limit) as DbRow[];
  return rows.map(mapRow);
}

/**
 * Turn user input into a safe FTS5 MATCH expression.
 * Splits on non-letter/digit and appends `*` for prefix matching.
 */
export function buildFtsQuery(keyword: string): string | null {
  const tokens = keyword
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .map((t) => `${t}*`);
  return tokens.length === 0 ? null : tokens.join(' ');
}

export function searchPinnedRoastsForUser(
  guildId: string,
  ownerId: string,
  keyword: string,
  limit = 10,
): PinnedRoast[] {
  const match = buildFtsQuery(keyword);
  if (!match) return [];
  const rows = getDb()
    .prepare(
      `SELECT p.invocation_id, p.guild_id, p.target_id, p.invoker_id, p.tone,
              p.roast_text, p.channel_id, p.message_id, p.pinned_at, p.roast_created_at,
              (SELECT COUNT(*) FROM pinned_roast_votes v WHERE v.invocation_id = p.invocation_id) AS vote_count
       FROM pinned_roasts_fts fts
       JOIN pinned_roasts p ON p.rowid = fts.rowid
       WHERE pinned_roasts_fts MATCH ?
         AND p.guild_id = ? AND p.target_id = ?
       ORDER BY bm25(pinned_roasts_fts) ASC, vote_count DESC, p.pinned_at DESC
       LIMIT ?`,
    )
    .all(match, guildId, ownerId, limit) as DbRow[];
  return rows.map(mapRow);
}

export function deletePinnedRoast(guildId: string, ownerId: string, idOrPrefix: string): boolean {
  const id = resolvePinnedRoastId(guildId, ownerId, idOrPrefix);
  if (!id) return false;
  const res = getDb()
    .prepare(
      `DELETE FROM pinned_roasts
       WHERE invocation_id = ? AND guild_id = ? AND target_id = ?`,
    )
    .run(id, guildId, ownerId);
  return res.changes > 0;
}

/** Idempotent. Returns new vote count, or null if the roast isn't pinned. */
export function upvotePinnedRoast(invocationId: string, voterId: string): number | null {
  const db = getDb();
  const exists = db
    .prepare('SELECT 1 AS x FROM pinned_roasts WHERE invocation_id = ?')
    .get(invocationId) as { x: number } | undefined;
  if (!exists) return null;

  db.prepare(
    `INSERT OR IGNORE INTO pinned_roast_votes (invocation_id, voter_id, voted_at)
     VALUES (?, ?, ?)`,
  ).run(invocationId, voterId, Date.now());

  return getVoteCount(invocationId);
}

export function getVoteCount(invocationId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM pinned_roast_votes WHERE invocation_id = ?')
    .get(invocationId) as { n: number };
  return row.n;
}

export function isPinned(invocationId: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 AS x FROM pinned_roasts WHERE invocation_id = ?')
    .get(invocationId) as { x: number } | undefined;
  return Boolean(row);
}

export function shortId(invocationId: string): string {
  return invocationId.slice(0, 8);
}
