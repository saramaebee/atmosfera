import { z } from 'zod';
import { fetchTileBuffer } from './tilefetch';

/**
 * RainViewer public weather-maps API (https://www.rainviewer.com/api.html).
 * No key; free for personal/small-community use, attribution requested.
 * Frame paths are opaque content hashes — tile URLs cannot be constructed
 * from timestamps, so every render starts from the catalog.
 */

const frameSchema = z.object({ time: z.number(), path: z.string() });

export const weatherMapsSchema = z.object({
  host: z.string(),
  radar: z.object({
    // Required on purpose: if RainViewer renames or moves these arrays, the
    // parse should throw loudly (the bot logs it) rather than masquerade as
    // an empty catalog and report "radar unavailable" forever.
    past: z.array(frameSchema),
    nowcast: z.array(frameSchema),
  }),
});

export type RadarCatalog = z.infer<typeof weatherMapsSchema>;
export type RadarFrame = z.infer<typeof frameSchema>;

const CATALOG_URL = 'https://api.rainviewer.com/public/weather-maps.json';

// The catalog regenerates upstream every ~5 minutes; a fresh frame every ~10.
const CATALOG_TTL_MS = 3 * 60 * 1000;
let catalogCache: { data: RadarCatalog; expiresAt: number } | null = null;

export function _clearRadarCatalogCache(): void {
  catalogCache = null;
}

export async function fetchRadarCatalog(): Promise<RadarCatalog> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.data;

  const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`RainViewer catalog fetch failed: ${res.status} ${res.statusText}`);
  }
  const parsed = weatherMapsSchema.parse(await res.json());

  catalogCache = { data: parsed, expiresAt: Date.now() + CATALOG_TTL_MS };
  return parsed;
}

/** Color scheme 2 = "Universal Blue"; options = smooth blur on, snow shown. */
export const RADAR_COLOR_SCHEME = 2;
export const RADAR_OPTIONS = '1_1';

export function radarTileUrl(host: string, path: string, z: number, x: number, y: number): string {
  return `${host}${path}/256/${z}/${x}/${y}/${RADAR_COLOR_SCHEME}/${RADAR_OPTIONS}.png`;
}

// Frame paths are content-hashed, so tiles are immutable — but frames age out
// of the catalog within 2 hours, so a short TTL with a size cap is plenty.
const TILE_TTL_MS = 30 * 60 * 1000;
const TILE_CACHE_MAX = 600;
const tileCache = new Map<string, { data: Buffer; expiresAt: number }>();

export function _clearRadarTileCache(): void {
  tileCache.clear();
}

export async function fetchRadarTile(
  host: string,
  path: string,
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const url = radarTileUrl(host, path, z, x, y);
  const hit = tileCache.get(url);
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  let data: Buffer;
  try {
    data = await fetchTileBuffer(url, signal);
  } catch (err) {
    // Caller gave up — retrying can't succeed, so surface the abort now.
    if (signal?.aborted) throw err;
    // Single host — nothing to rotate to; a beat of delay outlives most
    // transient DNS/socket hiccups.
    await new Promise((r) => setTimeout(r, 250));
    data = await fetchTileBuffer(url, signal);
  }

  if (tileCache.size >= TILE_CACHE_MAX) {
    // Map iterates in insertion order — evict the oldest entry.
    const oldest = tileCache.keys().next().value;
    if (oldest !== undefined) tileCache.delete(oldest);
  }
  tileCache.set(url, { data, expiresAt: Date.now() + TILE_TTL_MS });
  return data;
}

/** Run `fn` over `items` with at most `limit` in flight at once. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}
