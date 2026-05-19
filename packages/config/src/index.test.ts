import { describe, expect, it } from 'bun:test';
import { dbPathFromUrl } from './index';

describe('@atmosfera/config', () => {
  it('strips file: prefix from sqlite URLs', () => {
    expect(dbPathFromUrl('file:./data/atmosfera.db')).toBe('./data/atmosfera.db');
    expect(dbPathFromUrl('/abs/path.db')).toBe('/abs/path.db');
  });
});
