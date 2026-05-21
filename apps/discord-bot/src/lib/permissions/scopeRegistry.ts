import type { CommandScope } from './types';

const registry = new Map<string, CommandScope>();

/**
 * Register a command's compiled-in scope. Call at module load (top-level in
 * the command file) so the registry is populated before Sapphire loads
 * commands. Last registration wins.
 */
export function registerScope(name: string, scope: CommandScope): void {
  registry.set(name, scope);
}

export function getScope(name: string): CommandScope | undefined {
  return registry.get(name);
}

export function listScopes(): ReadonlyMap<string, CommandScope> {
  return registry;
}
