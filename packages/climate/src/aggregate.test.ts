import { describe, expect, it } from 'bun:test';
import { aggregateCube, dayOfYearNoLeap, parseLocalTimestamp, percentile } from './aggregate';
import type { HourlyYearData } from './types';
import { wetBulbC } from './wetbulb';

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function makeEmptyYear(): HourlyYearData {
  return {
    time: [],
    temperature_2m: [],
    dew_point_2m: [],
    relative_humidity_2m: [],
    precipitation: [],
    cloud_cover: [],
  };
}

interface HourlyConditions {
  tempC: number;
  rh: number;
}

/** Build a synthetic non-leap year (2023) where each month gets the
 *  conditions returned by `forMonth(monthIndex)`. */
function buildSyntheticYear(forMonth: (monthIdx: number) => HourlyConditions): HourlyYearData {
  const year = makeEmptyYear();
  for (let m = 1; m <= 12; m++) {
    const { tempC, rh } = forMonth(m - 1);
    const monthLen = MONTH_LENGTHS[m - 1]!;
    for (let d = 1; d <= monthLen; d++) {
      for (let h = 0; h < 24; h++) {
        year.time.push(
          `2023-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00`,
        );
        year.temperature_2m.push(tempC);
        year.dew_point_2m.push(tempC - 5); // not used by these assertions
        year.relative_humidity_2m.push(rh);
        year.precipitation.push(0);
        year.cloud_cover.push(50);
      }
    }
  }
  return year;
}

describe('parseLocalTimestamp', () => {
  it('parses Open-Meteo iso8601 (no tz) strings', () => {
    expect(parseLocalTimestamp('2024-03-15T07:00')).toEqual({ month: 3, day: 15, hour: 7 });
    expect(parseLocalTimestamp('2024-12-31T23:00')).toEqual({ month: 12, day: 31, hour: 23 });
  });
});

describe('dayOfYearNoLeap', () => {
  it('returns 0 for Jan 1 and 364 for Dec 31', () => {
    expect(dayOfYearNoLeap(1, 1)).toBe(0);
    expect(dayOfYearNoLeap(12, 31)).toBe(364);
  });

  it('returns null for Feb 29', () => {
    expect(dayOfYearNoLeap(2, 29)).toBeNull();
  });

  it('March 1 is day 59 (regardless of leap year)', () => {
    expect(dayOfYearNoLeap(3, 1)).toBe(59);
  });
});

describe('percentile', () => {
  it('matches numpy-style linear interpolation', () => {
    const values = [1, 2, 3, 4, 5];
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 1)).toBe(5);
    expect(percentile(values, 0.5)).toBe(3);
    expect(percentile(values, 0.25)).toBe(2);
  });

  it('returns NaN for empty input', () => {
    expect(percentile([], 0.5)).toBeNaN();
  });
});

