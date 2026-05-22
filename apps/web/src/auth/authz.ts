import { type BotGuild, listActiveBotGuilds } from '@atmosfera/db';
import { getWebDb } from '../state';
import type { OAuthGuildSummary, SessionContext } from '../types';

/**
 * Discord permission bit for MANAGE_GUILD (0x20). The full bitfield is a
 * JS-unsafe int as a decimal string, so we compare with BigInt.
 */
const MANAGE_GUILD = 0x20n;

export function hasManageGuild(permissions: string): boolean {
  try {
    return (BigInt(permissions) & MANAGE_GUILD) === MANAGE_GUILD;
  } catch {
    return false;
  }
}

export type Role = 'owner' | 'admin' | 'member' | 'none';

/**
 * Decide what the active session user can do in a given guild.
 *
 * - `owner`  → bot owner (DISCORD_OWNER_IDS). Sees every bot guild.
 * - `admin`  → user is in the guild AND has Manage Server.
 * - `member` → user is in the guild without admin perms.
 * - `none`   → user isn't in the guild and isn't a bot owner.
 */
export function roleFor(ctx: SessionContext, guildId: string): Role {
  if (ctx.isOwner) return 'owner';
  const og = ctx.oauthGuilds.find((g) => g.id === guildId);
  if (!og) return 'none';
  if (hasManageGuild(og.permissions)) return 'admin';
  return 'member';
}

/**
 * Returns true if the role meets the minimum required for an admin-only page.
 * Owner > admin > member.
 */
export function canAdminister(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

export interface SwitcherGuild {
  id: string;
  name: string;
  iconHash: string | null;
  role: Role;
}

/**
 * The unified guild switcher list. Same component for every user — content
 * differs by role:
 *   - non-owner: mutual guilds (OAuth ∩ bot's active guild set)
 *   - owner:     every active bot guild (with the user's actual role per row,
 *                or 'owner' for guilds the bot owner isn't personally in)
 */
export function listSwitchableGuilds(ctx: SessionContext): SwitcherGuild[] {
  const active = listActiveBotGuilds(getWebDb());
  const oauthById = new Map(ctx.oauthGuilds.map((g) => [g.id, g] as const));

  if (ctx.isOwner) {
    return active.map((bg) => toSwitcherGuild(bg, oauthById.get(bg.guildId), ctx, /*owner*/ true));
  }

  return active
    .filter((bg) => oauthById.has(bg.guildId))
    .map((bg) => toSwitcherGuild(bg, oauthById.get(bg.guildId), ctx, /*owner*/ false));
}

function toSwitcherGuild(
  bg: BotGuild,
  og: OAuthGuildSummary | undefined,
  ctx: SessionContext,
  isOwner: boolean,
): SwitcherGuild {
  let role: Role;
  if (!og) {
    // Owner viewing a guild they aren't personally in.
    role = isOwner ? 'owner' : 'none';
  } else if (hasManageGuild(og.permissions)) {
    role = isOwner ? 'owner' : 'admin';
  } else {
    role = isOwner ? 'owner' : 'member';
  }
  return { id: bg.guildId, name: bg.name, iconHash: bg.iconHash, role };
}
