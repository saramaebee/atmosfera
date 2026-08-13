import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { _setBasemapCacheRoot, basemapTilePath, cartoTileUrl, fetchBasemapTile } from './basemap';

describe('cartoTileUrl', () => {
  it('spreads tiles across subdomains deterministically', () => {
    expect(cartoTileUrl(7, 34, 51)).toBe('https://b.basemaps.cartocdn.com/light_all/7/34/51.png');
    expect(cartoTileUrl(7, 35, 51)).toBe('https://c.basemaps.cartocdn.com/light_all/7/35/51.png');
  });

  it('rotates to the next subdomain on retry attempts', () => {
    expect(cartoTileUrl(7, 34, 51, 'light', 1)).toBe(
      'https://c.basemaps.cartocdn.com/light_all/7/34/51.png',
    );
    expect(cartoTileUrl(7, 34, 51, 'light', 3)).toBe(
      'https://a.basemaps.cartocdn.com/light_all/7/34/51.png',
    );
  });

  it('serves the CARTO dark layers for the dark theme', () => {
    // dark_nolabels + dark_only_labels, not dark_all — the baked-in labels
    // are too dim, so the renderer composites a boosted labels layer.
    expect(cartoTileUrl(7, 34, 51, 'dark')).toBe(
      'https://b.basemaps.cartocdn.com/dark_nolabels/7/34/51.png',
    );
    expect(cartoTileUrl(7, 34, 51, 'dark-labels')).toBe(
      'https://b.basemaps.cartocdn.com/dark_only_labels/7/34/51.png',
    );
  });
});

describe('basemapTilePath', () => {
  it('keys the FS cache by z/x/y under a stable absolute root', () => {
    const path = basemapTilePath(7, 34, 51);
    expect(isAbsolute(path)).toBe(true);
    expect(path.endsWith(join('.cache', 'tiles', 'carto-light', '7', '34', '51.png'))).toBe(true);
  });

  it('partitions styles into separate directories', () => {
    const dark = basemapTilePath(7, 34, 51, 'dark');
    expect(dark.endsWith(join('.cache', 'tiles', 'carto-dark-nolabels', '7', '34', '51.png'))).toBe(
      true,
    );
    const labels = basemapTilePath(7, 34, 51, 'dark-labels');
    expect(labels.endsWith(join('.cache', 'tiles', 'carto-dark-labels', '7', '34', '51.png'))).toBe(
      true,
    );
  });
});

describe('fetchBasemapTile', () => {
  const realFetch = globalThis.fetch;
  const png = Buffer.from('fake-png-bytes');
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'atmosfera-basemap-'));
    _setBasemapCacheRoot(tmpRoot);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    _setBasemapCacheRoot();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('downloads the tile, writes the FS cache, and serves the cache after that', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(png);
    }) as unknown as typeof fetch;

    const data = await fetchBasemapTile(7, 34, 51);
    expect(data.equals(png)).toBe(true);
    expect(calls).toBe(1);
    expect(readFileSync(basemapTilePath(7, 34, 51)).equals(png)).toBe(true);

    const again = await fetchBasemapTile(7, 34, 51);
    expect(again.equals(png)).toBe(true);
    expect(calls).toBe(1);
  });

  it('returns the tile even when the cache write fails', async () => {
    // A regular file where a directory should be makes mkdirSync throw.
    const blocker = join(tmpRoot, 'blocker');
    writeFileSync(blocker, 'not a directory');
    _setBasemapCacheRoot(join(blocker, 'nested'));

    globalThis.fetch = (async () => new Response(png)) as unknown as typeof fetch;

    const data = await fetchBasemapTile(7, 34, 51);
    expect(data.equals(png)).toBe(true);
  });

  it('does not retry once the caller signal has aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    let calls = 0;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      calls++;
      if (init?.signal?.aborted) throw new Error('The operation was aborted.');
      return new Response(png);
    }) as typeof fetch;

    await expect(fetchBasemapTile(7, 34, 51, 'light', controller.signal)).rejects.toThrow(
      'aborted',
    );
    expect(calls).toBe(1);
  });
});
