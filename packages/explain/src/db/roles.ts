import type { ExplainGuildRoleRow, ExplainLanguage, ExplainTier } from '@atmosfera/db';
import { getDb } from './client';

interface RoleRow {
  guild_id: string;
  role_id: string;
  language: string;
  tier: string;
  set_by: string;
  set_at: number;
}

function rowToRole(r: RoleRow): ExplainGuildRoleRow {
  return {
    guildId: r.guild_id,
    roleId: r.role_id,
    language: r.language as ExplainLanguage,
    tier: r.tier as ExplainTier,
    setBy: r.set_by,
    setAt: r.set_at,
  };
}

export function listGuildRoles(guildId: string): ExplainGuildRoleRow[] {
  const rows = getDb()
    .prepare(
      'SELECT guild_id, role_id, language, tier, set_by, set_at FROM explain_guild_roles WHERE guild_id = ? ORDER BY language, tier, role_id',
    )
    .all(guildId) as RoleRow[];
  return rows.map(rowToRole);
}

export interface SetGuildRoleInput {
  guildId: string;
  roleId: string;
  language: ExplainLanguage;
  tier: ExplainTier;
  setBy: string;
}

export interface SetGuildRoleResult {
  previous: ExplainGuildRoleRow | null;
  current: ExplainGuildRoleRow;
}

export function setGuildRole(input: SetGuildRoleInput): SetGuildRoleResult {
  const db = getDb();
  const prevRow = db
    .prepare(
      'SELECT guild_id, role_id, language, tier, set_by, set_at FROM explain_guild_roles WHERE guild_id = ? AND role_id = ?',
    )
    .get(input.guildId, input.roleId) as RoleRow | null;

  const now = Date.now();
  db.prepare(
    `INSERT INTO explain_guild_roles (guild_id, role_id, language, tier, set_by, set_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id, role_id) DO UPDATE SET
       language = excluded.language,
       tier = excluded.tier,
       set_by = excluded.set_by,
       set_at = excluded.set_at`,
  ).run(input.guildId, input.roleId, input.language, input.tier, input.setBy, now);

  return {
    previous: prevRow ? rowToRole(prevRow) : null,
    current: {
      guildId: input.guildId,
      roleId: input.roleId,
      language: input.language,
      tier: input.tier,
      setBy: input.setBy,
      setAt: now,
    },
  };
}

export function removeGuildRole(guildId: string, roleId: string): ExplainGuildRoleRow | null {
  const db = getDb();
  const prev = db
    .prepare(
      'SELECT guild_id, role_id, language, tier, set_by, set_at FROM explain_guild_roles WHERE guild_id = ? AND role_id = ?',
    )
    .get(guildId, roleId) as RoleRow | null;
  if (!prev) return null;
  db.prepare('DELETE FROM explain_guild_roles WHERE guild_id = ? AND role_id = ?').run(
    guildId,
    roleId,
  );
  return rowToRole(prev);
}
