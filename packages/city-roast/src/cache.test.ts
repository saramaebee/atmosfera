import { afterEach, describe, expect, it } from 'bun:test';
import { rmSync } from 'node:fs';
import type { ClimateCube } from '@atmosfera/climate';
import { getCachedRoast, putCachedRoast, roastCachePath } from './cache';
import type { RoastOptions } from './types';

const TEST_TAG = '__test_roast_cache__';

afterEach(() => {
  // Clean up any test artifacts we may have written
  try {
    rmSync('.cache/roasts', { recursive: true, force: true });
  } catch {}
});

function fakeCube(lat: number, lon: number, version = 'v1-gauss'): ClimateCube {
  return {
    latitude: lat,
    longitude: lon,
    timezone: 'UTC',
    window: { startYear: 2011, endYear: 2025 },
    version,
    temperatureMean: [],
    temperatureP10: [],
    temperatureP90: [],
    dewpointMean: [],
    cloudcoverMean: [],
    muggyProbability: [],
    wetDayProbability: [],
    wetBulbMean: [],
    wetBulbAnnualPeakMean: 0,
    wetBulbHoursAbove75F: 0,
    wetBulbHoursAbove80F: 0,
    wetBulbHoursAbove85F: 0,
    wetBulbWorstMonthIndex: 0,
    wetBulbWorstMonthMean: 0,
  };
}

const opts: RoastOptions = { tone: 'snarky', culture: true, length: '1-sentence' };

describe('roast cache', () => {
  it('returns null on miss', () => {
    const cube = fakeCube(1.234, 5.678);
    expect(getCachedRoast(opts, [cube], false)).toBeNull();
  });

  it('round-trips a roast', () => {
    const cube = fakeCube(2.345, 6.789);
    const text = `${TEST_TAG} sample roast`;
    putCachedRoast(text, opts, [cube], false);
    expect(getCachedRoast(opts, [cube], false)).toBe(text);
  });

  it('separates contrast cache from single-city cache', () => {
    const a = fakeCube(1, 1);
    const b = fakeCube(2, 2);
    putCachedRoast(`${TEST_TAG} single`, opts, [a], false);
    putCachedRoast(`${TEST_TAG} contrast`, opts, [a, b], true);
    expect(getCachedRoast(opts, [a], false)).toBe(`${TEST_TAG} single`);
    expect(getCachedRoast(opts, [a, b], true)).toBe(`${TEST_TAG} contrast`);
  });

  it('cube version change invalidates the cache', () => {
    const v1 = fakeCube(3, 3, 'v1-gauss');
    const v2 = fakeCube(3, 3, 'v2-future');
    putCachedRoast(`${TEST_TAG} v1`, opts, [v1], false);
    expect(getCachedRoast(opts, [v2], false)).toBeNull();
  });

  it('different tone produces different cache slot', () => {
    const cube = fakeCube(4, 4);
    putCachedRoast(`${TEST_TAG} snarky`, opts, [cube], false);
    expect(getCachedRoast({ ...opts, tone: 'affectionate' }, [cube], false)).toBeNull();
  });

  it('path is stable and includes the kind', () => {
    const cube = fakeCube(5, 5);
    expect(roastCachePath(opts, [cube], false)).toMatch(/^\.cache\/roasts\/[a-f0-9]{16}\.txt$/);
  });
});
