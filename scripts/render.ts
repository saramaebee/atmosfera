import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  type CitySeries,
  renderMuggyComparisonSvg,
  renderTemperatureComparisonSvg,
  svgToPng,
} from '@atmosfera/charts';
import { loadClimateCube } from '@atmosfera/climate';
import { formatCandidate, geocodeTop } from '@atmosfera/geocode';

type ChartKind = 'muggy' | 'heatmap';
const CHART_KINDS: ChartKind[] = ['muggy', 'heatmap'];

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
  const t0 = performance.now();

  const series: CitySeries[] = [];
  for (const query of args.cities) {
    process.stderr.write(`geocoding "${query}"…\n`);
    const candidate = await geocodeTop(query);
    process.stderr.write(
      `  → ${formatCandidate(candidate)}  (${candidate.latitude.toFixed(4)}, ${candidate.longitude.toFixed(4)}, tz=${candidate.timezone})\n`,
    );

    const cube = await loadClimateCube({
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      timezone: candidate.timezone,
      onProgress: (msg) => process.stderr.write(`  ${msg}\n`),
    });

    series.push({ name: candidate.canonicalName, cube });
  }

  const svg =
    args.chart === 'muggy'
      ? renderMuggyComparisonSvg(series)
      : renderTemperatureComparisonSvg(series);
  const png = svgToPng(svg);

  const outPath = args.out ?? `out/${args.chart}-${args.cities.map(slugify).join('-vs-')}.png`;
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
