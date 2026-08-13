import { describe, expect, it } from 'bun:test';
import type { ClimateCube } from '@atmosfera/climate';
import { chartCachePath, compareCubesCanonical } from './cache';

function cubeAt(latitude: number, longitude: number): ClimateCube {
  return {
    latitude,
    longitude,
    timezone: 'UTC',
    window: { startYear: 2011, endYear: 2025 },
    version: 'v0-raw',
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

describe('compareCubesCanonical', () => {
  it('orders by latitude ascending', () => {
    const ba = cubeAt(-34.6037, -58.3816);
    const reykjavik = cubeAt(64.1466, -21.9426);
    expect(compareCubesCanonical(ba, reykjavik)).toBeLessThan(0);
    expect(compareCubesCanonical(reykjavik, ba)).toBeGreaterThan(0);
  });

  it('uses longitude as tiebreaker', () => {
    const west = cubeAt(40, -100);
    const east = cubeAt(40, 100);
    expect(compareCubesCanonical(west, east)).toBeLessThan(0);
    expect(compareCubesCanonical(east, west)).toBeGreaterThan(0);
  });

  it('produces the same sorted order regardless of input order', () => {
    const ba = cubeAt(-34.6037, -58.3816);
    const reykjavik = cubeAt(64.1466, -21.9426);
    const a = [ba, reykjavik].sort(compareCubesCanonical);
    const b = [reykjavik, ba].sort(compareCubesCanonical);
    expect(a.map((c) => c.latitude)).toEqual(b.map((c) => c.latitude));
    expect(a[0]).toBe(ba);
  });
});

describe('chartCachePath', () => {
  it('partitions the cache by theme so light and dark never collide', () => {
    const cubes = [cubeAt(-34.6037, -58.3816)];
    const dark = chartCachePath('heatmap', cubes, 'dark');
    const light = chartCachePath('heatmap', cubes, 'light');
    expect(dark).not.toBe(light);
    expect(dark).toContain('heatmap-dark-');
    expect(light).toContain('heatmap-light-');
  });

  it('defaults to the dark theme and stays stable for equal inputs', () => {
    const cubes = [cubeAt(-34.6037, -58.3816)];
    expect(chartCachePath('muggy', cubes)).toBe(chartCachePath('muggy', cubes, 'dark'));
  });
});
