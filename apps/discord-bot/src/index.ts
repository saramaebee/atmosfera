import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SapphireClient } from '@sapphire/framework';
import { GatewayIntentBits } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN not set — copy .env.example to .env and fill it in');
  process.exit(1);
}

const baseUserDirectory = dirname(fileURLToPath(import.meta.url));

const client = new SapphireClient({
  intents: [GatewayIntentBits.Guilds],
  loadMessageCommandListeners: false,
  loadDefaultErrorListeners: true,
  baseUserDirectory,
});

client.once('ready', (c) => {
  const commandNames = [...c.application.commands.cache.values()].map((cmd) => cmd.name);
  console.log(`ready as ${c.user.tag} in ${c.guilds.cache.size} guild(s)`);
  console.log(`global commands: ${commandNames.join(', ') || '(none)'}`);
  for (const guild of c.guilds.cache.values()) {
    const names = [...guild.commands.cache.values()].map((cmd) => cmd.name);
    console.log(`  ${guild.name} (${guild.id}): ${names.join(', ') || '(none)'}`);
  }
});

await client.login(token);
