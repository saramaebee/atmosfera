import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listScopes } from '../lib/permissions';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMMAND_FILES = readdirSync(HERE)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .sort();

/**
 * Static, no-instantiation guard. Every command file must:
 *   1. include `requiredClientPermissions:` in its constructor options
 *   2. include `preconditions: ['AtmosferaScope']` (or a superset containing it)
 *   3. register a CommandScope via `registerScope('<name>', ...)`
 *
 * This catches a new command shipping without scope/perms annotations. It
 * does NOT validate that the declared perms cover the discord.js calls the
 * implementation actually makes — that's an authorial responsibility codified
 * in CLAUDE.md.
 */
describe('command permission/scope hygiene', () => {
  for (const file of COMMAND_FILES) {
    const path = join(HERE, file);
    const source = readFileSync(path, 'utf8');

    it(`${file} declares requiredClientPermissions`, () => {
      expect(source).toContain('requiredClientPermissions:');
    });

    it(`${file} attaches the AtmosferaScope precondition`, () => {
      expect(source).toMatch(/preconditions:\s*\[[^\]]*['"]AtmosferaScope['"]/);
    });

    it(`${file} registers a CommandScope`, () => {
      expect(source).toMatch(/registerScope\(/);
    });
  }

  it('every command file ends up in the in-memory scopeRegistry after import', async () => {
    for (const file of COMMAND_FILES) {
      // Importing the module triggers its top-level registerScope() call.
      await import(`./${file.replace(/\.ts$/, '')}`);
    }

    const registered = listScopes();
    // Sanity check — at least the core 12 commands must be present.
    const expected = [
      'ping',
      'climate',
      'wet',
      'muggy',
      'compare',
      'roast',
      'roast-user-config',
      'pinned-roast',
      'privacy',
      'roast-setup',
      'roast-config',
      'permissions',
    ];
    for (const name of expected) {
      expect(registered.has(name)).toBe(true);
    }
  });
});
