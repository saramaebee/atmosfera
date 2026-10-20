import { createHash, randomBytes } from 'node:crypto';
import {
  type RadarPlace,
  type ThemeName,
  type buildRadarGif,
  nowCardInputFromForecast,
  renderNowCardSvg,
  renderTemperatureComparisonSvg,
  resolveTheme,
} from '@atmosfera/charts';
import {
  type ForecastNow,
  type loadClimateCube,
  selectDailyForecast,
  selectUpcomingHours,
} from '@atmosfera/climate';

/** A raw DB-IP hit. Snapped to a cell before anything else sees it. */
export interface Located {
  latitude: number;
  longitude: number;
  name: string;
}

/** Everything that touches the outside world, so tests can swap it out. */
export interface Deps {
  locate: (ip: string) => Located | null;
  fetchForecast: (lat: number, lon: number) => Promise<ForecastNow>;
  buildRadar: typeof buildRadarGif;
  cubeReady: (lat: number, lon: number) => boolean;
  diskFreeBytes: () => number;
  loadCube: typeof loadClimateCube;
}

const CELL_DEG = 0.25;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const RADAR_MAX_QUEUE = 3;
const CUBE_MAX_QUEUE = 20;
// A cold cube is ~15 archive calls and ~8 MB of disk. Visitors pick the cell,
// so cap new ones to protect the Open-Meteo quota and the bot's disk.
const CUBE_DAILY_CAP = 50;
const CUBE_MIN_FREE_BYTES = 5 * 1024 ** 3;

/** ~25 km cell; the only location granularity used past the lookup. */
export function snapToCell(lat: number, lon: number): { lat: number; lon: number } {
  return { lat: Math.round(lat / CELL_DEG) * CELL_DEG, lon: Math.round(lon / CELL_DEG) * CELL_DEG };
}

/** IPv6 hosts get a whole /64, so limit the /64 rather than one address. */
export function rateKey(ip: string): string {
  if (!ip.includes(':') || ip.includes('.')) return ip;
  const [head, tail] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':');
}

/**
 * Fixed-window per-IP limiter. Keys are salted hashes (salt random per
 * process), so the map never holds a raw IP.
 */
export function createRateLimiter(limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS) {
  const salt = randomBytes(32);
  const entries = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = 0;
  return {
    entries,
    /** Seconds until the caller may retry, or 0 when allowed. */
    hit(ip: string, now = Date.now()): number {
      if (now - lastSweep > windowMs) {
        for (const [k, e] of entries) if (e.resetAt <= now) entries.delete(k);
        lastSweep = now;
      }
      const key = createHash('sha256').update(salt).update(rateKey(ip)).digest('base64url');
      let e = entries.get(key);
      if (!e || e.resetAt <= now) {
        e = { count: 0, resetAt: now + windowMs };
        entries.set(key, e);
      }
      e.count++;
      return e.count > limit ? Math.ceil((e.resetAt - now) / 1000) : 0;
    },
  };
}

/** Global concurrency 1 with a bounded queue; null means the queue is full. */
function serial(maxQueue: number) {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return <T>(fn: () => Promise<T>): Promise<T> | null => {
    if (pending >= maxQueue) return null;
    pending++;
    const run = tail.then(fn).finally(() => pending--);
    tail = run.catch(() => {});
    return run;
  };
}

interface Result {
  status: number;
  body: string | Uint8Array;
  type?: string;
  retryAfter?: number;
}

const ROUTES = {
  '/now.svg': 'image/svg+xml',
  '/radar.gif': 'image/gif',
  '/climate.svg': 'image/svg+xml',
} as const;
type Route = keyof typeof ROUTES;

const text = (status: number, body: string, retryAfter?: number): Result => ({
  status,
  body,
  retryAfter,
});

