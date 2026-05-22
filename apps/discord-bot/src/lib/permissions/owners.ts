import { getEnv } from '@atmosfera/config';

// Memoized at first read. Changing DISCORD_OWNER_IDS requires a process
// restart to take effect — env is loaded once and the set isn't refreshed.
let ownersSet: Set<string> | null = null;

function owners(): Set<string> {
  if (ownersSet) return ownersSet;
  ownersSet = new Set(getEnv().DISCORD_OWNER_IDS);
  return ownersSet;
}

export function isBotOwner(userId: string): boolean {
  return owners().has(userId);
}

export function listBotOwnerIds(): readonly string[] {
  return [...owners()];
}
