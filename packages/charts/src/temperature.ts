import { type ClimateCube, gaussianSmooth1d } from '@atmosfera/climate';
import { type MonthAxis, monthAxis, orientationForLatitude } from './orientation';
import { TEMPERATURE_BANDS, colorForCelsius } from './palette';
import { computeTwilightYear } from './twilight';

export interface CitySeries {
  name: string;
  cube: ClimateCube;
}

export const HEATMAP_WIDTH = 1200;

const MARGIN = { left: 70, right: 30 };
const CHART_HEADER = 40;
const PANEL_TITLE_HEIGHT = 32;
const HEATMAP_INNER_HEIGHT = 240;
const MONTH_LABEL_HEIGHT = 22;
const PANEL_GAP = 22;
const LEGEND_HEIGHT = 80;
const PANEL_TOTAL = PANEL_TITLE_HEIGHT + HEATMAP_INNER_HEIGHT + MONTH_LABEL_HEIGHT;

const TEMP_SMOOTHING_SIGMA_DAYS = 1.5;
const NIGHT_OPACITY = 0.32;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function smoothAlongDay(matrix: number[][], sigma: number): number[][] {
  const days = matrix.length;
  const hours = matrix[0]?.length ?? 0;
  const out: number[][] = Array.from({ length: days }, () => new Array<number>(hours));
  for (let h = 0; h < hours; h++) {
    const col = new Array<number>(days);
    for (let d = 0; d < days; d++) col[d] = matrix[d]![h]!;
    const smoothed = gaussianSmooth1d(col, sigma);
    for (let d = 0; d < days; d++) out[d]![h] = smoothed[d]!;
  }
  return out;
}

