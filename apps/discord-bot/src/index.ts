import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbPathFromUrl, getEnv, isInternalApiEnabled } from '@atmosfera/config';
import { type Db, createDb, migrateDb } from '@atmosfera/db';
import { schedulePurge, setUserRoastDb } from '@atmosfera/user-roast';
import {
  ApplicationCommandRegistries,
  RegisterBehavior,
  SapphireClient,
  container,
} from '@sapphire/framework';
import { GatewayIntentBits, Partials } from 'discord.js';
import { startInternalApi } from './internal-api';

// Bulk-overwrite so commands that aren't in our registry (e.g. leftover
// skilishu commands like /roast-optin-brutal) get deleted on startup.
ApplicationCommandRegistries.setDefaultBehaviorWhenNotIdentical(RegisterBehavior.BulkOverwrite);

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

// user-roast carries its own raw-SQL queries (UNION-ALL aggregates, FTS5 MATCH);
// hand it the underlying bun:sqlite client and start the retention purge loop.
setUserRoastDb(db.$client);
schedulePurge();

const client = new SapphireClient({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  loadMessageCommandListeners: false,
  loadDefaultErrorListeners: true,
  baseUserDirectory: here,
});

client.once('ready', (c) => {
  console.log(`ready as ${c.user.tag} in ${c.guilds.cache.size} guild(s)`);
  console.log(`db: ${dbPath}`);
});

await client.login(env.DISCORD_TOKEN);

if (isInternalApiEnabled()) {
  try {
    const api = startInternalApi(client);
    console.log(`internal api listening on 127.0.0.1:${api.port}`);
  } catch (err) {
    // Port-in-use or similar — keep the bot running, log loudly.
    console.error('internal api failed to start:', err);
  }
}
