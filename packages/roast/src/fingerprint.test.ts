import { describe, expect, it } from 'bun:test';
import type { ClimateCube } from '@atmosfera/climate';
import type { City } from '@atmosfera/db';
import { extractContrast, extractFingerprint } from './fingerprint';

function makeCube(opts: { hotPeak: number; hotDoy: number; meanT?: number }): ClimateCube {
  const meanT = opts.meanT ?? 15;
  // Bell curve peaking at hotDoy
  const dailyMean = (d: number) =>
    meanT + (opts.hotPeak - meanT) * Math.exp(-((d - opts.hotDoy) ** 2) / 5000);
  const temperatureMean = Array.from({ length: 365 }, (_, d) => {
    const v = dailyMean(d);
    return new Array(24).fill(v);
  });

  return {
    latitude: 0,
    longitude: 0,
    timezone: 'UTC',
    window: { startYear: 2011, endYear: 2025 },
    version: 'v1-gauss',
    temperatureMean,
    temperatureP10: temperatureMean.map((row) => row.map((v) => v - 3)),
    temperatureP90: temperatureMean.map((row) => row.map((v) => v + 3)),
    dewpointMean: temperatureMean.map((row) => row.map((v) => v - 5)),
    cloudcoverMean: Array.from({ length: 365 }, () => new Array(24).fill(50)),
    muggyProbability: Array.from(
      { length: 365 },
      (_, d) => 0.7 * Math.exp(-((d - 200) ** 2) / 3000),
    ),
    wetDayProbability: Array.from(
      { length: 365 },
      (_, d) => 0.4 * Math.exp(-((d - 180) ** 2) / 4000),
    ),
    wetBulbMean: Array.from({ length: 365 }, () => new Array(24).fill(15)),
    wetBulbAnnualPeakMean: 22,
    wetBulbHoursAbove75F: 0,
    wetBulbHoursAbove80F: 0,
    wetBulbHoursAbove85F: 0,
    wetBulbWorstMonthIndex: 6,
    wetBulbWorstMonthMean: 18,
  };
}

const city: City = {
  id: 1,
  canonicalName: 'TestCity',
  region: 'TestRegion',
  country: 'TestLand',
  latitude: 0,
  longitude: 0,
  timezone: 'UTC',
  population: null,
  openMeteoId: null,
  createdAt: new Date(),
};

describe('extractFingerprint', () => {
  it('finds hottest and coldest days', () => {
    const cube = makeCube({ hotPeak: 30, hotDoy: 200, meanT: 5 });
    const fp = extractFingerprint(city, cube);
    expect(fp.hottestDay.doy).toBe(200);
    expect(fp.hottestDay.meanC).toBeCloseTo(30, 0);
    // Coldest should be far from doy 200 — basically day 0 or 364
    expect([0, 364]).toContain(fp.coldestDay.doy);
  });

  it('finds peak muggy and wet days', () => {
    const fp = extractFingerprint(city, makeCube({ hotPeak: 25, hotDoy: 200 }));
    expect(fp.peakMuggyDay.doy).toBe(200);
    expect(fp.peakWetDay.doy).toBe(180);
    expect(fp.peakMuggyDay.probability).toBeCloseTo(0.7, 1);
  });

  it('counts days above 35°C only when present', () => {
    const cool = extractFingerprint(city, makeCube({ hotPeak: 25, hotDoy: 200 }));
    expect(cool.daysAbove35C).toBe(0);
    const hot = extractFingerprint(city, makeCube({ hotPeak: 40, hotDoy: 200 }));
    expect(hot.daysAbove35C).toBeGreaterThan(0);
  });

  it('produces a month-day string for peak days', () => {
    const fp = extractFingerprint(city, makeCube({ hotPeak: 30, hotDoy: 200 }));
    // Day 200 is ~Jul 20 in the non-leap calendar
    expect(fp.hottestDay.monthDay).toMatch(/^Jul \d+$/);
  });
});

describe('extractContrast', () => {
  it('captures opposite-hemisphere temperature deltas', () => {
    const northern = extractFingerprint(city, makeCube({ hotPeak: 30, hotDoy: 200, meanT: 12 }));
    const southern = extractFingerprint(city, makeCube({ hotPeak: 28, hotDoy: 20, meanT: 18 }));
    const c = extractContrast(northern, southern);
    expect(c.tempDeltaAnnualC).toBeGreaterThan(0);
    expect(c.tempDeltaSummerC).toBeLessThan(5);
  });
});
