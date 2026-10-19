import {
  fetchBasemapTile,
  fetchRadarCatalog,
  fetchRadarTile,
  mapWithConcurrency,
  radarViewport,
} from '@atmosfera/climate';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { svgToRgba } from './raster';
import { type ChartTheme, DARK_THEME } from './theme';

export const RADAR_GIF_SIZE = 512;

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** "2:30 PM" in the city's IANA timezone. */
export function formatFrameTime(unixSec: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(unixSec * 1000));
}

/**
 * "Aug 12, 2:30 PM" in the city's IANA timezone — the generation stamp for
 * the bottom bar. City-local on purpose, so it reads on the same clock as the
 * frame timestamps.
 */
export function formatGeneratedStamp(unixMs: number, timeZone: string): string {
  const d = new Date(unixMs);
  // Two formatters joined explicitly: a combined one lets ICU pick the
  // date–time separator (" at " on newer versions), which varies by runtime.
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
  return `${date}, ${time}`;
}

export interface RadarFrameSvgInput {
  width: number;
  height: number;
  cols: number;
  rows: number;
  offsetX: number;
  offsetY: number;
  /**
   * Row-major, aligned with the viewport tile grid; null = blank slot.
   * Pre-encoded `data:image/png;base64,...` URIs (see {@link pngTileDataUri}) —
   * the basemap is identical across animation frames, so encode it once.
   */
  basemapImages: (string | null)[];
  /**
   * Optional transparent place-labels layer (same grid/encoding as
   * basemapImages), drawn above the rain so precipitation never obscures city
   * names, brightened per theme.labelsBoost.
   */
  labelImages?: (string | null)[];
  radarTiles: (Buffer | null)[];
  timeLabel: string;
  cityName: string;
  /** Generation stamp for the bottom bar (see {@link formatGeneratedStamp}). */
  generatedLabel: string;
  theme?: ChartTheme;
}

const TILE = 256;

/**
 * Bottom-bar text widths are pinned with textLength so the attribution and
 * the brand/generation stamp can never overlap: natural text width varies by
 * ~15% across the fonts Resvg may resolve (Helvetica locally, DejaVu on the
 * deploy VM), which is exactly what caused the two runs of text to collide.
 * The stamp is split into two <text> elements (bold brand, then date) because
 * Resvg mis-lays-out textLength on a <text> with a mixed-weight tspan,
 * stacking the runs on top of each other.
 * Attribution ends at 8+290=298; the stamp is right-anchored at width-8 and
 * its pinned parts total at most 60+4+111=175, so it never starts left of
 * 512-8-175=329.
 */
const ATTRIBUTION_TEXT = 'radar © RainViewer · © OpenStreetMap contributors © CARTO';
const ATTRIBUTION_TEXT_LENGTH = 290;
const STAMP_BRAND_LENGTH = 60;
const STAMP_GAP = 4;
const STAMP_MAX_DATE_LENGTH = 111;
const STAMP_CHAR_WIDTH = 6;

/** Pinned width of the "· <generated>" run, right-anchored at width-8. */
function stampDateLength(generatedLabel: string): number {
  return Math.min(STAMP_MAX_DATE_LENGTH, (2 + generatedLabel.length) * STAMP_CHAR_WIDTH);
}

