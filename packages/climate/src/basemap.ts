import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTileBuffer } from './tilefetch';

/**
 * CARTO Positron basemap tiles (© OpenStreetMap contributors © CARTO).
 * Free for hobby/non-commercial use with attribution, which the radar
 * renderer draws into every frame.
 */

const SUBDOMAINS = ['a', 'b', 'c', 'd'] as const;

export function cartoTileUrl(z: number, x: number, y: number, attempt = 0): string {
  // Deterministic subdomain spread keeps repeat requests cache-friendly;
  // retries rotate to the next subdomain in case one is having a bad moment.
  const sub = SUBDOMAINS[(x + y + attempt) % SUBDOMAINS.length];
  return `https://${sub}.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`;
}

// Resolve the cache against the repo root so the bot can be launched from any
// cwd, mirroring the DB-path resolution in apps/discord-bot/src/index.ts.
// packages/climate/src → repo root is three levels up.
const DEFAULT_CACHE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '.cache',
  'tiles',
  'carto-light',
);

let cacheRoot = DEFAULT_CACHE_ROOT;

/** Test hook: redirect the tile cache (pass undefined to restore the default). */
export function _setBasemapCacheRoot(root?: string): void {
  cacheRoot = root ?? DEFAULT_CACHE_ROOT;
}

export function basemapTilePath(z: number, x: number, y: number): string {
  return join(cacheRoot, String(z), String(x), `${y}.png`);
}

const FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;

/**
 * Read-through FS cache like openmeteo.ts's raw archive: basemap tiles at
 * z ≤ 7 are effectively immutable, so cache them forever.
 */
export async function fetchBasemapTile(
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const path = basemapTilePath(z, x, y);
  if (existsSync(path)) return readFileSync(path);

  let data: Buffer | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    try {
      data = await fetchTileBuffer(cartoTileUrl(z, x, y, attempt), signal);
      break;
    } catch (err) {
      // Caller gave up — retrying can't succeed, so surface the abort now.
      if (signal?.aborted) throw err;
      lastError = err;
    }
  }
  if (!data) throw lastError;

  try {
    mkdirSync(dirname(path), { recursive: true });
    // Write-then-rename so a crash mid-write can't leave a truncated PNG that
    // the existsSync fast path would trust forever.
    const tmpPath = `${path}.tmp-${process.pid}`;
    writeFileSync(tmpPath, data);
    renameSync(tmpPath, path);
  } catch {
    // The cache is an optimization — a read-only or full disk shouldn't fail
    // the request when the tile is already in hand.
  }
  return data;
}
