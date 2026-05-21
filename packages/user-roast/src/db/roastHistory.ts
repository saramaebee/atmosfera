import { getDb } from './client';

export type RoastHistoryTone = 'sharp' | 'brutal';

export interface RoastHistoryRow {
  invocationId: string;
  guildId: string;
  targetId: string;
  invokerId: string;
  tone: RoastHistoryTone;
  createdAt: number;
  angleTitles: string[];
  referencedPartnerIds: string[];
  searchedKeywords: string[];
}

export interface PriorRoast {
  invocationId: string;
  createdAt: number;
  tone: RoastHistoryTone;
  angleTitles: string[];
  referencedPartnerIds: string[];
  searchedKeywords: string[];
}

export function recordRoast(row: RoastHistoryRow): void {
  getDb()
    .prepare(
      `INSERT INTO roast_history
         (invocation_id, guild_id, target_id, invoker_id, tone, created_at,
          angle_titles_json, referenced_partner_ids_json, searched_keywords_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.invocationId,
      row.guildId,
      row.targetId,
      row.invokerId,
      row.tone,
      row.createdAt,
      JSON.stringify(row.angleTitles),
      JSON.stringify(row.referencedPartnerIds),
      JSON.stringify(row.searchedKeywords),
    );
}

interface DbRow {
  invocation_id: string;
  created_at: number;
  tone: RoastHistoryTone;
  angle_titles_json: string;
  referenced_partner_ids_json: string;
  searched_keywords_json: string;
}

function parseStringArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

interface FullRow extends DbRow {
  guild_id: string;
  target_id: string;
  invoker_id: string;
}

export interface RoastHistoryLookup {
  invocationId: string;
  guildId: string;
  targetId: string;
  invokerId: string;
  tone: RoastHistoryTone;
  createdAt: number;
}

export function getRoastHistoryById(invocationId: string): RoastHistoryLookup | null {
  const row = getDb()
    .prepare(
      `SELECT invocation_id, guild_id, target_id, invoker_id, tone, created_at,
              angle_titles_json, referenced_partner_ids_json, searched_keywords_json
       FROM roast_history WHERE invocation_id = ?`,
    )
    .get(invocationId) as FullRow | undefined;
  if (!row) return null;
  return {
    invocationId: row.invocation_id,
    guildId: row.guild_id,
    targetId: row.target_id,
    invokerId: row.invoker_id,
    tone: row.tone,
    createdAt: row.created_at,
  };
}

export function getRecentRoastsForTarget(
  guildId: string,
  targetId: string,
  sinceMs: number,
  limit = 5,
): PriorRoast[] {
  const rows = getDb()
    .prepare(
      `SELECT invocation_id, created_at, tone,
              angle_titles_json, referenced_partner_ids_json, searched_keywords_json
       FROM roast_history
       WHERE guild_id = ? AND target_id = ? AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(guildId, targetId, sinceMs, limit) as DbRow[];

  return rows.map((r) => ({
    invocationId: r.invocation_id,
    createdAt: r.created_at,
    tone: r.tone,
    angleTitles: parseStringArray(r.angle_titles_json),
    referencedPartnerIds: parseStringArray(r.referenced_partner_ids_json),
    searchedKeywords: parseStringArray(r.searched_keywords_json),
  }));
}
