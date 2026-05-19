import {
  type CitySeries,
  renderChartCached,
  renderMuggyComparisonSvg,
  renderTemperatureComparisonSvg,
  renderWetDayComparisonSvg,
} from '@atmosfera/charts';
import { type ClimateCube, loadClimateCube } from '@atmosfera/climate';
import type { City } from '@atmosfera/db';
import { AttachmentBuilder } from 'discord.js';
import { cityDisplayName } from './cities';

export type CommandKind = 'muggy' | 'climate' | 'wet' | 'compare';
export type CompareChartChoice = 'heatmap' | 'muggy' | 'wetday' | 'all';

export interface RenderRequest {
  command: CommandKind;
  cities: City[];
  /** Only meaningful for command='compare'. */
  chart?: CompareChartChoice;
}

export interface RenderedMessage {
  content: string;
  files: AttachmentBuilder[];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function citiesSlug(cities: City[]): string {
  return cities.map((c) => slugify(c.canonicalName)).join('-vs-');
}

function headline(command: CommandKind, cities: City[], cubes: ClimateCube[]): string {
  const window = `${cubes[0]!.window.startYear}–${cubes[0]!.window.endYear}`;
  if (command === 'compare') {
    return `**${cityDisplayName(cities[0]!)}** vs **${cityDisplayName(cities[1]!)}** — climatology ${window}.`;
  }
  if (command === 'muggy') {
    return `**${cityDisplayName(cities[0]!)}** — muggy probability (${window}).`;
  }
  if (command === 'wet') {
    return `**${cityDisplayName(cities[0]!)}** — wet-day probability (${window}).`;
  }
  return `**${cityDisplayName(cities[0]!)}** — temperature climatology (${window}).`;
}

/**
 * Build the public message payload for any of the commands. Loads cubes,
 * rasterizes the appropriate SVG(s) (via renderChartCached — cache-hit returns
 * a buffer in microseconds), returns the content + files for editReply or
 * followUp.
 */
export async function buildRenderedMessage(req: RenderRequest): Promise<RenderedMessage> {
  const cubes = await Promise.all(
    req.cities.map((c) =>
      loadClimateCube({ latitude: c.latitude, longitude: c.longitude, timezone: c.timezone }),
    ),
  );

  const series: CitySeries[] = req.cities.map((c, i) => ({
    name: c.canonicalName,
    cube: cubes[i]!,
  }));

  const slug = citiesSlug(req.cities);
  const files: AttachmentBuilder[] = [];

  const attach = (
    kind: 'muggy' | 'heatmap' | 'wetday',
    render: () => string,
    filenamePrefix: string,
  ) => {
    const png = renderChartCached(kind, cubes, render);
    files.push(new AttachmentBuilder(png, { name: `${filenamePrefix}-${slug}.png` }));
  };

  if (req.command === 'muggy') {
    attach('muggy', () => renderMuggyComparisonSvg(series), 'muggy');
  } else if (req.command === 'climate') {
    attach('heatmap', () => renderTemperatureComparisonSvg(series), 'climate');
  } else if (req.command === 'wet') {
    attach('wetday', () => renderWetDayComparisonSvg(series), 'wetday');
  } else {
    const chart = req.chart ?? 'heatmap';
    if (chart === 'heatmap' || chart === 'all') {
      attach('heatmap', () => renderTemperatureComparisonSvg(series), 'heatmap');
    }
    if (chart === 'muggy' || chart === 'all') {
      attach('muggy', () => renderMuggyComparisonSvg(series), 'muggy');
    }
    if (chart === 'wetday' || chart === 'all') {
      attach('wetday', () => renderWetDayComparisonSvg(series), 'wetday');
    }
  }

  return { content: headline(req.command, req.cities, cubes), files };
}
