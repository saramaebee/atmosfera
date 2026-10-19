import { existsSync, readFileSync } from 'node:fs';
import { buildRadarGif } from '@atmosfera/charts';
import { cubeCachePath, fetchForecastNow, loadClimateCube } from '@atmosfera/climate';
import { getEnv } from '@atmosfera/config';
import { type CityResponse, Reader } from 'mmdb-lib';
import { createHandler } from './app';

// Fixed strings only: error messages can contain coordinates or URLs.
process.on('uncaughtException', () => {
  process.stderr.write('public: uncaught exception\n');
  process.exit(1);
});
process.on('unhandledRejection', () => {
  process.stderr.write('public: unhandled rejection\n');
});

const env = getEnv();
const loadDb = () => new Reader<CityResponse>(readFileSync(env.DBIP_MMDB_PATH));
let db = loadDb();
// deploy/refresh-dbip.sh swaps the file monthly, then sends SIGHUP.
process.on('SIGHUP', () => {
  try {
    db = loadDb();
  } catch {
    // Keep serving from the previous file.
  }
});

const fetch = createHandler({
  locate(ip) {
    const r = db.get(ip);
    if (!r?.location) return null;
    const name = [r.city?.names.en, r.subdivisions?.[0]?.names.en, r.country?.names.en]
      .filter(Boolean)
      .join(', ');
    return { latitude: r.location.latitude, longitude: r.location.longitude, name };
  },
  fetchForecast: fetchForecastNow,
  buildRadar: buildRadarGif,
  cubeReady: (lat, lon) => existsSync(cubeCachePath(lat, lon)),
  loadCube: loadClimateCube,
});

Bun.serve({
  hostname: '127.0.0.1',
  port: env.PUBLIC_PORT,
  fetch,
  // Never reached (the handler catches everything), but Bun's default logs.
  error: () => new Response('internal error', { status: 500 }),
});
process.stdout.write(`public listening on 127.0.0.1:${env.PUBLIC_PORT}\n`);
