import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbPathFromUrl, getEnv } from '@atmosfera/config';
import { type Db, createDb, migrateDb } from '@atmosfera/db';
import { SapphireClient, container } from '@sapphire/framework';
import { GatewayIntentBits } from 'discord.js';

declare module '@sapphire/framework' {
  interface Container {
    db: Db;
  }
}

const env = getEnv();
if (!env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN not set — copy .env.example to .env and fill it in');
  process.exit(1);
}

// Resolve DB path relative to the repo root so the bot can be launched from any
// cwd without losing its cache. apps/discord-bot/src → repo root is three levels up.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const dbPath = resolve(repoRoot, dbPathFromUrl(env.DATABASE_URL));
mkdirSync(dirname(dbPath), { recursive: true });

const db = createDb(dbPath);
migrateDb(db);
container.db = db;

const client = new SapphireClient({
  intents: [GatewayIntentBits.Guilds],
  loadMessageCommandListeners: false,
  loadDefaultErrorListeners: true,
  baseUserDirectory: here,
});

client.once('ready', (c) => {
  console.log(`ready as ${c.user.tag} in ${c.guilds.cache.size} guild(s)`);
  console.log(`db: ${dbPath}`);
});

await client.login(env.DISCORD_TOKEN);