function respond(r: Result): Response {
  const headers: Record<string, string> = {
    'Content-Type': r.type ?? 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': r.status === 200 ? 'private, max-age=600' : 'no-store',
  };
  if (r.type === 'image/svg+xml') {
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'";
  }
  if (r.retryAfter) headers['Retry-After'] = String(r.retryAfter);
  return new Response(r.body, { status: r.status, headers });
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const limiter = createRateLimiter();
  const cache = new Map<string, { result: Result; expiresAt: number; bytes: number }>();
  let cacheBytes = 0;
  const inFlight = new Map<string, Promise<Result>>();
  const radarQueue = serial(RADAR_MAX_QUEUE);
  const cubeQueue = serial(CUBE_MAX_QUEUE);
  const cubeBuilds = new Set<string>();
  let cubeDay = '';
  let cubesToday = 0;

  function cacheGet(key: string): Result | null {
    const hit = cache.get(key);
    if (!hit) return null;
    cache.delete(key);
    if (hit.expiresAt <= Date.now()) {
      cacheBytes -= hit.bytes;
      return null;
    }
    cache.set(key, hit); // re-insert: Map order doubles as LRU order
    return hit.result;
  }

  function cachePut(key: string, result: Result): void {
    const bytes = result.body.length;
    cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS, bytes });
    cacheBytes += bytes;
    for (const [k, e] of cache) {
      if (cacheBytes <= CACHE_MAX_BYTES) break;
      cache.delete(k);
      cacheBytes -= e.bytes;
    }
  }

  async function produce(route: Route, cell: Located, theme: ThemeName): Promise<Result> {
    const chartTheme = resolveTheme(theme);
    // timezone=auto: the forecast is also how we learn the cell's timezone.
    const forecast = await deps.fetchForecast(cell.latitude, cell.longitude);

    if (route === '/now.svg') {
      const input = nowCardInputFromForecast(
        cell.name,
        forecast,
        selectUpcomingHours(forecast),
        selectDailyForecast(forecast),
      );
      return { status: 200, body: renderNowCardSvg(input, chartTheme), type: ROUTES[route] };
    }

    if (route === '/radar.gif') {
      const place: RadarPlace = { ...cell, timezone: forecast.timezone };
      const run = radarQueue(() => deps.buildRadar(place, 'past', chartTheme));
      if (!run) return text(503, 'busy', 30);
      const radar = await run;
      if (!radar) return text(503, 'radar unavailable', 60);
      return { status: 200, body: radar.gif, type: ROUTES[route] };
    }

    const cubeOpts = {
      latitude: cell.latitude,
      longitude: cell.longitude,
      timezone: forecast.timezone,
    };
    if (!deps.cubeReady(cell.latitude, cell.longitude)) {
      // Cold miss is ~15 sequential archive fetches: build in the background
      // and let the client retry rather than hold the request open.
      const cellKey = `${cell.latitude},${cell.longitude}`;
      const today = new Date().toISOString().slice(0, 10);
      if (today !== cubeDay) {
        cubeDay = today;
        cubesToday = 0;
      }
      if (cubesToday >= CUBE_DAILY_CAP || deps.diskFreeBytes() < CUBE_MIN_FREE_BYTES) {
        return text(503, 'busy', 3600);
      }
      if (!cubeBuilds.has(cellKey)) {
        const run = cubeQueue(() => deps.loadCube(cubeOpts));
        if (run) {
          cubeBuilds.add(cellKey);
          cubesToday++;
          run.catch(() => {}).finally(() => cubeBuilds.delete(cellKey));
        }
      }
      return text(503, 'building', 60);
    }
    const cube = await deps.loadCube(cubeOpts);
    const svg = renderTemperatureComparisonSvg([{ name: cell.name, cube }], chartTheme);
    return { status: 200, body: svg, type: ROUTES[route] };
  }

  async function handle(req: Request): Promise<Result> {
    const ip = req.headers.get('x-real-ip');
    if (ip) {
      const retryAfter = limiter.hit(ip);
      if (retryAfter) return text(429, 'too many requests', retryAfter);
    }

    const url = new URL(req.url);
    if (req.method !== 'GET' || !(url.pathname in ROUTES)) return text(404, 'not found');
    const route = url.pathname as Route;

    const theme = url.searchParams.get('theme');
    if (theme !== 'light' && theme !== 'dark') return text(400, 'bad theme');

    let located: Located | null = null;
    try {
      located = ip ? deps.locate(ip) : null;
    } catch {}
    if (!located) return text(404, 'unknown location');
    const { lat, lon } = snapToCell(located.latitude, located.longitude);
    const cell: Located = { latitude: lat, longitude: lon, name: located.name };

    const key = `${route}|${lat},${lon}|${theme}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    let pending = inFlight.get(key);
    if (!pending) {
      pending = produce(route, cell, theme).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    const result = await pending;
    if (result.status === 200 && !cache.has(key)) cachePut(key, result);
    return result;
  }

  return async (req) => {
    try {
      return respond(await handle(req));
    } catch {
      // Deliberately silent: error messages can carry coordinates.
      return respond(text(500, 'internal error'));
    }
  };
}
