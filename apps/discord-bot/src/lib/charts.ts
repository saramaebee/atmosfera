import {
  type CitySeries,
  renderMuggyComparisonSvg,
  renderTemperatureComparisonSvg,
  svgToPng,
} from '@atmosfera/charts';
import { type ClimateCube, loadClimateCube } from '@atmosfera/climate';
import type { City } from '@atmosfera/db';
import { AttachmentBuilder } from 'discord.js';
import { cityDisplayName } from './cities';

export type CommandKind = 'muggy' | 'climate' | 'compare';
export type CompareChartChoice = 'heatmap' | 'muggy' | 'both';

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
  return `**${cityDisplayName(cities[0]!)}** — temperature climatology (${window}).`;
}

/**
 * Build the public message for any of the three commands. Loads cubes,
 * rasterizes the appropriate SVG(s), returns the content+files payload that
 * the caller passes to editReply (initial flow) or followUp (post-disambig).
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

  if (req.command === 'muggy') {
    const png = svgToPng(renderMuggyComparisonSvg(series));
    files.push(new AttachmentBuilder(png, { name: `muggy-${slug}.png` }));
  } else if (req.command === 'climate') {
    const png = svgToPng(renderTemperatureComparisonSvg(series));
    files.push(new AttachmentBuilder(png, { name: `climate-${slug}.png` }));
  } else {
    const chart = req.chart ?? 'heatmap';
    if (chart === 'heatmap' || chart === 'both') {
      const png = svgToPng(renderTemperatureComparisonSvg(series));
      files.push(new AttachmentBuilder(png, { name: `heatmap-${slug}.png` }));
    }
    if (chart === 'muggy' || chart === 'both') {
      const png = svgToPng(renderMuggyComparisonSvg(series));
      files.push(new AttachmentBuilder(png, { name: `muggy-${slug}.png` }));
    }
  }

  return { content: headline(req.command, req.cities, cubes), files };
}
