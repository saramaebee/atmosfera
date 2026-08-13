import { describe, expect, it } from 'bun:test';
import {
  type NowCardDayEntry,
  type NowCardInput,
  compassPoint,
  hourLabel,
  nowCardInputFromForecast,
  renderNowCardSvg,
} from './nowcard';
import { svgToPng } from './raster';
import { DARK_THEME, LIGHT_THEME } from './theme';

const fixture: NowCardInput = {
  cityName: "Coeur d'Alene, Idaho, United States",
  current: {
    timeIso: '2026-08-08T14:15',
    tempC: 24.3,
    weatherCode: 0,
    isDay: true,
    humidityPct: 62,
    windSpeedKmh: 14.2,
    windDirectionDeg: 45,
  },
  upcoming: [17, 20, 23, 2, 5, 8, 11].map((hour, i) => ({
    timeIso: `2026-08-0${hour < 17 ? 9 : 8}T${String(hour).padStart(2, '0')}:00`,
    tempC: 30 - i,
    weatherCode: i === 3 ? 61 : 2,
    isDay: hour >= 6 && hour < 20,
  })),
};

// 2026-08-08 is a Saturday; the strip runs Today (Sat) through the next Sat.
const dailyFixture: NowCardDayEntry[] = ['08', '09', '10', '11', '12', '13', '14', '15'].map(
  (day, i) => ({
    dateIso: `2026-08-${day}`,
    weatherCode: i === 2 ? 61 : 2,
    tempMaxC: 35 + (i % 3),
    tempMinC: 25 + (i % 2),
    precipProbPct: i === 2 ? 45 : i === 3 ? 0 : i === 7 ? null : 10,
  }),
);

const fixtureWithDaily: NowCardInput = { ...fixture, daily: dailyFixture };

describe('compassPoint', () => {
  it('maps the cardinal and intercardinal directions', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(45)).toBe('NE');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(270)).toBe('W');
  });

  it('handles boundaries and normalization', () => {
    expect(compassPoint(350)).toBe('N');
    expect(compassPoint(337.5)).toBe('NNW');
    expect(compassPoint(-90)).toBe('W');
    expect(compassPoint(450)).toBe('E');
  });
});

describe('hourLabel', () => {
  it('formats 12-hour labels', () => {
    expect(hourLabel('2026-08-08T00:00')).toBe('12 AM');
    expect(hourLabel('2026-08-08T05:00')).toBe('5 AM');
    expect(hourLabel('2026-08-08T12:00')).toBe('12 PM');
    expect(hourLabel('2026-08-08T13:00')).toBe('1 PM');
    expect(hourLabel('2026-08-08T23:00')).toBe('11 PM');
  });
});

describe('nowCardInputFromForecast', () => {
  it('maps the forecast payload into card input', () => {
    const input = nowCardInputFromForecast(
      'Columbia, South Carolina, United States',
      {
        latitude: 34,
        longitude: -81,
        timezone: 'America/New_York',
        current: {
          time: '2026-08-08T08:15',
          temperature_2m: 24,
          relative_humidity_2m: 89,
          is_day: 1,
          weather_code: 0,
          wind_speed_10m: 3,
          wind_direction_10m: 180,
        },
        hourly: { time: [], temperature_2m: [], weather_code: [], is_day: [] },
        daily: {
          time: [],
          weather_code: [],
          temperature_2m_max: [],
          temperature_2m_min: [],
          precipitation_probability_max: [],
        },
      },
      [{ time: '2026-08-08T11:00', tempC: 30, weatherCode: 1, isDay: true }],
    );
    expect(input.current.isDay).toBe(true);
    expect(input.current.humidityPct).toBe(89);
    expect(input.upcoming).toEqual([
      { timeIso: '2026-08-08T11:00', tempC: 30, weatherCode: 1, isDay: true },
    ]);
    expect(input.daily).toBeUndefined();
  });

  it('maps daily entries when provided', () => {
    const input = nowCardInputFromForecast(
      'Columbia, South Carolina, United States',
      {
        latitude: 34,
        longitude: -81,
        timezone: 'America/New_York',
        current: {
          time: '2026-08-08T08:15',
          temperature_2m: 24,
          relative_humidity_2m: 89,
          is_day: 1,
          weather_code: 0,
          wind_speed_10m: 3,
          wind_direction_10m: 180,
        },
        hourly: { time: [], temperature_2m: [], weather_code: [], is_day: [] },
        daily: {
          time: ['2026-08-08'],
          weather_code: [61],
          temperature_2m_max: [35],
          temperature_2m_min: [25],
          precipitation_probability_max: [80],
        },
      },
      [],
      [{ date: '2026-08-08', weatherCode: 61, tempMaxC: 35, tempMinC: 25, precipProbPct: 80 }],
    );
    expect(input.daily).toEqual([
      { dateIso: '2026-08-08', weatherCode: 61, tempMaxC: 35, tempMinC: 25, precipProbPct: 80 },
    ]);
  });
});

