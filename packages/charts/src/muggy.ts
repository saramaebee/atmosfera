import type { ClimateCube } from '@atmosfera/climate';
import * as d3 from 'd3';

export interface CitySeries {
  name: string;
  cube: ClimateCube;
}

const CITY_COLORS = ['#0ea5e9', '#f97316', '#10b981', '#a855f7'];

export const MUGGY_CHART_WIDTH = 1200;
export const MUGGY_CHART_HEIGHT = 600;

const MARGIN = { top: 90, right: 40, bottom: 60, left: 70 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// 0-based day-of-year for the 1st of each month (non-leap)
const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

const PEAK_LABEL_THRESHOLD = 0.05;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function argMax(arr: number[]): { index: number; value: number } {
  let bestIdx = 0;
  let bestVal = arr[0] ?? 0;
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i]!;
    if (v > bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  }
  return { index: bestIdx, value: bestVal };
}

function monthDayFromDoy(doy: number): string {
  for (let m = 11; m >= 0; m--) {
    if (doy >= MONTH_STARTS[m]!) {
      return `${MONTHS[m]} ${doy - MONTH_STARTS[m]! + 1}`;
    }
  }
  return '';
}

export function renderMuggyComparisonSvg(cities: CitySeries[]): string {
  if (cities.length === 0) throw new Error('renderMuggyComparisonSvg: no cities');
  if (cities.length > CITY_COLORS.length) {
    throw new Error(`renderMuggyComparisonSvg: max ${CITY_COLORS.length} cities`);
  }

  const innerWidth = MUGGY_CHART_WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = MUGGY_CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

  const xScale = d3.scaleLinear().domain([0, 364]).range([0, innerWidth]);
  const yScale = d3.scaleLinear().domain([0, 1]).range([innerHeight, 0]);

  const lineGen = d3
    .line<number>()
    .x((_, i) => xScale(i))
    .y((v) => yScale(v))
    .curve(d3.curveMonotoneX);

  const areaGen = d3
    .area<number>()
    .x((_, i) => xScale(i))
    .y0(yScale(0))
    .y1((v) => yScale(v))
    .curve(d3.curveMonotoneX);

  const cityShapes = cities
    .map((c, i) => {
      const color = CITY_COLORS[i]!;
      const areaPath = areaGen(c.cube.muggyProbability) ?? '';
      const linePath = lineGen(c.cube.muggyProbability) ?? '';
      return `<path d="${areaPath}" fill="${color}" fill-opacity="0.10" />
      <path d="${linePath}" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" fill="none" />`;
    })
    .join('\n      ');

  const peakAnnotations = cities
    .map((c, i) => {
      const color = CITY_COLORS[i]!;
      const { index: doy, value } = argMax(c.cube.muggyProbability);
      if (value < PEAK_LABEL_THRESHOLD) return '';

      const cx = xScale(doy);
      const cy = yScale(value);
      const label = `${c.name} · ${Math.round(value * 100)}% · ${monthDayFromDoy(doy)}`;
      const labelY = cy - 14;

      // Clamp label x so it stays inside the plot area
      const approxLabelHalfWidth = label.length * 4;
      const labelX = Math.max(
        approxLabelHalfWidth,
        Math.min(innerWidth - approxLabelHalfWidth, cx),
      );

      return `<circle cx="${cx}" cy="${cy}" r="5" fill="${color}" stroke="#ffffff" stroke-width="2" />
      <text x="${labelX}" y="${labelY}" font-size="13" font-weight="600" fill="${color}" text-anchor="middle" font-family="sans-serif">${escapeXml(label)}</text>`;
    })
    .filter(Boolean)
    .join('\n      ');

  const monthTicks = MONTH_STARTS.map((doy, i) => {
    const x = xScale(doy);
    return `<line x1="${x}" x2="${x}" y1="0" y2="${innerHeight}" stroke="#eef2f7" stroke-width="1" />
      <text x="${x}" y="${innerHeight + 22}" font-size="13" fill="#6b7280" text-anchor="middle" font-family="sans-serif">${MONTHS[i]}</text>`;
  }).join('\n      ');

  const yTicks = [0, 0.25, 0.5, 0.75, 1]
    .map((p) => {
      const y = yScale(p);
      return `<line x1="0" x2="${innerWidth}" y1="${y}" y2="${y}" stroke="#f3f4f6" stroke-width="1" />
      <text x="-14" y="${y + 4}" font-size="12" fill="#6b7280" text-anchor="end" font-family="sans-serif">${Math.round(p * 100)}%</text>`;
    })
    .join('\n      ');

  const legend = cities
    .map((c, i) => {
      const x = MARGIN.left + i * 220;
      return `<rect x="${x}" y="55" width="14" height="14" rx="2" fill="${CITY_COLORS[i]}" />
    <text x="${x + 22}" y="67" font-size="15" font-weight="600" fill="#111827" font-family="sans-serif">${escapeXml(c.name)}</text>`;
    })
    .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MUGGY_CHART_WIDTH}" height="${MUGGY_CHART_HEIGHT}" viewBox="0 0 ${MUGGY_CHART_WIDTH} ${MUGGY_CHART_HEIGHT}">
  <rect width="${MUGGY_CHART_WIDTH}" height="${MUGGY_CHART_HEIGHT}" fill="#ffffff" />
  <text x="${MARGIN.left}" y="34" font-size="22" font-weight="700" fill="#111827" font-family="sans-serif">Muggy probability — dew point ≥ 18°C</text>
  ${legend}
  <g transform="translate(${MARGIN.left},${MARGIN.top})">
    <rect x="0" y="0" width="${innerWidth}" height="${innerHeight}" fill="none" stroke="#cbd5e1" stroke-width="1" />
      ${yTicks}
      ${monthTicks}
      ${cityShapes}
      ${peakAnnotations}
  </g>
</svg>`;
}
