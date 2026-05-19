import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ClimateCube } from '@atmosfera/climate';
import { svgToPng } from './raster';

export type ChartKind = 'muggy' | 'heatmap' | 'wetday';

// Bumped when render output changes for the same inputs (e.g. hemisphere-aware
// month axis on heatmaps). Mixed into the cache key so old PNGs are skipped.
const RENDER_VERSION = 'v3';

/**
 * Cache key combines the chart kind with every input cube's fingerprint
 * (lat/lon/version). Cube version bumps automatically invalidate; otherwise
 * the file is reused indefinitely.
 *
 * Order-sensitive: BA vs Reykjavik renders the BA series first; flipping the
 * order produces a different chart and a different cache entry. Intentional.
 */
function chartCacheKey(kind: ChartKind, cubes: ClimateCube[]): string {
  const fingerprint = cubes
    .map((c) => `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)},${c.version}`)
    .join('|');
  return createHash('sha1')
    .update(`${RENDER_VERSION}|${kind}|${fingerprint}`)
    .digest('hex')
    .slice(0, 16);
}

export function chartCachePath(kind: ChartKind, cubes: ClimateCube[]): string {
  return `.cache/charts/${kind}-${chartCacheKey(kind, cubes)}.png`;
}

/**
 * Render-to-PNG with a filesystem cache. The renderSvg callback runs only on
 * cache miss; for cached chart pairs we skip the Satori/D3 + Resvg work
 * entirely and just read the file.
 */
export function renderChartCached(
  kind: ChartKind,
  cubes: ClimateCube[],
  renderSvg: () => string,
): Buffer {
  const path = chartCachePath(kind, cubes);
  if (existsSync(path)) {
    return readFileSync(path);
  }
  const png = svgToPng(renderSvg());
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  return png;
}
