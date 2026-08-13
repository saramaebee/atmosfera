import { describe, expect, it } from 'bun:test';
import {
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
      },
      [{ time: '2026-08-08T11:00', tempC: 30, weatherCode: 1, isDay: true }],
    );
    expect(input.current.isDay).toBe(true);
    expect(input.current.humidityPct).toBe(89);
    expect(input.upcoming).toEqual([
      { timeIso: '2026-08-08T11:00', tempC: 30, weatherCode: 1, isDay: true },
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
});
