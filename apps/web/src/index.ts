import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbPathFromUrl, getEnv } from '@atmosfera/config';
import { createDb, migrateDb } from '@atmosfera/db';
import { app } from './app';
import { setWebDb } from './state';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

const env = getEnv();

const missing: string[] = [];
if (!env.DISCORD_CLIENT_ID) missing.push('DISCORD_CLIENT_ID');
if (!env.DISCORD_CLIENT_SECRET) missing.push('DISCORD_CLIENT_SECRET');
if (!env.DISCORD_OAUTH_REDIRECT_URI) missing.push('DISCORD_OAUTH_REDIRECT_URI');
if (!env.SESSION_SECRET) missing.push('SESSION_SECRET');
if (!env.WEB_PUBLIC_URL) missing.push('WEB_PUBLIC_URL');
if (missing.length > 0) {
  console.error(`web: missing required env vars: ${missing.join(', ')}`);
  console.error('See .env.example for setup instructions.');
  process.exit(1);
}

const dbPath = resolve(repoRoot, dbPathFromUrl(env.DATABASE_URL));
mkdirSync(dirname(dbPath), { recursive: true });

const db = createDb(dbPath);
migrateDb(db);
setWebDb(db);

const port = env.WEB_PORT;
console.log(`web: listening on http://localhost:${port}`);
console.log(`web: public url ${env.WEB_PUBLIC_URL}`);
console.log(`web: db ${dbPath}`);

export default {
  port,
  fetch: app.fetch,
};
