import { GIFEncoder, applyPalette, quantize } from 'gifenc';

export const RADAR_GIF_SIZE = 512;

const TEXT = '#111827';
const MUTED = '#4b5563';

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
  radarTiles: (Buffer | null)[];
  timeLabel: string;
  cityName: string;
}

const TILE = 256;

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
  const { width, height, cols, offsetX, offsetY, timeLabel, cityName } = input;
  const cx = width / 2;
  const cy = height / 2;
  const pillWidth = 30 + timeLabel.length * 9;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#e8e8e6"/>
  <g transform="translate(${-offsetX},${-offsetY})">
    ${tileImages(input.basemapImages, cols)}
    ${tileImages(
      input.radarTiles.map((buf) => (buf ? pngTileDataUri(buf) : null)),
      cols,
      ' opacity="0.75"',
    )}
  </g>
  <circle cx="${cx}" cy="${cy}" r="7" fill="white" stroke="${MUTED}" stroke-width="1"/>
  <circle cx="${cx}" cy="${cy}" r="4" fill="#2563eb"/>
  <rect x="12" y="12" width="${pillWidth}" height="30" rx="15" fill="white" fill-opacity="0.85"/>
  <text x="${12 + pillWidth / 2}" y="33" font-size="15" font-weight="700" fill="${TEXT}" text-anchor="middle" font-family="sans-serif">${escapeXml(timeLabel)}</text>
  <text x="${width - 12}" y="33" font-size="13" fill="${TEXT}" text-anchor="end" font-family="sans-serif">${escapeXml(cityName)}</text>
  <rect x="0" y="${height - 20}" width="${width}" height="20" fill="white" fill-opacity="0.8"/>
  <text x="8" y="${height - 6}" font-size="10" fill="${MUTED}" font-family="sans-serif">radar © RainViewer · map © OpenStreetMap contributors © CARTO</text>
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
