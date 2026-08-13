import { describe, expect, it } from 'bun:test';
import {
  type ForecastNow,
  forecastCacheKey,
  forecastResponseSchema,
  selectDailyForecast,
  selectUpcomingHours,
} from './forecast';

function makeFixture(currentTime: string): ForecastNow {
  const time: string[] = [];
  const temperature_2m: number[] = [];
  const weather_code: number[] = [];
  const is_day: number[] = [];
  for (let d = 8; d <= 9; d++) {
    for (let h = 0; h < 24; h++) {
      time.push(`2026-08-0${d}T${String(h).padStart(2, '0')}:00`);
      temperature_2m.push(20 + (h % 12));
      weather_code.push(h < 6 || h >= 20 ? 0 : 2);
      is_day.push(h >= 6 && h < 20 ? 1 : 0);
    }
  }
  return {
    latitude: 34,
    longitude: -81,
    timezone: 'America/New_York',
    current: {
      time: currentTime,
      temperature_2m: 24.3,
      relative_humidity_2m: 89,
      is_day: 1,
      weather_code: 0,
      wind_speed_10m: 3.2,
      wind_direction_10m: 180,
    },
    hourly: { time, temperature_2m, weather_code, is_day },
    daily: {
      time: ['08', '09', '10', '11', '12', '13', '14', '15'].map((d) => `2026-08-${d}`),
      weather_code: [2, 3, 61, 0, 0, 2, 95, 1],
      temperature_2m_max: [35, 36, 36, 36, 38, 37, 35, 36],
      temperature_2m_min: [25, 26, 26, 26, 27, 27, 26, 25],
      precipitation_probability_max: [30, 45, 80, 0, 5, 20, 90, null],
    },
  };
}

describe('forecastResponseSchema', () => {
  it('round-trips a realistic payload', () => {
    const fixture = makeFixture('2026-08-08T14:15');
    expect(forecastResponseSchema.parse(fixture)).toEqual(fixture);
  });

  it('rejects a mangled payload', () => {
    const bad = {
      ...makeFixture('2026-08-08T14:15'),
      current: { ...makeFixture('2026-08-08T14:15').current, temperature_2m: 'hot' },
    };
    expect(() => forecastResponseSchema.parse(bad)).toThrow();
  });

  it('rejects a mangled daily block', () => {
    const fixture = makeFixture('2026-08-08T14:15');
    const bad = {
      ...fixture,
      daily: { ...fixture.daily, temperature_2m_max: 'hot' },
    };
    expect(() => forecastResponseSchema.parse(bad)).toThrow();
  });
});

describe('selectDailyForecast', () => {
  it('returns 8 entries starting with today', () => {
    const days = selectDailyForecast(makeFixture('2026-08-08T14:15'));
    expect(days).toHaveLength(8);
    expect(days[0]!.date).toBe('2026-08-08');
    expect(days[7]!.date).toBe('2026-08-15');
    expect(days[0]!.tempMaxC).toBe(35);
    expect(days[0]!.tempMinC).toBe(25);
    expect(days[0]!.weatherCode).toBe(2);
    expect(days[0]!.precipProbPct).toBe(30);
  });

  it('starts from the current local date, not the array start', () => {
    const days = selectDailyForecast(makeFixture('2026-08-09T02:15'));
    expect(days[0]!.date).toBe('2026-08-09');
    expect(days).toHaveLength(7);
  });

  it('respects count', () => {
    const days = selectDailyForecast(makeFixture('2026-08-08T14:15'), 3);
    expect(days.map((d) => d.date)).toEqual(['2026-08-08', '2026-08-09', '2026-08-10']);
  });

  it('skips days missing a temperature, preserving order', () => {
    const fixture = makeFixture('2026-08-08T14:15');
    fixture.daily.temperature_2m_max[1] = null;
    const days = selectDailyForecast(fixture);
    expect(days).toHaveLength(7);
    expect(days[1]!.date).toBe('2026-08-10');
  });

  it('carries a null precipitation probability through instead of skipping', () => {
    const days = selectDailyForecast(makeFixture('2026-08-08T14:15'));
    expect(days[7]!.date).toBe('2026-08-15');
    expect(days[7]!.precipProbPct).toBeNull();
  });

  it('throws when the current date is missing from the daily series', () => {
    const fixture = makeFixture('2026-08-20T14:15');
    expect(() => selectDailyForecast(fixture)).toThrow(/not found in daily series/);
  });
});

describe('selectUpcomingHours', () => {
  it('floors the 15-minute current time and steps 3-hourly', () => {
    const hours = selectUpcomingHours(makeFixture('2026-08-08T14:15'));
    expect(hours).toHaveLength(7);
    expect(hours[0]!.time).toBe('2026-08-08T17:00');
    expect(hours[1]!.time).toBe('2026-08-08T20:00');
    expect(hours[6]!.time).toBe('2026-08-09T11:00');
  });

  it('crosses midnight by walking the local-time array', () => {
    const hours = selectUpcomingHours(makeFixture('2026-08-08T22:15'));
    expect(hours.map((h) => h.time)).toEqual([
      '2026-08-09T01:00',
      '2026-08-09T04:00',
      '2026-08-09T07:00',
      '2026-08-09T10:00',
      '2026-08-09T13:00',
      '2026-08-09T16:00',
      '2026-08-09T19:00',
    ]);
  });

  it('maps is_day to a boolean per entry', () => {
    const hours = selectUpcomingHours(makeFixture('2026-08-08T14:15'));
    expect(hours[0]!.isDay).toBe(true); // 17:00
    expect(hours[1]!.isDay).toBe(false); // 20:00
  });

  it('throws when the current hour is missing from the hourly series', () => {
    const fixture = makeFixture('2026-08-10T02:15');
    expect(() => selectUpcomingHours(fixture)).toThrow(/not found in hourly series/);
  });

  it('skips entries with null data', () => {
    const fixture = makeFixture('2026-08-08T14:15');
    fixture.hourly.temperature_2m[17] = null; // 17:00 on day one
    const hours = selectUpcomingHours(fixture);
    expect(hours).toHaveLength(6);
    expect(hours[0]!.time).toBe('2026-08-08T20:00');
  });
});

describe('forecastCacheKey', () => {
  it('buckets coordinates to two decimals', () => {
    expect(forecastCacheKey(13.4567, -81.001)).toBe('13.46_-81.00');
  });
});
