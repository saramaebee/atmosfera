import { describe, expect, it } from 'bun:test';
import type { ClimateCube } from '@atmosfera/climate';
import { svgToPng } from './raster';
import { renderTemperatureComparisonSvg } from './temperature';

function makeSyntheticCube(meanTempC: number, lat: number, lon: number): ClimateCube {
  return {
    latitude: lat,
    longitude: lon,
    timezone: 'UTC',
    window: { startYear: 2011, endYear: 2025 },
    version: 'v1-gauss',
    temperatureMean: Array.from({ length: 365 }, () => Array(24).fill(meanTempC)),
    temperatureP10: Array.from({ length: 365 }, () => Array(24).fill(meanTempC - 5)),
    temperatureP90: Array.from({ length: 365 }, () => Array(24).fill(meanTempC + 5)),
    dewpointMean: Array.from({ length: 365 }, () => Array(24).fill(10)),
    cloudcoverMean: Array.from({ length: 365 }, () => Array(24).fill(50)),
    muggyProbability: Array(365).fill(0),
    wetDayProbability: Array(365).fill(0),
  };
}

describe('renderTemperatureComparisonSvg', () => {
  it('renders a single-city SVG with title, panel border, legend swatches', () => {
    const svg = renderTemperatureComparisonSvg([
      { name: 'TestCity', cube: makeSyntheticCube(20, 0, 0) },
    ]);
    expect(svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('TestCity');
    expect(svg).toContain('Temperature climatology');
    // 9 band swatches; can grep for one of the named bands
    expect(svg).toContain('sweltering');
    expect(svg).toContain('frigid');
  });

  it('renders 8760 cells per city', () => {
    const svg = renderTemperatureComparisonSvg([{ name: 'A', cube: makeSyntheticCube(20, 0, 0) }]);
    // 365 days × 24 hours = 8760 cells + some additional rects (border, swatches, night).
    // We count cell-pattern rects (which use 'fill=' with a hex color, not opacity).
    const cellMatches = svg.match(
      /<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="#[0-9a-f]{6}" \/>/gi,
    );
    expect(cellMatches?.length).toBeGreaterThanOrEqual(8760);
  });

  it('rasterizes a two-city heatmap to a valid PNG', () => {
    const svg = renderTemperatureComparisonSvg([
      { name: 'A', cube: makeSyntheticCube(20, 30, 0) },
      { name: 'B', cube: makeSyntheticCube(-5, -30, 0) },
    ]);
    const png = svgToPng(svg);
    expect(png.length).toBeGreaterThan(5000);
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
  });
});
