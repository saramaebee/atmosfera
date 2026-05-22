import { getEnv } from '@atmosfera/config';
import { createWebSession } from '@atmosfera/db';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getWebDb } from '../state';
import type { AppEnv, OAuthGuildSummary } from '../types';
import { decryptToken, encryptToken, pkceChallenge, randomId } from './crypto';
import { destroySession, setSessionCookie } from './session';

const DISCORD_API = 'https://discord.com/api/v10';
const OAUTH_SCOPES = ['identify', 'guilds'].join(' ');
const STATE_COOKIE = 'atm_oauth_state';
const VERIFIER_COOKIE = 'atm_oauth_pkce';
const COOKIE_TTL = 600; // 10 min

interface DiscordTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
  scope: string;
}

interface DiscordUserResponse {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

interface DiscordGuildResponse {
  id: string;
  name: string;
  icon: string | null;
  permissions: string;
}

async function exchangeCode(code: string, verifier: string): Promise<DiscordTokenResponse> {
  const env = getEnv();
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID ?? '',
    client_secret: env.DISCORD_CLIENT_SECRET ?? '',
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.DISCORD_OAUTH_REDIRECT_URI ?? '',
    code_verifier: verifier,
  });
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord token exchange failed: ${res.status} ${text}`);
  }
  return (await res.json()) as DiscordTokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<DiscordTokenResponse> {
  const env = getEnv();
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID ?? '',
    client_secret: env.DISCORD_CLIENT_SECRET ?? '',
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord refresh failed: ${res.status} ${text}`);
  }
  return (await res.json()) as DiscordTokenResponse;
}

async function fetchUser(accessToken: string): Promise<DiscordUserResponse> {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`fetchUser: ${res.status}`);
  return (await res.json()) as DiscordUserResponse;
}

export async function fetchUserGuilds(accessToken: string): Promise<OAuthGuildSummary[]> {
  const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`fetchUserGuilds: ${res.status}`);
  const list = (await res.json()) as DiscordGuildResponse[];
  return list.map((g) => ({ id: g.id, name: g.name, icon: g.icon, permissions: g.permissions }));
}

export async function decryptSessionAccessToken(blob: string): Promise<string> {
  return decryptToken(blob);
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/discord/start', async (c) => {
  const env = getEnv();
  const state = randomId(24);
  const verifier = randomId(48);
  const challenge = await pkceChallenge(verifier);

  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_TTL,
  });
  setCookie(c, VERIFIER_COOKIE, verifier, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_TTL,
  });

  const url = new URL(`${DISCORD_API}/oauth2/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.DISCORD_CLIENT_ID ?? '');
  url.searchParams.set('redirect_uri', env.DISCORD_OAUTH_REDIRECT_URI ?? '');
  url.searchParams.set('scope', OAUTH_SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return c.redirect(url.toString());
});

authRoutes.get('/discord/callback', async (c) => {
  const code = c.req.query('code');
  const presentedState = c.req.query('state');
  const expectedState = getCookie(c, STATE_COOKIE);
  const verifier = getCookie(c, VERIFIER_COOKIE);

  deleteCookie(c, STATE_COOKIE, { path: '/' });
  deleteCookie(c, VERIFIER_COOKIE, { path: '/' });

  if (!code || !presentedState || !expectedState || presentedState !== expectedState) {
    return c.text('Invalid OAuth state', 400);
  }
  if (!verifier) return c.text('Missing PKCE verifier', 400);

  const tokens = await exchangeCode(code, verifier);
  const [user, guilds] = await Promise.all([
    fetchUser(tokens.access_token),
    fetchUserGuilds(tokens.access_token),
  ]);

  const [accessEnc, refreshEnc] = await Promise.all([
    encryptToken(tokens.access_token),
    encryptToken(tokens.refresh_token),
  ]);

  const sessionId = randomId(32);
  createWebSession(getWebDb(), {
    id: sessionId,
    discordUserId: user.id,
    discordUsername: user.username,
    discordGlobalName: user.global_name,
    discordAvatarHash: user.avatar,
    accessTokenEnc: accessEnc,
    refreshTokenEnc: refreshEnc,
    accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    oauthGuildsJson: JSON.stringify(guilds),
  });

  setSessionCookie(c, sessionId);
  return c.redirect('/guilds');
});

authRoutes.post('/logout', async (c) => {
  destroySession(c);
  return c.redirect('/');
});
