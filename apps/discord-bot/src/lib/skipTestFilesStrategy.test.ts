import { describe, expect, it } from 'bun:test';
import { SkipTestFilesStrategy } from './skipTestFilesStrategy';

describe('SkipTestFilesStrategy', () => {
  const strategy = new SkipTestFilesStrategy();

  it('rejects colocated test and spec files', () => {
    expect(strategy.filter('/bot/src/commands/commandPermissions.test.ts')).toBeNull();
    expect(strategy.filter('/bot/src/commands/foo.spec.ts')).toBeNull();
    expect(strategy.filter('/bot/src/commands/foo.test.mjs')).toBeNull();
  });

  it('still accepts regular piece files', () => {
    const result = strategy.filter('/bot/src/commands/radar.ts');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('radar');
  });
});
