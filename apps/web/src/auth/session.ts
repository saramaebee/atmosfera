import { isBotOwner } from '@atmosfera/config';
import { deleteWebSession, getWebSession, touchWebSession } from '@atmosfera/db';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getWebDb } from '../state';
import type { AppEnv, OAuthGuildSummary, SessionContext } from '../types';
import { signCookie, verifyCookie } from './crypto';

const COOKIE_NAME = 'atm_sid';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function setSessionCookie(c: Context, sessionId: string): void {
  setCookie(c, COOKIE_NAME, signCookie(sessionId), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isProd(),
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

function readSessionId(c: Context): string | null {
  const raw = getCookie(c, COOKIE_NAME);
  if (!raw) return null;
  return verifyCookie(raw);
}

export function sessionMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const sid = readSessionId(c);
    if (sid) {
      const db = getWebDb();
      const row = getWebSession(db, sid);
      if (row) {
        let oauthGuilds: OAuthGuildSummary[] = [];
        try {
          const parsed: unknown = JSON.parse(row.oauthGuildsJson);
          if (Array.isArray(parsed)) oauthGuilds = parsed as OAuthGuildSummary[];
        } catch {
          // bad JSON — treat as empty; user can re-login to refresh
        }
        const ctx: SessionContext = {
          session: row,
          oauthGuilds,
          isOwner: isBotOwner(row.discordUserId),
        };
        c.set('sessionCtx', ctx);
        touchWebSession(db, row.id);
      } else {
        // Stale cookie — clear it.
        clearSessionCookie(c);
      }
    }
    await next();
  };
}

export function getSession(c: Context<AppEnv>): SessionContext | undefined {
  return c.get('sessionCtx');
}

export function requireSession(c: Context<AppEnv>): SessionContext | Response {
  const ctx = getSession(c);
  if (!ctx) return c.redirect('/auth/discord/start');
  return ctx;
}

export function destroySession(c: Context<AppEnv>): void {
  const sid = readSessionId(c);
  if (sid) deleteWebSession(getWebDb(), sid);
  clearSessionCookie(c);
}
