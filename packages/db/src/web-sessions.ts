import { eq, lt } from 'drizzle-orm';
import type { Db } from './client';
import { type WebSession, webSessions } from './schema';

export interface CreateWebSessionInput {
  id: string;
  discordUserId: string;
  discordUsername: string;
  discordGlobalName: string | null;
  discordAvatarHash: string | null;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessTokenExpiresAt: number;
  oauthGuildsJson: string;
}

export function createWebSession(db: Db, input: CreateWebSessionInput): WebSession {
  const now = Date.now();
  const inserted = db
    .insert(webSessions)
    .values({
      id: input.id,
      discordUserId: input.discordUserId,
      discordUsername: input.discordUsername,
      discordGlobalName: input.discordGlobalName,
      discordAvatarHash: input.discordAvatarHash,
      accessTokenEnc: input.accessTokenEnc,
      refreshTokenEnc: input.refreshTokenEnc,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      oauthGuildsJson: input.oauthGuildsJson,
      oauthGuildsFetchedAt: now,
      createdAt: now,
      lastSeenAt: now,
    })
    .returning()
    .get();
  if (!inserted) throw new Error('createWebSession: insert returned no row');
  return inserted;
}

export function getWebSession(db: Db, id: string): WebSession | undefined {
  return db.select().from(webSessions).where(eq(webSessions.id, id)).get();
}

export function touchWebSession(db: Db, id: string): void {
  db.update(webSessions).set({ lastSeenAt: Date.now() }).where(eq(webSessions.id, id)).run();
}

export interface UpdateWebSessionTokensInput {
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessTokenExpiresAt: number;
}

export function updateWebSessionTokens(
  db: Db,
  id: string,
  input: UpdateWebSessionTokensInput,
): void {
  db.update(webSessions)
    .set({
      accessTokenEnc: input.accessTokenEnc,
      refreshTokenEnc: input.refreshTokenEnc,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      lastSeenAt: Date.now(),
    })
    .where(eq(webSessions.id, id))
    .run();
}

export function updateWebSessionGuilds(db: Db, id: string, oauthGuildsJson: string): void {
  db.update(webSessions)
    .set({ oauthGuildsJson, oauthGuildsFetchedAt: Date.now() })
    .where(eq(webSessions.id, id))
    .run();
}

export function deleteWebSession(db: Db, id: string): void {
  db.delete(webSessions).where(eq(webSessions.id, id)).run();
}

/** Bulk-delete sessions whose refresh window has clearly expired (>30d unused). */
export function purgeStaleWebSessions(db: Db, olderThanMs: number): void {
  const cutoff = Date.now() - olderThanMs;
  db.delete(webSessions).where(lt(webSessions.lastSeenAt, cutoff)).run();
}
