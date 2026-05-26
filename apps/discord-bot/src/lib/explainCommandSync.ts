import { getExplainMode, shouldExplainExist } from '@atmosfera/explain';
import { container } from '@sapphire/framework';
import { ApplicationCommandType, type Client } from 'discord.js';
import { EXPLAIN_COMMAND_NAME, buildExplainCommandData } from '../commands/explain';

/**
 * Make Sapphire route the "Explain" context-menu interaction to the ExplainCommand
 * piece. Sapphire normally maps a context command's display name → piece via an
 * alias set during registration — but Explain is intentionally NOT registered
 * through Sapphire (see explain.ts), so that alias never exists. Worse, the piece
 * is stored under its lowercased name ('explain'), while the Discord command name
 * is 'Explain', so the built-in `commandStore.get(commandName)` lookup misses and
 * the interaction resolves to nothing ("The application did not respond"). We
 * recreate exactly the alias Sapphire's registration would have created.
 */
export function registerExplainRoutingAlias(): void {
  const store = container.stores.get('commands');
  const piece = store.get(EXPLAIN_COMMAND_NAME.toLowerCase());
  if (!piece) {
    container.logger.warn('explain routing alias: Explain command piece not loaded');
    return;
  }
  store.aliases.set(EXPLAIN_COMMAND_NAME, piece);
}

/**
 * Reconcile the Explain message context-menu command for a single guild to
 * match its DB mode: present when mode !== 'off', absent when 'off'. Idempotent
 * and best-effort — logs and swallows API errors so a failed sync never breaks
 * the mutation that triggered it. Returns whether the reconcile succeeded.
 */
export async function reconcileExplainCommand(client: Client, guildId: string): Promise<boolean> {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;

    const shouldExist = shouldExplainExist(getExplainMode(guildId));
    const commands = await guild.commands.fetch();
    const existing = commands.find(
      (c) => c.name === EXPLAIN_COMMAND_NAME && c.type === ApplicationCommandType.Message,
    );

    if (shouldExist && !existing) {
      await guild.commands.create(buildExplainCommandData());
    } else if (!shouldExist && existing) {
      await guild.commands.delete(existing.id);
    }
    return true;
  } catch (err) {
    container.logger.error(`explain command sync failed for guild ${guildId}:`, err);
    return false;
  }
}

/** Reconcile every guild the bot is in. Used at startup and after registration. */
export async function reconcileAllGuilds(client: Client): Promise<void> {
  for (const guildId of client.guilds.cache.keys()) {
    await reconcileExplainCommand(client, guildId);
  }
}
