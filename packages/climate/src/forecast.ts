import { z } from 'zod';

const nullableNumberArray = z.array(z.number().nullable());

export const forecastResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  current: z.object({
    time: z.string(),
    temperature_2m: z.number(),
    relative_humidity_2m: z.number(),
    is_day: z.number(),
    weather_code: z.number(),
    wind_speed_10m: z.number(),
    wind_direction_10m: z.number(),
  }),
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: nullableNumberArray,
    weather_code: nullableNumberArray,
    is_day: nullableNumberArray,
  }),
  daily: z.object({
    time: z.array(z.string()),
    weather_code: nullableNumberArray,
    temperature_2m_max: nullableNumberArray,
    temperature_2m_min: nullableNumberArray,
    precipitation_probability_max: nullableNumberArray,
  }),
});

export type ForecastNow = z.infer<typeof forecastResponseSchema>;

export interface UpcomingHour {
  /** Local ISO timestamp, e.g. "2026-08-08T17:00". */
  time: string;
  tempC: number;
  weatherCode: number;
  isDay: boolean;
}

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// Unlike the historical archive (immutable, cached forever on disk in
// openmeteo.ts), a forecast goes stale in minutes — so this is a small
// in-memory TTL cache instead of a file cache.
const FORECAST_TTL_MS = 10 * 60 * 1000;
const forecastCache = new Map<string, { data: ForecastNow; expiresAt: number }>();

export function forecastCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)}_${lon.toFixed(2)}`;
}

export function _clearForecastCache(): void {
  forecastCache.clear();
}

export async function fetchForecastNow(lat: number, lon: number): Promise<ForecastNow> {
  const key = forecastCacheKey(lat, lon);
  const hit = forecastCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  const url = new URL(FORECAST_URL);
  url.searchParams.set('latitude', lat.toString());
  url.searchParams.set('longitude', lon.toString());
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,is_day,weather_code,wind_speed_10m,wind_direction_10m',
  );
  url.searchParams.set('hourly', 'temperature_2m,weather_code,is_day');
  url.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  );
  // Eight days: covers the daily strip, and far more hourly than the
  // current hour + 21h the hourly strip needs.
  url.searchParams.set('forecast_days', '8');
  url.searchParams.set('timezone', 'auto');

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Open-Meteo forecast fetch failed for ${lat},${lon}: ${res.status} ${res.statusText}`,
    );
  }
  const json = await res.json();
  const parsed = forecastResponseSchema.parse(json);

  forecastCache.set(key, { data: parsed, expiresAt: Date.now() + FORECAST_TTL_MS });
  return parsed;
}

/**
 * Pick the upcoming strip entries: every `stepHours` hours after the current
 * hour, `count` entries. All timestamps are city-local strings (timezone=auto),
 * so crossing midnight is just walking the hourly array — no timezone math.
 */
export function selectUpcomingHours(
  forecast: ForecastNow,
  stepHours = 3,
  count = 7,
): UpcomingHour[] {
  // current.time has 15-minute granularity ("…T14:15") — floor to the hour.
  const flooredIso = `${forecast.current.time.slice(0, 13)}:00`;
  const idx = forecast.hourly.time.indexOf(flooredIso);
  if (idx === -1) {
    throw new Error(
      `Forecast current time ${flooredIso} not found in hourly series (${forecast.hourly.time.length} entries)`,
    );
  }

  const out: UpcomingHour[] = [];
  for (let i = 1; i <= count; i++) {
    const j = idx + i * stepHours;
    if (j >= forecast.hourly.time.length) break;
    const tempC = forecast.hourly.temperature_2m[j];
    const weatherCode = forecast.hourly.weather_code[j];
    const isDay = forecast.hourly.is_day[j];
    if (tempC == null || weatherCode == null || isDay == null) continue;
    out.push({ time: forecast.hourly.time[j]!, tempC, weatherCode, isDay: isDay === 1 });
  }
  return out;
}

export interface DailyEntry {
  /** Local date, e.g. "2026-08-13". */
  date: string;
  weatherCode: number;
  tempMaxC: number;
  tempMinC: number;
  /** Null when the provider has no probability for that day. */
  precipProbPct: number | null;
}

/**
 * Pick the daily strip entries starting with today (city-local), `count` days.
 * Days missing a code or temperature are skipped; a missing precipitation
 * probability is carried through as null so the day still renders.
 */
export function selectDailyForecast(forecast: ForecastNow, count = 8): DailyEntry[] {
  const today = forecast.current.time.slice(0, 10);
  const idx = forecast.daily.time.indexOf(today);
  if (idx === -1) {
    throw new Error(
      `Forecast current date ${today} not found in daily series (${forecast.daily.time.length} entries)`,
    );
  }

  const out: DailyEntry[] = [];
  for (let i = 0; i < count; i++) {
    const j = idx + i;
    if (j >= forecast.daily.time.length) break;
    const weatherCode = forecast.daily.weather_code[j];
    const tempMaxC = forecast.daily.temperature_2m_max[j];
    const tempMinC = forecast.daily.temperature_2m_min[j];
    if (weatherCode == null || tempMaxC == null || tempMinC == null) continue;
    out.push({
      date: forecast.daily.time[j]!,
      weatherCode,
      tempMaxC,
      tempMinC,
      precipProbPct: forecast.daily.precipitation_probability_max[j] ?? null,
    });
  }
  return out;
}
