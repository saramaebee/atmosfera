import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { HourlyYearData } from './types';

const nullableNumberArray = z.array(z.number().nullable());

const historicalResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: nullableNumberArray,
    dew_point_2m: nullableNumberArray,
    precipitation: nullableNumberArray,
    cloud_cover: nullableNumberArray,
  }),
});

const HISTORICAL_URL = 'https://archive-api.open-meteo.com/v1/archive';

export function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)}_${lon.toFixed(4)}`;
}

export function rawCachePath(lat: number, lon: number, year: number): string {
  return `.cache/raw/open-meteo/${cacheKey(lat, lon)}/${year}.json`;
}

export async function fetchHistoricalYear(
  lat: number,
  lon: number,
  year: number,
): Promise<HourlyYearData> {
  const path = rawCachePath(lat, lon, year);

  if (existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, 'utf-8'));
    const parsed = historicalResponseSchema.parse(cached);
    return parsed.hourly;
  }

  const url = new URL(HISTORICAL_URL);
  url.searchParams.set('latitude', lat.toString());
  url.searchParams.set('longitude', lon.toString());
  url.searchParams.set('start_date', `${year}-01-01`);
  url.searchParams.set('end_date', `${year}-12-31`);
  url.searchParams.set('hourly', 'temperature_2m,dew_point_2m,precipitation,cloud_cover');
  url.searchParams.set('timezone', 'auto');

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Open-Meteo historical fetch failed for ${lat},${lon} ${year}: ${res.status} ${res.statusText}`,
    );
  }
  const json = await res.json();
  const parsed = historicalResponseSchema.parse(json);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(parsed));

  return parsed.hourly;
}
