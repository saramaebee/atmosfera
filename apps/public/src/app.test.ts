import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ClimateCube, ForecastNow } from '@atmosfera/climate';
import {
  type Deps,
  type Located,
  createHandler,
  createRateLimiter,
  rateKey,
  snapToCell,
} from './app';

function forecastFixture(): ForecastNow {
  const time: string[] = [];
  for (let h = 0; h < 48; h++) {
    time.push(`2026-08-0${8 + Math.floor(h / 24)}T${String(h % 24).padStart(2, '0')}:00`);
  }
  const n = (v: number) => time.map(() => v);
  return {
    latitude: 40,
    longitude: -74,
    timezone: 'America/New_York',
    current: {
      time: '2026-08-08T14:15',
      temperature_2m: 24,
      relative_humidity_2m: 60,
      is_day: 1,
      weather_code: 0,
      wind_speed_10m: 3,
      wind_direction_10m: 180,
    },
    hourly: { time, temperature_2m: n(22), weather_code: n(0), is_day: n(1) },
    daily: {
      time: ['08', '09', '10', '11', '12', '13', '14', '15'].map((d) => `2026-08-${d}`),
      weather_code: Array(8).fill(0),
      temperature_2m_max: Array(8).fill(30),
      temperature_2m_min: Array(8).fill(20),
      precipitation_probability_max: Array(8).fill(10),
    },
  };
}

const grid = (v: number) => Array.from({ length: 365 }, () => Array(24).fill(v));
const cube = {
  latitude: 40,
  longitude: -74,
  timezone: 'America/New_York',
  window: { startYear: 2011, endYear: 2025 },
  temperatureMean: grid(15),
  temperatureP10: grid(10),
  temperatureP90: grid(20),
} as unknown as ClimateCube;

const NYC: Located = { latitude: 40.7128, longitude: -74.006, name: 'New York, US' };

function makeDeps(over: Partial<Deps> = {}): Deps & { lookups: string[] } {
  const lookups: string[] = [];
  return {
    lookups,
    locate: (ip) => {
      lookups.push(ip);
      return ip === '203.0.113.9' ? NYC : null;
    },
    fetchForecast: async () => forecastFixture(),
    buildRadar: async () => ({
      gif: Buffer.from('GIF89a'),
      firstLabel: '1:00 PM',
      lastLabel: '3:00 PM',
      frameCount: 12,
    }),
    cubeReady: () => true,
    diskFreeBytes: () => 100 * 1024 ** 3,
    loadCube: async () => cube,
    ...over,
  };
}

const get = (path: string, ip: string | null = '203.0.113.9') =>
  new Request(`http://127.0.0.1:3002${path}`, ip ? { headers: { 'X-Real-IP': ip } } : {});

describe('routes', () => {
  it('serves all three routes with the pinned headers', async () => {
    const handler = createHandler(makeDeps());
    for (const [path, type] of [
      ['/now.svg', 'image/svg+xml'],
      ['/radar.gif', 'image/gif'],
      ['/climate.svg', 'image/svg+xml'],
    ]) {
      const res = await handler(get(`${path}?theme=light`));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe(type!);
      expect(res.headers.get('cache-control')).toBe('private, max-age=600');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      if (type === 'image/svg+xml') {
        expect(res.headers.get('content-security-policy')).toBe(
          "default-src 'none'; style-src 'unsafe-inline'",
        );
      }
    }
  });

  it('rejects a bad or missing theme with 400', async () => {
    const handler = createHandler(makeDeps());
    expect((await handler(get('/now.svg?theme=blue'))).status).toBe(400);
    expect((await handler(get('/now.svg'))).status).toBe(400);
  });

  it('404s unknown paths and non-GET methods', async () => {
    const handler = createHandler(makeDeps());
    expect((await handler(get('/forecast.svg?theme=dark'))).status).toBe(404);
    const post = new Request('http://127.0.0.1:3002/now.svg?theme=dark', {
      method: 'POST',
      headers: { 'X-Real-IP': '203.0.113.9' },
    });
    expect((await handler(post)).status).toBe(404);
  });

  it('404s unknown location when X-Real-IP is missing or not in the DB', async () => {
    const deps = makeDeps();
    const handler = createHandler(deps);
    const missing = await handler(get('/now.svg?theme=dark', null));
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('unknown location');
    expect(deps.lookups).toEqual([]);
    expect((await handler(get('/now.svg?theme=dark', '10.0.0.1'))).status).toBe(404);
  });

  it('ignores lat/lon/city query params: location comes only from the IP', async () => {
    const fetched: [number, number][] = [];
    const deps = makeDeps({
      fetchForecast: async (lat, lon) => {
        fetched.push([lat, lon]);
        return forecastFixture();
      },
    });
    const handler = createHandler(deps);
    const res = await handler(get('/now.svg?theme=dark&lat=1&lon=2&city=Paris'));
    expect(res.status).toBe(200);
    expect(deps.lookups).toEqual(['203.0.113.9']);
    expect(fetched).toEqual([[40.75, -74]]);
  });

  it('turns any upstream error into a generic 500', async () => {
    const handler = createHandler(
      makeDeps({
        fetchForecast: async () => {
          throw new Error('Open-Meteo forecast fetch failed for 40.75,-74');
        },
      }),
    );
    const res = await handler(get('/now.svg?theme=dark'));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('internal error');
  });

  it('cold climate cube: 503 Retry-After 60, one background build per cell', async () => {
    let ready = false;
    let builds = 0;
    const handler = createHandler(
      makeDeps({
        cubeReady: () => ready,
        loadCube: async () => {
          builds++;
          await Bun.sleep(5);
          ready = true;
          return cube;
        },
      }),
    );
    const first = handler(get('/climate.svg?theme=dark'));
    const second = handler(get('/climate.svg?theme=light'));
    const res = await first;
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('60');
    expect((await second).status).toBe(503);
    await Bun.sleep(20);
    expect(builds).toBe(1);
    expect((await handler(get('/climate.svg?theme=dark'))).status).toBe(200);
  });
});

