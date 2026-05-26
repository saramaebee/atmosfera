import { getExplainMode, shouldExplainExist } from '@atmosfera/explain';
import { container } from '@sapphire/framework';
import { ApplicationCommandType, type Client } from 'discord.js';
import { EXPLAIN_COMMAND_NAME, buildExplainCommandData } from '../commands/explain';

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
