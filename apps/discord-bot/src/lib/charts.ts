import {
  type ChartTheme,
  type CitySeries,
  DARK_THEME,
  type ThemeName,
  compareCubesCanonical,
  encodeRadarGif,
  formatFrameTime,
  formatGeneratedStamp,
  nowCardInputFromForecast,
  pngTileDataUri,
  renderChartCached,
  renderMuggyComparisonSvg,
  renderNowCardSvg,
  renderRadarFrameSvg,
  renderTemperatureComparisonSvg,
  renderWetDayComparisonSvg,
  resolveTheme,
  svgToPng,
  svgToRgba,
} from '@atmosfera/charts';
import {
  type ClimateCube,
  fetchBasemapTile,
  fetchForecastNow,
  fetchRadarCatalog,
  fetchRadarTile,
  loadClimateCube,
  mapWithConcurrency,
  radarViewport,
  selectUpcomingHours,
} from '@atmosfera/climate';
import type { City } from '@atmosfera/db';
import { container } from '@sapphire/framework';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { cityDisplayName } from './cities';
import {
  formatWetBulbDual,
  formatWetBulbWithLabel,
  monthName,
  summerAfternoonWetBulbC,
  wetBulbTakeaway,
} from './wetbulb-format';

export type CommandKind = 'muggy' | 'climate' | 'wet' | 'compare' | 'now' | 'radar';
export type CompareChartChoice = 'heatmap' | 'muggy' | 'wetday' | 'all';
export type RadarMode = 'past' | 'nowcast';

// URL wrapped in <…> so Discord suppresses the link-preview embed while keeping
// the masked-link text.
const OPEN_METEO_ATTRIBUTION = 'Data: [Open-Meteo](<https://open-meteo.com>) · CC BY 4.0';

export interface RenderRequest {
  command: CommandKind;
  cities: City[];
  /** Only meaningful for command='compare'. */
  chart?: CompareChartChoice;
  /** Only meaningful for command='radar'. */
  radarMode?: RadarMode;
  /** Attach a per-city wet-bulb heat-stress embed beneath the chart. */
  wetBulb?: boolean;
  /** Chart color theme; omitted means dark. */
  theme?: ThemeName;
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
    .setFooter({
      text: `Climatology ${first.cube.window.startYear}–${first.cube.window.endYear} · Data: Open-Meteo (CC BY 4.0)`,
    });
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
  let head: string;
  if (command === 'compare') {
    head = `**${cityDisplayName(cities[0]!)}** vs **${cityDisplayName(cities[1]!)}** — climatology ${window}.`;
  } else if (command === 'muggy') {
    head = `**${cityDisplayName(cities[0]!)}** — muggy probability (${window}).`;
  } else if (command === 'wet') {
    head = `**${cityDisplayName(cities[0]!)}** — wet-day probability (${window}).`;
  } else {
    head = `**${cityDisplayName(cities[0]!)}** — temperature climatology (${window}).`;
  }
  return `${head}\n-# ${OPEN_METEO_ATTRIBUTION}`;
}

async function buildNowMessage(city: City, theme: ChartTheme): Promise<RenderedMessage> {
  const forecast = await fetchForecastNow(city.latitude, city.longitude);
  const upcoming = selectUpcomingHours(forecast);
  const input = nowCardInputFromForecast(cityDisplayName(city), forecast, upcoming);

  // Not renderChartCached: that cache is keyed on lat/lon + cube version and
  // persists forever, which is wrong for a forecast. The render itself is
  // milliseconds and the 10-minute forecast data cache absorbs repeat calls.
  const png = svgToPng(renderNowCardSvg(input, theme));

  return {
    content: `**${cityDisplayName(city)}** — current conditions & next 24 h.\n-# ${OPEN_METEO_ATTRIBUTION}`,
    files: [new AttachmentBuilder(png, { name: `now-${slugify(city.canonicalName)}.png` })],
  };
}

const RADAR_ATTRIBUTION =
  'Radar: [RainViewer](<https://www.rainviewer.com>) · Map: © OpenStreetMap contributors © [CARTO](<https://carto.com>)';

/** Fewer surviving frames than this reads as broken, not as a radar loop. */
const RADAR_MIN_FRAMES = 4;
/**
 * A nowcast is short by nature (typically 3 forecast frames plus the current
 * one), so the past-mode threshold would reject healthy nowcast loops.
 */
const RADAR_MIN_FRAMES_NOWCAST = 2;

export interface RadarGifResult {
  gif: Buffer;
  firstLabel: string;
  lastLabel: string;
  frameCount: number;
}

