import { afterEach, describe, expect, it } from 'bun:test';
import {
  _clearRadarCatalogCache,
  fetchRadarCatalog,
  mapWithConcurrency,
  radarTileUrl,
  weatherMapsSchema,
} from './rainviewer';

const CATALOG_FIXTURE = {
  version: '2.0',
  generated: 1786540535,
  host: 'https://tilecache.rainviewer.com',
  radar: {
    past: Array.from({ length: 12 }, (_, i) => ({
      time: 1786533000 + i * 600,
      path: `/v2/radar/frame${i}`,
    })),
    nowcast: [],
  },
  satellite: { infrared: [] },
};

describe('weatherMapsSchema', () => {
  it('parses a 12-frame catalog with empty nowcast', () => {
    const parsed = weatherMapsSchema.parse(CATALOG_FIXTURE);
    expect(parsed.radar.past).toHaveLength(12);
    expect(parsed.radar.past[0]).toEqual({ time: 1786533000, path: '/v2/radar/frame0' });
    expect(parsed.radar.nowcast).toEqual([]);
    expect(parsed.host).toBe('https://tilecache.rainviewer.com');
  });

  it('throws when radar.past is missing, so upstream drift is loud', () => {
    expect(() =>
      weatherMapsSchema.parse({
        host: 'https://tilecache.rainviewer.com',
        radar: { nowcast: [] },
      }),
    ).toThrow();
  });
});

describe('radarTileUrl', () => {
  it('builds the documented tile URL shape', () => {
    expect(radarTileUrl('https://tilecache.rainviewer.com', '/v2/radar/abc123', 7, 35, 51)).toBe(
      'https://tilecache.rainviewer.com/v2/radar/abc123/256/7/35/51/2/1_1.png',
    );
  });
});

describe('mapWithConcurrency', () => {
  it('preserves order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const results = await mapWithConcurrency(items, 4, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return n * 2;
    });
    expect(results).toEqual(items.map((n) => n * 2));
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async (n) => n)).toEqual([]);
  });
});

describe('fetchRadarCatalog', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    _clearRadarCatalogCache();
  });

  it('fetches the catalog once and serves the TTL cache after that', async () => {
    _clearRadarCatalogCache();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify(CATALOG_FIXTURE));
    }) as unknown as typeof fetch;

    const first = await fetchRadarCatalog();
    expect(first.host).toBe('https://tilecache.rainviewer.com');
    expect(first.radar.past).toHaveLength(12);
    expect(calls).toBe(1);

    // Second call inside the TTL returns the identical cached object.
    const second = await fetchRadarCatalog();
    expect(second).toBe(first);
    expect(calls).toBe(1);
  });
});
