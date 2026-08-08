import { describe, expect, it } from 'bun:test';
import { weatherInfo } from './weather-codes';

describe('weatherInfo', () => {
  it('uses day/night icon variants for clear and partly cloudy', () => {
    expect(weatherInfo(0, true)).toEqual({ label: 'Clear', icon: 'sun' });
    expect(weatherInfo(0, false)).toEqual({ label: 'Clear', icon: 'moon' });
    expect(weatherInfo(1, true).icon).toBe('sun');
    expect(weatherInfo(1, false).icon).toBe('moon');
    expect(weatherInfo(2, true).icon).toBe('partly-day');
    expect(weatherInfo(2, false).icon).toBe('partly-night');
  });

  it('maps every documented WMO group', () => {
    const cases: [number, string][] = [
      [3, 'cloud'],
      [45, 'fog'],
      [48, 'fog'],
      [51, 'drizzle'],
      [53, 'drizzle'],
      [55, 'drizzle'],
      [56, 'drizzle'],
      [57, 'drizzle'],
      [61, 'rain'],
      [63, 'rain'],
      [65, 'rain'],
      [66, 'rain'],
      [67, 'rain'],
      [71, 'snow'],
      [73, 'snow'],
      [75, 'snow'],
      [77, 'snow'],
      [80, 'rain'],
      [81, 'rain'],
      [82, 'rain'],
      [85, 'snow'],
      [86, 'snow'],
      [95, 'thunder'],
      [96, 'thunder'],
      [99, 'thunder'],
    ];
    for (const [code, icon] of cases) {
      expect(weatherInfo(code, true).icon).toBe(icon as ReturnType<typeof weatherInfo>['icon']);
      expect(weatherInfo(code, false).icon).toBe(icon as ReturnType<typeof weatherInfo>['icon']);
    }
  });

  it('falls back to Cloudy for unknown codes instead of throwing', () => {
    expect(weatherInfo(42, true)).toEqual({ label: 'Cloudy', icon: 'cloud' });
    expect(weatherInfo(-1, false)).toEqual({ label: 'Cloudy', icon: 'cloud' });
  });
});