/**
 * Fetch RainViewer frames + CARTO basemap for the city and encode the
 * animated radar loop. Returns null when the upstream catalog has no frames
 * (or too few frames survive tile failures) — callers turn that into a
 * friendly outage message. Shared with scripts/radar-smoke.ts.
 *
 * 'nowcast' renders the forecast frames, anchored on the newest past frame so
 * the loop starts at "now" rather than jumping straight into the future.
 */
export async function buildRadarGif(
  city: City,
  mode: RadarMode = 'past',
  theme: ChartTheme = DARK_THEME,
): Promise<RadarGifResult | null> {
  const catalog = await fetchRadarCatalog();
  const frames =
    mode === 'nowcast'
      ? catalog.radar.nowcast.length > 0
        ? [...catalog.radar.past.slice(-1), ...catalog.radar.nowcast]
        : []
      : catalog.radar.past;
  const minFrames = mode === 'nowcast' ? RADAR_MIN_FRAMES_NOWCAST : RADAR_MIN_FRAMES;
  if (frames.length === 0) return null;

  const vp = radarViewport(city.latitude, city.longitude);

  // One deadline across the whole ~117-tile fan-out: without it, a tile-host
  // outage burns two 10 s timeouts per fetch and holds the deferred
  // interaction for minutes. Aborted radar tiles degrade to null below, so
  // the RADAR_MIN_FRAMES check bails out quickly instead.
  const deadline = AbortSignal.timeout(30_000);

  // Basemap failure throws (a hole in the map looks broken); a failed radar
  // tile degrades to null at fetch time and drops its whole frame below —
  // rendered, it would be indistinguishable from "no rain there". The dark
  // theme fetches a second, transparent labels layer composited above the
  // rain (see RadarTheme.labelsStyle) — same failure semantics.
  const { basemapStyle, labelsStyle } = theme.radar;
  const [basemapTiles, labelTiles] = await Promise.all([
    Promise.all(
      vp.tiles.map((t) =>
        t.y === null ? null : fetchBasemapTile(vp.zoom, t.x, t.y, basemapStyle, deadline),
      ),
    ),
    labelsStyle
      ? Promise.all(
          vp.tiles.map((t) =>
            t.y === null ? null : fetchBasemapTile(vp.zoom, t.x, t.y, labelsStyle, deadline),
          ),
        )
      : null,
  ]);
  // The basemap is identical across animation frames — encode the data URIs
  // once here rather than per frame.
  const basemapImages = basemapTiles.map((t) => (t === null ? null : pngTileDataUri(t)));
  const labelImages = labelTiles?.map((t) => (t === null ? null : pngTileDataUri(t)));

  const jobs = frames.flatMap((frame) => vp.tiles.map((tile) => ({ frame, tile })));
  const fetched = await mapWithConcurrency(jobs, 8, async ({ frame, tile }) => {
    if (tile.y === null) return null;
    try {
      return await fetchRadarTile(catalog.host, frame.path, vp.zoom, tile.x, tile.y, deadline);
    } catch {
      return null;
    }
  });

  const rgbaFrames: Uint8Array[] = [];
  const labels: string[] = [];
  const generatedLabel = formatGeneratedStamp(Date.now(), city.timezone);
  for (let i = 0; i < frames.length; i++) {
    const radarTiles = fetched.slice(i * vp.tiles.length, (i + 1) * vp.tiles.length);
    // Honest frames only: a missing radar tile would render as falsely dry
    // ground, so a frame with any failed tile is dropped outright. Polar
    // slots (tile.y === null) are expected blanks, not failures.
    if (!radarTiles.every((t, j) => t !== null || vp.tiles[j]!.y === null)) continue;
    const label = formatFrameTime(frames[i]!.time, city.timezone);
    const svg = renderRadarFrameSvg({
      width: vp.width,
      height: vp.height,
      cols: vp.cols,
      rows: vp.rows,
      offsetX: vp.offsetX,
      offsetY: vp.offsetY,
      basemapImages,
      labelImages,
      radarTiles,
      timeLabel: label,
      cityName: cityDisplayName(city),
      generatedLabel,
      theme,
    });
    rgbaFrames.push(svgToRgba(svg).pixels);
    labels.push(label);
  }
  if (rgbaFrames.length < minFrames) return null;

  const gif = Buffer.from(encodeRadarGif(rgbaFrames, vp.width, vp.height));
  return { gif, firstLabel: labels[0]!, lastLabel: labels.at(-1)!, frameCount: rgbaFrames.length };
}