export function renderTemperatureComparisonSvg(cities: CitySeries[]): string {
  if (cities.length === 0) throw new Error('renderTemperatureComparisonSvg: no cities');
  if (cities.length > 2) throw new Error('renderTemperatureComparisonSvg: max 2 cities');

  const innerWidth = HEATMAP_WIDTH - MARGIN.left - MARGIN.right;
  const totalHeight =
    CHART_HEADER + cities.length * PANEL_TOTAL + (cities.length - 1) * PANEL_GAP + LEGEND_HEIGHT;

  const cellWidth = innerWidth / 365;
  const cellHeight = HEATMAP_INNER_HEIGHT / 24;

  const panels = cities
    .map((city, panelIdx) => {
      const panelTop = CHART_HEADER + panelIdx * (PANEL_TOTAL + PANEL_GAP) + PANEL_TITLE_HEIGHT;
      const titleY = CHART_HEADER + panelIdx * (PANEL_TOTAL + PANEL_GAP) + 22;
      const axis: MonthAxis = monthAxis(orientationForLatitude(city.cube.latitude));

      const smoothed = smoothAlongDay(city.cube.temperatureMean, TEMP_SMOOTHING_SIGMA_DAYS);
      const twilight = computeTwilightYear(
        city.cube.latitude,
        city.cube.longitude,
        city.cube.timezone,
      );

      // Heatmap cells (a tiny overlap +0.5 prevents thin antialiased gaps).
      // Rendered column d maps to calendar day (d + dayOffset) mod 365.
      const cells: string[] = [];
      for (let d = 0; d < 365; d++) {
        const dataDay = (d + axis.dayOffset) % 365;
        for (let h = 0; h < 24; h++) {
          const color = colorForCelsius(smoothed[dataDay]![h]!);
          const x = MARGIN.left + d * cellWidth;
          const y = panelTop + h * cellHeight;
          cells.push(
            `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cellWidth + 0.5).toFixed(2)}" height="${(cellHeight + 0.5).toFixed(2)}" fill="${color}" />`,
          );
        }
      }

      // Night overlay
      const nightRects: string[] = [];
      for (let d = 0; d < 365; d++) {
        const dataDay = (d + axis.dayOffset) % 365;
        const tw = twilight[dataDay]!;
        const x = MARGIN.left + d * cellWidth;
        const w = cellWidth + 0.5;
        if (tw.alwaysNight) {
          nightRects.push(
            `<rect x="${x.toFixed(2)}" y="${panelTop.toFixed(2)}" width="${w.toFixed(2)}" height="${HEATMAP_INNER_HEIGHT}" fill="#000000" fill-opacity="${NIGHT_OPACITY}" />`,
          );
          continue;
        }
        if (tw.alwaysDay) continue;
        for (const [start, end] of tw.nightSegments) {
          const y = panelTop + start * cellHeight;
          const h = (end - start) * cellHeight;
          nightRects.push(
            `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="#000000" fill-opacity="${NIGHT_OPACITY}" />`,
          );
        }
      }

      // Y axis hour labels
      const hourTicks = [0, 6, 12, 18, 24]
        .map((h) => {
          const y = panelTop + h * cellHeight;
          const label =
            h === 0 || h === 24 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`;
          return `<line x1="${MARGIN.left - 4}" x2="${MARGIN.left}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" stroke="#9ca3af" stroke-width="1" />
      <text x="${MARGIN.left - 8}" y="${(y + 4).toFixed(2)}" font-size="11" fill="#6b7280" text-anchor="end" font-family="sans-serif">${label}</text>`;
        })
        .join('\n      ');

      // Subtle vertical month gridlines on top of the heatmap
      const monthGrid = axis.starts
        .map((doy) => {
          const x = MARGIN.left + doy * cellWidth;
          return `<line x1="${x.toFixed(2)}" x2="${x.toFixed(2)}" y1="${panelTop}" y2="${panelTop + HEATMAP_INNER_HEIGHT}" stroke="#ffffff" stroke-opacity="0.25" stroke-width="1" />`;
        })
        .join('\n      ');

      // Panel border
      const border = `<rect x="${MARGIN.left}" y="${panelTop}" width="${innerWidth}" height="${HEATMAP_INNER_HEIGHT}" fill="none" stroke="#94a3b8" stroke-width="1" />`;

      // Month labels for this panel, centered within each month band.
      const monthLabelY = panelTop + HEATMAP_INNER_HEIGHT + 16;
      const monthLabels = axis.starts
        .map((doy, i) => {
          const monthCenter = doy + axis.lengths[i]! / 2;
          const x = MARGIN.left + monthCenter * cellWidth;
          return `<text x="${x.toFixed(2)}" y="${monthLabelY.toFixed(2)}" font-size="13" fill="#6b7280" text-anchor="middle" font-family="sans-serif">${axis.labels[i]}</text>`;
        })
        .join('\n      ');

      return `
    <text x="${MARGIN.left}" y="${titleY}" font-size="17" font-weight="700" fill="#111827" font-family="sans-serif">${escapeXml(city.name)}</text>
    <text x="${(MARGIN.left + innerWidth).toFixed(2)}" y="${titleY}" font-size="12" fill="#6b7280" font-family="sans-serif" text-anchor="end">${city.cube.latitude.toFixed(2)}°, ${city.cube.longitude.toFixed(2)}° · ${escapeXml(city.cube.timezone)}</text>
      ${cells.join('\n      ')}
      ${nightRects.join('\n      ')}
      ${monthGrid}
      ${border}
      ${hourTicks}
      ${monthLabels}`;
    })
    .join('\n');

  // Legend — 9 band swatches across the bottom
  const legendY = totalHeight - LEGEND_HEIGHT + 26;
  const swatchWidth = innerWidth / TEMPERATURE_BANDS.length;
  const swatchHeight = 18;
  const legend = TEMPERATURE_BANDS.map((band, i) => {
    const x = MARGIN.left + i * swatchWidth;
    const rangeLabel =
      i === 0
        ? `under ${band.maxC}°C`
        : i === TEMPERATURE_BANDS.length - 1
          ? `over ${band.minC}°C`
          : `${band.minC} to ${band.maxC}°C`;
    return `<rect x="${x.toFixed(2)}" y="${legendY}" width="${swatchWidth.toFixed(2)}" height="${swatchHeight}" fill="${band.color}" />
    <text x="${(x + swatchWidth / 2).toFixed(2)}" y="${legendY + swatchHeight + 14}" font-size="11" font-weight="600" fill="#111827" text-anchor="middle" font-family="sans-serif">${band.name}</text>
    <text x="${(x + swatchWidth / 2).toFixed(2)}" y="${legendY + swatchHeight + 28}" font-size="10" fill="#6b7280" text-anchor="middle" font-family="sans-serif">${rangeLabel}</text>`;
  }).join('\n    ');

  const title =
    cities.length === 1
      ? `Temperature climatology — ${cities[0]!.name}`
      : `Temperature climatology — ${cities.map((c) => c.name).join(' vs ')}`;
  const subtitle = `Mean temperature by hour of day across ${cities[0]!.cube.window.startYear}–${cities[0]!.cube.window.endYear}. Shaded regions: sun below horizon.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${HEATMAP_WIDTH}" height="${totalHeight}" viewBox="0 0 ${HEATMAP_WIDTH} ${totalHeight}">
  <rect width="${HEATMAP_WIDTH}" height="${totalHeight}" fill="#ffffff" />
  <text x="${MARGIN.left}" y="22" font-size="18" font-weight="700" fill="#111827" font-family="sans-serif">${escapeXml(title)}</text>
  <text x="${MARGIN.left}" y="38" font-size="11" fill="#6b7280" font-family="sans-serif">${escapeXml(subtitle)}</text>
${panels}
    ${legend}
</svg>`;
}
