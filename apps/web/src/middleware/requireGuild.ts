import { type BotGuild, getBotGuild } from '@atmosfera/db';
import type { Context } from 'hono';
import { type Role, canAdminister, roleFor } from '../auth/authz';
import { requireSession } from '../auth/session';
import { getWebDb } from '../state';
import type { AppEnv, SessionContext } from '../types';

export interface GuildContext {
  session: SessionContext;
  guild: BotGuild;
  role: Role;
}

/**
 * Resolve the active guild from `:guildId`, gate by min role, and return a
 * compact context for the route handler. Returns a Response on failure (the
 * handler should propagate it).
 */
export function resolveGuild(
  c: Context<AppEnv>,
  guildId: string,
  minRole: 'member' | 'admin',
): GuildContext | Response {
  const ctxOrRes = requireSession(c);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const session = ctxOrRes;

  const guild = getBotGuild(getWebDb(), guildId);
  if (!guild || guild.leftAt !== null) {
    return c.text('Guild not found', 404);
  }

  const role = roleFor(session, guildId);
  if (role === 'none') return c.text('Forbidden', 403);
  if (minRole === 'admin' && !canAdminister(role)) return c.text('Forbidden', 403);

  return { session, guild, role };
}
