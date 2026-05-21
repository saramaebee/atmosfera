import { getEnv } from '@atmosfera/config';

/**
 * Slash command registration scope. When DISCORD_DEV_GUILD_ID is set we register
 * per-guild (instant propagation, dev-only). Otherwise commands register globally.
 */
export function chatInputRegisterOptions(): { guildIds?: string[]; idHints?: string[] } {
  const devGuildId = getEnv().DISCORD_DEV_GUILD_ID;
  if (devGuildId) {
    return { guildIds: [devGuildId], idHints: [] };
  }
  return { idHints: [] };
}
