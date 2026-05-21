import {
  type CitySeries,
  compareCubesCanonical,
  renderChartCached,
  renderMuggyComparisonSvg,
  renderTemperatureComparisonSvg,
  renderWetDayComparisonSvg,
} from '@atmosfera/charts';
import { type ClimateCube, loadClimateCube } from '@atmosfera/climate';
import type { City } from '@atmosfera/db';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { cityDisplayName } from './cities';
import {
  formatWetBulbDual,
  formatWetBulbWithLabel,
  monthName,
  summerAfternoonWetBulbC,
  wetBulbTakeaway,
} from './wetbulb-format';

export type CommandKind = 'muggy' | 'climate' | 'wet' | 'compare' | 'roast';
export type CompareChartChoice = 'heatmap' | 'muggy' | 'wetday' | 'all';

export interface RenderRequest {
  command: CommandKind;
  cities: City[];
  /** Only meaningful for command='compare'. */
  chart?: CompareChartChoice;
  /** When present, the roast text becomes the message content and the
   * usual headline moves to a small footer line. */
  roast?: string;
  /** Attach a per-city wet-bulb heat-stress embed beneath the chart. */
  wetBulb?: boolean;
}

export interface RenderedMessage {
  content: string;
  files: AttachmentBuilder[];
  embeds?: EmbedBuilder[];
}

function buildCityWetBulbBlock(cube: ClimateCube): string {
  const summerAfternoon = summerAfternoonWetBulbC(cube);
  return [
    `**Typical summer afternoon:** ${formatWetBulbWithLabel(summerAfternoon)}`,
    `**Annual peak:** ${formatWetBulbWithLabel(cube.wetBulbAnnualPeakMean)}`,
    '**Hours/yr above WB:**',
    `• 75°F (muggy): ${Math.round(cube.wetBulbHoursAbove75F)} h`,
    `• 80°F (high heat stress): ${Math.round(cube.wetBulbHoursAbove80F)} h`,
    `• 85°F (dangerous): ${Math.round(cube.wetBulbHoursAbove85F)} h`,
    `**Worst month:** ${monthName(cube.wetBulbWorstMonthIndex)} — ${formatWetBulbDual(cube.wetBulbWorstMonthMean)}`,
    `**Takeaway:** ${wetBulbTakeaway(cube.wetBulbAnnualPeakMean)}`,
  ].join('\n');
}

function buildWetBulbEmbed(items: { city: City; cube: ClimateCube }[]): EmbedBuilder {
  const first = items[0]!;
  const titleSuffix =
    items.length === 1
      ? cityDisplayName(first.city)
      : items.map((i) => i.city.canonicalName).join(' vs ');

  return new EmbedBuilder()
    .setTitle(`Wet-bulb heat stress — ${titleSuffix}`)
    .setDescription(
      [
        'Wet-bulb is the lowest temperature your skin can reach by sweating — **not** the air temperature on a thermometer, and **not** the "feels like" number.',
        'It always reads lower than the actual air temp: a sweltering 35°C / 95°F afternoon might still only register ~27°C / 81°F wet-bulb. The higher it climbs, the less effective sweating becomes — once it nears body temperature, the body can no longer cool itself.',
        'All numbers below are wet-bulb (WB).',
      ].join('\n\n'),
    )
    .setColor(0x0ea5e9)
    .addFields(
      items.map(({ city, cube }) => ({
        name: cityDisplayName(city),
        value: buildCityWetBulbBlock(cube),
        inline: items.length > 1,
      })),
    )
    .setFooter({ text: `Climatology ${first.cube.window.startYear}–${first.cube.window.endYear}` });
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

function roastedContent(cities: City[], cubes: ClimateCube[], roast: string): string {
  const window = `climatology ${cubes[0]!.window.startYear}–${cubes[0]!.window.endYear}`;
  const cityList = cities.map((c) => cityDisplayName(c)).join(' vs ');
  return `${roast}\n-# ${cityList} · ${window}`;
}

/**
 * Build the public message payload for any of the commands. Loads cubes,
 * rasterizes the appropriate SVG(s) (via renderChartCached — cache-hit returns
 * a buffer in microseconds), returns the content + files for editReply or
 * followUp.
 */
export async function buildRenderedMessage(req: RenderRequest): Promise<RenderedMessage> {
  const loaded = await Promise.all(
    req.cities.map((c) =>
      loadClimateCube({ latitude: c.latitude, longitude: c.longitude, timezone: c.timezone }),
    ),
  );

  // Canonicalize order so swapped user input ("B vs A") hits the same cache
  // entry as ("A vs B"). Cube/city/series stay aligned via a paired sort.
  const paired = req.cities
    .map((city, i) => ({ city, cube: loaded[i]! }))
    .sort((a, b) => compareCubesCanonical(a.cube, b.cube));
  const cities = paired.map((p) => p.city);
  const cubes = paired.map((p) => p.cube);

  const series: CitySeries[] = paired.map((p) => ({
    name: p.city.canonicalName,
    cube: p.cube,
  }));

  const slug = citiesSlug(cities);
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

  const content = req.roast
    ? roastedContent(cities, cubes, req.roast)
    : headline(req.command, cities, cubes);

  const embeds = req.wetBulb ? [buildWetBulbEmbed(paired)] : undefined;

  return { content, files, embeds };
}