describe('renderNowCardSvg', () => {
  const svg = renderNowCardSvg(fixture);

  it('renders header, hero, strip, and footer content', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Coeur d&apos;Alene');
    expect(svg).toContain('>24°C</tspan>');
    expect(svg).toContain('/ 76°F</tspan>');
    expect(svg).toContain('Clear');
    expect(svg).toContain('Saturday · 2 PM');
    expect(svg).toContain('Humidity 62%');
    expect(svg).toContain('Wind 14 km/h NE');
    // 7 hourly columns, each with a bold °-only temp label (dark theme text).
    expect(
      svg.match(
        new RegExp(`font-weight="700" fill="${DARK_THEME.text}" text-anchor="middle"`, 'g'),
      ),
    ).toHaveLength(7);
  });

  it('rasterizes without throwing', () => {
    expect(() => svgToPng(svg)).not.toThrow();
  });

  it('renders dark by default and light on request', () => {
    expect(svg).toContain(`fill="${DARK_THEME.bg}"`);
    const light = renderNowCardSvg(fixture, LIGHT_THEME);
    expect(light).toContain(`fill="${LIGHT_THEME.bg}"`);
    expect(light).not.toBe(svg);
  });

  it('keeps the compact 448px layout when there is no daily strip', () => {
    expect(svg).toContain('height="448"');
    expect(svg).not.toContain('>Today<');
  });
});

describe('renderNowCardSvg daily strip', () => {
  const svg = renderNowCardSvg(fixtureWithDaily);

  it('renders a taller card with one column per day', () => {
    expect(svg).toContain('height="624"');
    expect(svg).toContain('>Today<');
    expect(svg).toContain('>Sun<');
    expect(svg).toContain('>Fri<');
    // 8 daily columns, each with a bold high-temp tspan.
    expect(svg.match(/font-size="18" font-weight="700"/g)).toHaveLength(8);
  });

  it('renders dual-unit highs and lows', () => {
    // Day 0: max 35°C / min 25°C → 95°F / 77°F.
    expect(svg).toContain('>35°</tspan>');
    expect(svg).toContain('>25°</tspan>');
    expect(svg).toContain('>95° 77°F</text>');
  });

  it('shows precip chance only when known and non-zero', () => {
    expect(svg).toContain(`fill="${DARK_THEME.precip}"`);
    expect(svg).toContain('>45%</text>');
    expect(svg).not.toContain('>0%</text>');
    // Days 2 (45%), plus the 10% days — day 3 (0%) and day 7 (null) render none.
    expect(svg.match(new RegExp(`fill="${DARK_THEME.precip}"`, 'g'))).toHaveLength(6);
  });

  it('uses the light precip token on the light theme', () => {
    const light = renderNowCardSvg(fixtureWithDaily, LIGHT_THEME);
    expect(light).toContain(`fill="${LIGHT_THEME.precip}"`);
  });

  it('rasterizes without throwing', () => {
    expect(() => svgToPng(svg)).not.toThrow();
  });
});
