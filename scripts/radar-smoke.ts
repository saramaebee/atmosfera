import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { dbPathFromUrl, getEnv } from '@atmosfera/config';
import { createDb, migrateDb } from '@atmosfera/db';
import { formatCandidate, resolveCity } from '@atmosfera/geocode';
import { buildRadarGif } from '../apps/discord-bot/src/lib/charts';

interface Args {
  city: string;
  out: string | undefined;
}

function parseArgs(argv: string[]): Args {
  let city: string | undefined;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--out') {
      out = argv[++i];
    } else if (a.startsWith('--')) {
      throw new Error(`Unknown flag: ${a}`);
    } else if (city === undefined) {
      city = a;
    } else {
      throw new Error('radar-smoke renders a single city.');
    }
  }

  if (!city) throw new Error('usage: bun run radar <city> [--out path.gif]');
  return { city, out };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = getEnv();

  const dbPath = dbPathFromUrl(env.DATABASE_URL);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = createDb(dbPath);
  migrateDb(db);

  const t0 = performance.now();

  process.stderr.write(`resolving "${args.city}"…\n`);
  const result = await resolveCity(db, args.city);

  if (result.kind === 'none') {
    throw new Error(
      `No geocoding matches for "${args.city}". Try adding a qualifier, e.g. "${args.city}, France".`,
    );
  }
  if (result.kind === 'ambiguous') {
    process.stderr.write(`\nAmbiguous "${args.city}" — multiple candidates:\n`);
    for (const c of result.candidates) {
      const pop = c.population !== null ? `pop ${c.population.toLocaleString()}` : 'pop ?';
      process.stderr.write(`  • ${formatCandidate(c)}  (${pop})\n`);
    }
    const top = result.candidates[0]!;
    process.stderr.write(
      `\nRe-run with a qualifier, e.g. "${args.city}, ${top.region ?? top.country}".\n`,
    );
    process.exit(2);
  }

  const city = result.city;
  process.stderr.write(
    `  → ${city.canonicalName} (${city.latitude.toFixed(4)}, ${city.longitude.toFixed(4)}, tz=${city.timezone})  [${result.via}]\n`,
  );

  const radar = await buildRadarGif(city);
  if (!radar) {
    throw new Error('RainViewer returned no usable frames (upstream outage?). Try again later.');
  }

  const outPath = args.out ?? `out/radar-${slugify(city.canonicalName)}.gif`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, radar.gif);

  const seconds = ((performance.now() - t0) / 1000).toFixed(2);
  process.stderr.write(
    `\nwrote ${outPath} — ${radar.frameCount} frames, ${radar.firstLabel}–${radar.lastLabel} local, ` +
      `${(radar.gif.length / 1024 / 1024).toFixed(2)} MB, in ${seconds}s\n`,
  );
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`radar-smoke failed: ${msg}`);
  process.exit(1);
});