// In-flight builds only — no completed-result cache in v0: a GIF must never
// outlive the catalog that produced it. (Repeats within a catalog window
// would be byte-identical; a memoization design keyed by the newest frame
// path is captured in GitHub issue #37.) Concurrent requests for the same
// city (a storm hits, several users check at once) still share one ~5 s
// CPU pipeline instead of running it once each.
const inFlightRadarBuilds = new Map<string, Promise<RadarGifResult | null>>();

function buildRadarGifCoalesced(
  city: City,
  mode: RadarMode,
  theme: ChartTheme,
): Promise<RadarGifResult | null> {
  const key = `${city.latitude},${city.longitude}:${mode}:${theme.name}`;
  const existing = inFlightRadarBuilds.get(key);
  if (existing) return existing;
  const build = buildRadarGif(city, mode, theme).finally(() => inFlightRadarBuilds.delete(key));
  inFlightRadarBuilds.set(key, build);
  return build;
}

async function buildRadarMessage(
  city: City,
  mode: RadarMode,
  theme: ChartTheme,
): Promise<RenderedMessage> {
  // Errors become a friendly command-specific message rather than propagating
  // to the generic chatInputCommandError listener: radar makes ~120 tile
  // fetches, so transient network failures are a matter of when, not if, and
  // deserve better copy than the catch-all.
  let result: RadarGifResult | null;
  try {
    result = await buildRadarGifCoalesced(city, mode, theme);
  } catch (err) {
    container.logger.error(`radar: GIF build failed for ${cityDisplayName(city)}`, err);
    result = null;
  }
  if (!result) {
    return {
      content: `Radar imagery for **${cityDisplayName(city)}** is unavailable right now. Try again in a few minutes.`,
      files: [],
    };
  }

  // The caption claims only the range that actually survived tile failures —
  // frames can drop, so "past 2 h" would overstate coverage.
  const label =
    mode === 'nowcast'
      ? `radar nowcast (${result.firstLabel}–${result.lastLabel} local, forecast)`
      : `radar loop (${result.firstLabel}–${result.lastLabel} local)`;
  return {
    content: `**${cityDisplayName(city)}** — ${label}.\n-# ${RADAR_ATTRIBUTION}`,
    files: [
      new AttachmentBuilder(result.gif, { name: `radar-${slugify(city.canonicalName)}.gif` }),
    ],
  };
}

/**
 * Build the public message payload for any of the commands. Loads cubes,
 * rasterizes the appropriate SVG(s) (via renderChartCached — cache-hit returns
 * a buffer in microseconds), returns the content + files for editReply or
 * followUp.
 */
export async function buildRenderedMessage(req: RenderRequest): Promise<RenderedMessage> {
  const theme = resolveTheme(req.theme);
  // '/now' is forecast-shaped, not climatology-shaped: no cubes, no wet-bulb.
  // Branching here (rather than in each caller) keeps the disambiguation
  // resume path working for it unchanged.
  if (req.command === 'now') return buildNowMessage(req.cities[0]!, theme);
  // '/radar' is live-imagery-shaped: no cubes either, and renderChartCached's
  // permanent cache would be wrong — the catalog/tile caches absorb repeats.
  if (req.command === 'radar') {
    return buildRadarMessage(req.cities[0]!, req.radarMode ?? 'past', theme);
  }

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
    const png = renderChartCached(kind, cubes, render, theme.name);
    files.push(new AttachmentBuilder(png, { name: `${filenamePrefix}-${slug}.png` }));
  };

  if (req.command === 'muggy') {
    attach('muggy', () => renderMuggyComparisonSvg(series, theme), 'muggy');
  } else if (req.command === 'climate') {
    attach('heatmap', () => renderTemperatureComparisonSvg(series, theme), 'climate');
  } else if (req.command === 'wet') {
    attach('wetday', () => renderWetDayComparisonSvg(series, theme), 'wetday');
  } else {
    const chart = req.chart ?? 'heatmap';
    if (chart === 'heatmap' || chart === 'all') {
      attach('heatmap', () => renderTemperatureComparisonSvg(series, theme), 'heatmap');
    }
    if (chart === 'muggy' || chart === 'all') {
      attach('muggy', () => renderMuggyComparisonSvg(series, theme), 'muggy');
    }
    if (chart === 'wetday' || chart === 'all') {
      attach('wetday', () => renderWetDayComparisonSvg(series, theme), 'wetday');
    }
  }

  const content = headline(req.command, cities, cubes);

  const embeds = req.wetBulb ? [buildWetBulbEmbed(paired)] : undefined;

  return { content, files, embeds };
}
