import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { aggregateCube } from './aggregate';
import { cacheKey, fetchHistoricalYear } from './openmeteo';
import {
  CLIMATOLOGY_END_YEAR,
  CLIMATOLOGY_START_YEAR,
  CUBE_VERSION,
  type ClimateCube,
  type HourlyYearData,
} from './types';

export function cubeCachePath(lat: number, lon: number): string {
  return `.cache/cubes/${cacheKey(lat, lon)}/cube-${CUBE_VERSION}.json`;
}

export interface LoadCubeOptions {
  latitude: number;
  longitude: number;
  timezone: string;
  startYear?: number;
  endYear?: number;
  onProgress?: (msg: string) => void;
}

export async function loadClimateCube(opts: LoadCubeOptions): Promise<ClimateCube> {
  const path = cubeCachePath(opts.latitude, opts.longitude);

  if (existsSync(path)) {
    opts.onProgress?.(`cube cache hit: ${path}`);
    return JSON.parse(readFileSync(path, 'utf-8')) as ClimateCube;
  }

  const startYear = opts.startYear ?? CLIMATOLOGY_START_YEAR;
  const endYear = opts.endYear ?? CLIMATOLOGY_END_YEAR;

  opts.onProgress?.(
    `building cube for ${opts.latitude},${opts.longitude} (${startYear}-${endYear})`,
  );

  const years: HourlyYearData[] = [];
  for (let year = startYear; year <= endYear; year++) {
    opts.onProgress?.(`  loading ${year}…`);
    const data = await fetchHistoricalYear(opts.latitude, opts.longitude, year);
    years.push(data);
  }

  const cube = aggregateCube(years, {
    latitude: opts.latitude,
    longitude: opts.longitude,
    timezone: opts.timezone,
    startYear,
    endYear,
  });

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cube));
  opts.onProgress?.(`cube written: ${path}`);

  return cube;
}