/** Data URI for one PNG tile buffer, suitable for an SVG <image> href. */
export function pngTileDataUri(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function tileImages(hrefs: (string | null)[], cols: number, extra = ''): string {
  return hrefs
    .map((href, i) => {
      if (!href) return '';
      const x = (i % cols) * TILE;
      const y = Math.floor(i / cols) * TILE;
      return `<image x="${x}" y="${y}" width="${TILE}" height="${TILE}"${extra} href="${href}"/>`;
    })
    .join('\n    ');
}

/** One radar animation frame: basemap + radar tiles cropped to the window, city marker, timestamp, attribution. */
export function renderRadarFrameSvg(input: RadarFrameSvgInput): string {
  const { width, height, cols, offsetX, offsetY, timeLabel, cityName, generatedLabel } = input;
  const { backdrop, labelsBoost, pillFill, pillOpacity, barFill, barOpacity, text, muted } = (
    input.theme ?? DARK_THEME
  ).radar;
  const cx = width / 2;
  const cy = height / 2;
  const pillWidth = 30 + timeLabel.length * 9;

  const hasLabels = (input.labelImages?.length ?? 0) > 0;
  const boostDefs = hasLabels
    ? `<defs><filter id="labelboost"><feComponentTransfer><feFuncR type="linear" slope="${labelsBoost}"/><feFuncG type="linear" slope="${labelsBoost}"/><feFuncB type="linear" slope="${labelsBoost}"/></feComponentTransfer></filter></defs>
  `
    : '';
  const labelLayer = hasLabels
    ? `<g filter="url(#labelboost)">
    ${tileImages(input.labelImages!, cols)}
    </g>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${boostDefs}<rect width="${width}" height="${height}" fill="${backdrop}"/>
  <g transform="translate(${-offsetX},${-offsetY})">
    ${tileImages(input.basemapImages, cols)}
    ${tileImages(
      input.radarTiles.map((buf) => (buf ? pngTileDataUri(buf) : null)),
      cols,
      ' opacity="0.75"',
    )}
    ${labelLayer}
  </g>
  <circle cx="${cx}" cy="${cy}" r="7" fill="white" stroke="#4b5563" stroke-width="1"/>
  <circle cx="${cx}" cy="${cy}" r="4" fill="#2563eb"/>
  <rect x="12" y="12" width="${pillWidth}" height="30" rx="15" fill="${pillFill}" fill-opacity="${pillOpacity}"/>
  <text x="${12 + pillWidth / 2}" y="33" font-size="15" font-weight="700" fill="${text}" text-anchor="middle" font-family="sans-serif">${escapeXml(timeLabel)}</text>
  <text x="${width - 12}" y="33" font-size="13" fill="${text}" text-anchor="end" font-family="sans-serif">${escapeXml(cityName)}</text>
  <rect x="0" y="${height - 20}" width="${width}" height="20" fill="${barFill}" fill-opacity="${barOpacity}"/>
  <text x="8" y="${height - 6}" font-size="10" fill="${muted}" font-family="sans-serif" textLength="${ATTRIBUTION_TEXT_LENGTH}" lengthAdjust="spacingAndGlyphs">${ATTRIBUTION_TEXT}</text>
  <text x="${width - 8 - stampDateLength(generatedLabel) - STAMP_GAP}" y="${height - 6}" font-size="10" font-weight="700" fill="${muted}" text-anchor="end" font-family="sans-serif" textLength="${STAMP_BRAND_LENGTH}" lengthAdjust="spacingAndGlyphs">atmósfera</text>
  <text x="${width - 8}" y="${height - 6}" font-size="10" fill="${muted}" text-anchor="end" font-family="sans-serif" textLength="${stampDateLength(generatedLabel)}" lengthAdjust="spacingAndGlyphs">· ${escapeXml(generatedLabel)}</text>
</svg>`;
}

export interface RadarGifOptions {
  frameDelayMs?: number;
  lastFrameDelayMs?: number;
}

/**
 * Encode RGBA frames into a looping GIF with a single global palette —
 * per-frame quantization makes the static basemap shimmer between frames
 * and compresses worse.
 */
export function encodeRadarGif(
  frames: Uint8Array[],
  width: number,
  height: number,
  opts: RadarGifOptions = {},
): Uint8Array {
  if (frames.length === 0) throw new Error('encodeRadarGif: no frames');
  const { frameDelayMs = 150, lastFrameDelayMs = 800 } = opts;

  // Sample every 4th pixel of every frame for the shared palette.
  const samplePixels = frames.reduce((n, f) => n + Math.ceil(f.length / 4 / 4), 0);
  const sample = new Uint8Array(samplePixels * 4);
  let offset = 0;
  for (const frame of frames) {
    for (let px = 0; px < frame.length; px += 16) {
      sample.set(frame.subarray(px, px + 4), offset);
      offset += 4;
    }
  }
  const palette = quantize(sample, 256, { format: 'rgb565' });

  const gif = GIFEncoder();
  frames.forEach((frame, i) => {
    const index = applyPalette(frame, palette, 'rgb565');
    gif.writeFrame(index, width, height, {
      palette,
      delay: i === frames.length - 1 ? lastFrameDelayMs : frameDelayMs,
      repeat: 0,
    });
  });
  gif.finish();
  return gif.bytes();
}

export type RadarMode = 'past' | 'nowcast';

/** Where to center the loop; `name` is drawn in the frame's city pill. */
export interface RadarPlace {
  latitude: number;
  longitude: number;
  timezone: string;
  name: string;
}

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
 * friendly outage message. Shared by the bot, apps/public and
 * scripts/radar-smoke.ts.
 *
 * 'nowcast' renders the forecast frames, anchored on the newest past frame so
 * the loop starts at "now" rather than jumping straight into the future.
 */
export async function buildRadarGif(
  city: RadarPlace,
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
      cityName: city.name,
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