describe('cold cube limits', () => {
  it('refuses new cubes when the disk is low', async () => {
    let builds = 0;
    const handler = createHandler(
      makeDeps({
        cubeReady: () => false,
        diskFreeBytes: () => 1024 ** 3,
        loadCube: async () => {
          builds++;
          return cube;
        },
      }),
    );
    const res = await handler(get('/climate.svg?theme=dark'));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('3600');
    expect(builds).toBe(0);
  });

  it('caps new cube builds per day', async () => {
    let builds = 0;
    const handler = createHandler(
      makeDeps({
        locate: (ip) => ({ latitude: Number(ip.split('.')[3]), longitude: 0, name: 'x' }),
        cubeReady: () => false,
        loadCube: async () => {
          builds++;
          return cube;
        },
      }),
    );
    for (let i = 1; i <= 60; i++) await handler(get('/climate.svg?theme=dark', `198.51.100.${i}`));
    await Bun.sleep(20);
    expect(builds).toBe(50);
  });
});

describe('no logging', () => {
  afterEach(() => {
    for (const s of spies) s.mockRestore();
    spies.length = 0;
  });
  const spies: { mockRestore(): void; mock: { calls: unknown[] } }[] = [];

  it('writes nothing to console, stdout or stderr on any path', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table'] as const;
    for (const m of methods) spies.push(spyOn(console, m));
    spies.push(spyOn(process.stdout, 'write'), spyOn(process.stderr, 'write'));

    const ok = createHandler(makeDeps());
    const failing = createHandler(
      makeDeps({
        fetchForecast: async () => {
          throw new Error('boom at 40.75,-74');
        },
        buildRadar: async () => {
          throw new Error('radar boom');
        },
      }),
    );
    for (const path of ['/now.svg', '/radar.gif', '/climate.svg']) {
      await ok(get(`${path}?theme=dark`));
      await failing(get(`${path}?theme=dark`));
      await ok(get(`${path}?theme=dark`, '198.51.100.1')); // unknown location
    }
    let last = new Response();
    for (let i = 0; i < 25; i++) last = await ok(get('/now.svg?theme=dark'));
    expect(last.status).toBe(429);

    for (const s of spies) expect(s.mock.calls).toEqual([]);
  });

  it('app source never references console or a logger', () => {
    const dir = import.meta.dir;
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf-8');
      expect(src).not.toContain('console.');
      expect(src).not.toMatch(/hono\/logger|@sapphire|logger/i);
    }
  });
});

describe('snapToCell', () => {
  it('rounds to the nearest 0.25 degree', () => {
    expect(snapToCell(40.7128, -74.006)).toEqual({ lat: 40.75, lon: -74 });
    expect(snapToCell(40.13, -73.87)).toEqual({ lat: 40.25, lon: -73.75 });
    expect(snapToCell(-33.8688, 151.2093)).toEqual({ lat: -33.75, lon: 151.25 });
    expect(snapToCell(0.12, -0.13)).toEqual({ lat: 0, lon: -0.25 });
  });
});

describe('createRateLimiter', () => {
  it('allows the limit, then returns a retry delay until the window resets', () => {
    const limiter = createRateLimiter(3, 1000);
    expect([0, 1, 2].map(() => limiter.hit('192.0.2.1', 0))).toEqual([0, 0, 0]);
    expect(limiter.hit('192.0.2.1', 100)).toBe(1);
    expect(limiter.hit('192.0.2.2', 100)).toBe(0);
    expect(limiter.hit('192.0.2.1', 1000)).toBe(0);
  });

  it('sweeps expired entries and never stores the raw IP', () => {
    const limiter = createRateLimiter(3, 1000);
    limiter.hit('192.0.2.1', 0);
    limiter.hit('2001:db8::1', 0);
    const dump = JSON.stringify([...limiter.entries]);
    expect(dump).not.toContain('192.0.2.1');
    expect(dump).not.toContain('2001:db8::1');
    limiter.hit('192.0.2.3', 5000);
    expect(limiter.entries.size).toBe(1);
  });
});

describe('rateKey', () => {
  it('groups IPv6 by /64 and leaves IPv4 alone', () => {
    expect(rateKey('192.0.2.1')).toBe('192.0.2.1');
    expect(rateKey('::ffff:192.0.2.1')).toBe('::ffff:192.0.2.1');
    expect(rateKey('2001:db8:1:2::1')).toBe('2001:db8:1:2');
    expect(rateKey('2001:DB8:0001:0002:aaaa::9')).toBe('2001:db8:1:2');
    expect(rateKey('2001:db8::1')).toBe('2001:db8:0:0');
    expect(rateKey('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2');
  });

  it('rate-limits a whole IPv6 /64 together', () => {
    const limiter = createRateLimiter(1, 1000);
    expect(limiter.hit('2001:db8:1:2::1', 0)).toBe(0);
    expect(limiter.hit('2001:db8:1:2::ffff', 0)).toBeGreaterThan(0);
    expect(limiter.hit('2001:db8:1:3::1', 0)).toBe(0);
  });
});
