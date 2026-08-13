import { describe, expect, it } from 'bun:test';
import type { ClimateCube } from '@atmosfera/climate';
import { renderMuggyComparisonSvg, renderWetDayComparisonSvg } from './muggy';
import { svgToPng } from './raster';
import { DARK_THEME, LIGHT_THEME } from './theme';

function makeSyntheticCube(name: string, peak: number): ClimateCube {
  const muggyProbability = new Array<number>(365);
  for (let d = 0; d < 365; d++) {
    // Bell curve peaking at day 200
    muggyProbability[d] = peak * Math.exp(-((d - 200) ** 2) / 5000);
  }
  return {
    latitude: 0,
    longitude: 0,
    timezone: 'UTC',
    window: { startYear: 2011, endYear: 2025 },
    version: 'v0-raw',
    temperatureMean: Array.from({ length: 365 }, () => Array(24).fill(20)),
    temperatureP10: Array.from({ length: 365 }, () => Array(24).fill(15)),
    temperatureP90: Array.from({ length: 365 }, () => Array(24).fill(25)),
    dewpointMean: Array.from({ length: 365 }, () => Array(24).fill(15)),
    cloudcoverMean: Array.from({ length: 365 }, () => Array(24).fill(50)),
    muggyProbability,
    wetDayProbability: Array(365).fill(0),
    wetBulbMean: Array.from({ length: 365 }, () => Array(24).fill(15)),
    wetBulbAnnualPeakMean: 20,
    wetBulbHoursAbove75F: 0,
    wetBulbHoursAbove80F: 0,
    wetBulbHoursAbove85F: 0,
    wetBulbWorstMonthIndex: 6,
    wetBulbWorstMonthMean: 18,
  };
}

describe('renderMuggyComparisonSvg', () => {
  it('renders a single-city SVG', () => {
    const svg = renderMuggyComparisonSvg([
      { name: 'Test City', cube: makeSyntheticCube('Test City', 0.8) },
    ]);
    expect(svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('Test City');
    expect(svg).toContain('<path');
  });

  it('renders dark by default and light on request', () => {
    const cities = [{ name: 'Test City', cube: makeSyntheticCube('Test City', 0.8) }];
    const dark = renderMuggyComparisonSvg(cities);
    const light = renderMuggyComparisonSvg(cities, LIGHT_THEME);
    expect(dark).toContain(`fill="${DARK_THEME.bg}"`);
    expect(light).toContain(`fill="${LIGHT_THEME.bg}"`);
    expect(light).not.toBe(dark);
  });

  it('renders a two-city comparison SVG with area + line per city', () => {
    const svg = renderMuggyComparisonSvg([
      { name: 'A', cube: makeSyntheticCube('A', 0.8) },
      { name: 'B', cube: makeSyntheticCube('B', 0.3) },
    ]);
    // Each city contributes one area path + one line path = 4 total
    const pathCount = (svg.match(/<path /g) || []).length;
    expect(pathCount).toBe(4);
  });

  it('annotates peaks above threshold and skips peaks below', () => {
    const svg = renderMuggyComparisonSvg([
      { name: 'Hot', cube: makeSyntheticCube('Hot', 0.8) },
      { name: 'Cold', cube: makeSyntheticCube('Cold', 0.02) },
    ]);
    expect(svg).toContain('Hot · 80% ·'); // peak label rendered
    expect(svg).not.toContain('Cold · '); // below 5% threshold, no peak label
    // Hot gets a peak marker circle; Cold doesn't
    const circleCount = (svg.match(/<circle /g) || []).length;
    expect(circleCount).toBe(1);
  });

  it('escapes city names in legend', () => {
    const svg = renderMuggyComparisonSvg([
      { name: 'A & B "test"', cube: makeSyntheticCube('A', 0.5) },
    ]);
    expect(svg).toContain('A &amp; B &quot;test&quot;');
  });
});

describe('renderWetDayComparisonSvg', () => {
  it('uses the wet-day probability series and the right title', () => {
    const cube = makeSyntheticCube('Test', 0);
    // give the synthetic cube a wet-day signal
    for (let d = 0; d < 365; d++) {
      cube.wetDayProbability[d] = 0.5 * Math.exp(-((d - 100) ** 2) / 5000);
    }
    const svg = renderWetDayComparisonSvg([{ name: 'Test', cube }]);
    expect(svg).toContain('Wet-day probability');
    expect(svg).toContain('Test ·'); // peak label
  });
});

describe('svgToPng', () => {
  it('rasterizes an SVG to a non-empty PNG buffer', () => {
    const svg = renderMuggyComparisonSvg([{ name: 'Test', cube: makeSyntheticCube('Test', 0.8) }]);
    const png = svgToPng(svg);
    expect(png.length).toBeGreaterThan(1000);
    // PNG signature
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });
});
