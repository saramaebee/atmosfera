import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ClimateCube } from '@atmosfera/climate';
import { svgToPng } from './raster';
import type { ThemeName } from './theme';

export type ChartKind = 'muggy' | 'heatmap' | 'wetday';

// Bumped when render output changes for the same inputs (e.g. hemisphere-aware
// month axis on heatmaps). Mixed into the cache key so old PNGs are skipped.
const RENDER_VERSION = 'v4';

/**
 * Comparator that imposes a canonical input order on chart inputs. Callers
 * sort cubes (and any parallel arrays like City[]) with this before rendering
 * so swapping user-typed order still hits the same cache entry. Latitude then
 * longitude — both already in the cube and stable across calls.
 */
export function compareCubesCanonical(a: ClimateCube, b: ClimateCube): number {
  return a.latitude - b.latitude || a.longitude - b.longitude;
}

/**
 * Cache key combines the chart kind with every input cube's fingerprint
 * (lat/lon/version). Cube version bumps automatically invalidate; otherwise
 * the file is reused indefinitely.
 *
 * The key itself is order-sensitive — canonical ordering is a caller contract
 * enforced upstream via compareCubesCanonical, which also reorders parallel
 * City/series arrays so chart titles, panel order, and legend colors all stay
 * consistent with the cached PNG.
 */
function chartCacheKey(kind: ChartKind, cubes: ClimateCube[], theme: ThemeName): string {
  const fingerprint = cubes
    .map((c) => `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)},${c.version}`)
    .join('|');
  return createHash('sha1')
    .update(`${RENDER_VERSION}|${theme}|${kind}|${fingerprint}`)
    .digest('hex')
    .slice(0, 16);
}

export function chartCachePath(
  kind: ChartKind,
  cubes: ClimateCube[],
  theme: ThemeName = 'dark',
): string {
  return `.cache/charts/${kind}-${theme}-${chartCacheKey(kind, cubes, theme)}.png`;
}

/**
 * Render-to-PNG with a filesystem cache. The renderSvg callback runs only on
 * cache miss; for cached chart pairs we skip the SVG + Resvg work
 * entirely and just read the file.
 */
export function renderChartCached(
  kind: ChartKind,
  cubes: ClimateCube[],
  renderSvg: () => string,
  theme: ThemeName = 'dark',
): Buffer {
  const path = chartCachePath(kind, cubes, theme);
  if (existsSync(path)) {
    return readFileSync(path);
  }
  const png = svgToPng(renderSvg());
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  return png;
}