describe('aggregateCube', () => {
  it('produces 365x24 matrices and 365-length probability arrays', () => {
    const year: HourlyYearData = {
      time: [],
      temperature_2m: [],
      dew_point_2m: [],
      relative_humidity_2m: [],
      precipitation: [],
      cloud_cover: [],
    };
    // Synthesize a constant year of 8760 hours
    for (let m = 1; m <= 12; m++) {
      const monthLen = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
      for (let d = 1; d <= monthLen; d++) {
        for (let h = 0; h < 24; h++) {
          year.time.push(
            `2023-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00`,
          );
          year.temperature_2m.push(20);
          year.dew_point_2m.push(19); // always muggy
          year.relative_humidity_2m.push(94); // ~saturated at 20°C / dewpoint 19°C
          year.precipitation.push(0);
          year.cloud_cover.push(50);
        }
      }
    }

    const cube = aggregateCube([year], {
      latitude: 0,
      longitude: 0,
      timezone: 'UTC',
      startYear: 2023,
      endYear: 2023,
    });

    expect(cube.temperatureMean).toHaveLength(365);
    expect(cube.temperatureMean[0]).toHaveLength(24);
    expect(cube.muggyProbability).toHaveLength(365);
    expect(cube.wetDayProbability).toHaveLength(365);
    expect(cube.temperatureMean[0]![0]).toBeCloseTo(20);
    expect(cube.muggyProbability[0]).toBeCloseTo(1); // every hour muggy
    expect(cube.wetDayProbability[0]).toBe(0);
  });

  it('drops Feb 29 from leap years', () => {
    const year: HourlyYearData = {
      time: [],
      temperature_2m: [],
      dew_point_2m: [],
      relative_humidity_2m: [],
      precipitation: [],
      cloud_cover: [],
    };
    // Just feed Feb 29 hours
    for (let h = 0; h < 24; h++) {
      year.time.push(`2024-02-29T${String(h).padStart(2, '0')}:00`);
      year.temperature_2m.push(100);
      year.dew_point_2m.push(100);
      year.relative_humidity_2m.push(100);
      year.precipitation.push(0);
      year.cloud_cover.push(0);
    }

    const cube = aggregateCube([year], {
      latitude: 0,
      longitude: 0,
      timezone: 'UTC',
      startYear: 2024,
      endYear: 2024,
    });

    // No day got any samples; everything should be NaN-or-zero
    expect(cube.muggyProbability.every((p) => p === 0)).toBe(true);
    for (let h = 0; h < 24; h++) {
      expect(cube.temperatureMean[0]![h]).toBeNaN();
    }
  });

  it('wet-bulb stats: detects worst month, peak, and threshold hours', () => {
    // July: 35°C / 70% RH → WB ≈ 30°C ≈ 86°F (crosses all 3 thresholds).
    // Rest of year: cool/dry, WB well below 75°F.
    const julyConditions: HourlyConditions = { tempC: 35, rh: 70 };
    const otherConditions: HourlyConditions = { tempC: 10, rh: 50 };
    const year = buildSyntheticYear((m) => (m === 6 ? julyConditions : otherConditions));

    const cube = aggregateCube([year], {
      latitude: 0,
      longitude: 0,
      timezone: 'UTC',
      startYear: 2023,
      endYear: 2023,
    });

    const julyWb = wetBulbC(julyConditions.tempC, julyConditions.rh);
    const julyHours = 31 * 24;

    expect(cube.wetBulbWorstMonthIndex).toBe(6);
    expect(cube.wetBulbWorstMonthMean).toBeCloseTo(julyWb, 5);
    expect(cube.wetBulbAnnualPeakMean).toBeCloseTo(julyWb, 5);
    expect(cube.wetBulbHoursAbove75F).toBe(julyHours);
    expect(cube.wetBulbHoursAbove80F).toBe(julyHours);
    expect(cube.wetBulbHoursAbove85F).toBe(julyHours);
    // Worst-month mean should equal the WB of that day's mean(s).
    const julyDoy0 = 31 + 28 + 31 + 30 + 31 + 30; // June 30 → July 1 is doy 181
    expect(cube.wetBulbMean[julyDoy0]![12]).toBeCloseTo(julyWb, 5);
  });

  it('wet-bulb stays low for dry heat (Phoenix-like)', () => {
    // 40°C / 10% RH year-round → WB ≈ 17°C ≈ 63°F: well under 75°F.
    const year = buildSyntheticYear(() => ({ tempC: 40, rh: 10 }));

    const cube = aggregateCube([year], {
      latitude: 33.45,
      longitude: -112.07,
      timezone: 'UTC',
      startYear: 2023,
      endYear: 2023,
    });

    expect(cube.wetBulbHoursAbove75F).toBe(0);
    expect(cube.wetBulbHoursAbove80F).toBe(0);
    expect(cube.wetBulbHoursAbove85F).toBe(0);
    expect(cube.wetBulbAnnualPeakMean).toBeLessThan(20);
  });
});
