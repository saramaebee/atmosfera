import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ClimateCube } from '@atmosfera/climate';
import type { RoastOptions } from './types';

function cacheKey(opts: RoastOptions, cubes: ClimateCube[], contrast: boolean): string {
  const cubeFp = cubes
    .map((c) => `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)},${c.version}`)
    .join('|');
  const mode = contrast ? 'contrast' : 'single';
  const raw = `${mode}|${cubeFp}|${opts.tone}|${opts.culture ? '1' : '0'}|${opts.length}`;
  return createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

export function roastCachePath(
  opts: RoastOptions,
  cubes: ClimateCube[],
  contrast: boolean,
): string {
  return `.cache/roasts/${cacheKey(opts, cubes, contrast)}.txt`;
}

export function getCachedRoast(
  opts: RoastOptions,
  cubes: ClimateCube[],
  contrast: boolean,
): string | null {
  const path = roastCachePath(opts, cubes, contrast);
  if (existsSync(path)) return readFileSync(path, 'utf-8');
  return null;
}

export function putCachedRoast(
  text: string,
  opts: RoastOptions,
  cubes: ClimateCube[],
  contrast: boolean,
): void {
  const path = roastCachePath(opts, cubes, contrast);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
