import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  type CitySeries,
  compareCubesCanonical,
  renderChartCached,
  renderMuggyComparisonSvg,
  renderTemperatureComparisonSvg,
  renderWetDayComparisonSvg,
} from '@atmosfera/charts';
import { loadClimateCube } from '@atmosfera/climate';
import { dbPathFromUrl, getEnv } from '@atmosfera/config';
import { createDb, migrateDb } from '@atmosfera/db';
import { formatCandidate, resolveCity } from '@atmosfera/geocode';

type ChartKind = 'muggy' | 'heatmap' | 'wetday';
const CHART_KINDS: ChartKind[] = ['muggy', 'heatmap', 'wetday'];

interface Args {
  cities: string[];
  chart: ChartKind;
  out: string | undefined;
}

function parseArgs(argv: string[]): Args {
  const cities: string[] = [];
  let chart: ChartKind = 'muggy';
  let out: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--chart') {
      const v = argv[++i] as ChartKind | undefined;
      if (!v || !CHART_KINDS.includes(v)) {
        throw new Error(`Unsupported chart: "${v}". Supported: ${CHART_KINDS.join(', ')}.`);
      }
      chart = v;
    } else if (a === '--out') {
      out = argv[++i];
    } else if (a.startsWith('--')) {
      throw new Error(`Unknown flag: ${a}`);
    } else {
      cities.push(a);
    }
  }

  if (cities.length === 0) {
    throw new Error(
      'usage: bun run render <city> [<city>] [--chart muggy|heatmap] [--out path.png]',
    );
  }
  return { cities, chart, out };
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
  const series: CitySeries[] = [];

  for (const query of args.cities) {
    process.stderr.write(`resolving "${query}"…\n`);
    const result = await resolveCity(db, query);

    if (result.kind === 'none') {
      throw new Error(
        `No geocoding matches for "${query}". Try adding a qualifier, e.g. "${query}, France".`,
      );
    }
    if (result.kind === 'ambiguous') {
      process.stderr.write(`\nAmbiguous "${query}" — multiple candidates:\n`);
      for (const c of result.candidates) {
        const pop = c.population !== null ? `pop ${c.population.toLocaleString()}` : 'pop ?';
        process.stderr.write(`  • ${formatCandidate(c)}  (${pop})\n`);
      }
      const top = result.candidates[0]!;
      const exampleQualifier = top.region ?? top.country;
      process.stderr.write(
        `\nRe-run with a qualifier, e.g. "${query}, ${exampleQualifier}". (Discord disambiguation menu lands in Phase 4D.)\n`,
      );
      process.exit(2);
    }

    const city = result.city;
    const regionPart = city.region ? `, ${city.region}` : '';
    process.stderr.write(
      `  → ${city.canonicalName}${regionPart}, ${city.country}  (${city.latitude.toFixed(4)}, ${city.longitude.toFixed(4)}, tz=${city.timezone})  [${result.via}]\n`,
    );

    const cube = await loadClimateCube({
      latitude: city.latitude,
      longitude: city.longitude,
      timezone: city.timezone,
      onProgress: (msg) => process.stderr.write(`  ${msg}\n`),
    });

    series.push({ name: city.canonicalName, cube });
  }

  // Canonicalize order so swapped user input hits the same cache entry as
  // the Discord bot path.
  series.sort((a, b) => compareCubesCanonical(a.cube, b.cube));

  const cubes = series.map((s) => s.cube);
  const png =
    args.chart === 'muggy'
      ? renderChartCached('muggy', cubes, () => renderMuggyComparisonSvg(series))
      : args.chart === 'wetday'
        ? renderChartCached('wetday', cubes, () => renderWetDayComparisonSvg(series))
        : renderChartCached('heatmap', cubes, () => renderTemperatureComparisonSvg(series));

  const outPath =
    args.out ?? `out/${args.chart}-${series.map((s) => slugify(s.name)).join('-vs-')}.png`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, png);

  const seconds = ((performance.now() - t0) / 1000).toFixed(2);
  process.stderr.write(`\nwrote ${outPath} (${png.length} bytes) in ${seconds}s\n`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`render failed: ${msg}`);
  process.exit(1);
});
