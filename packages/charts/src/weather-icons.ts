import type { WeatherIconKey } from './weather-codes';

const SUN_COLOR = '#f59e0b';
const MOON_COLOR = '#64748b';
const CLOUD_COLOR = '#9ca3af';
const LIGHT_CLOUD_COLOR = '#c7ccd4';
const DARK_CLOUD_COLOR = '#6b7280';
const RAIN_COLOR = '#3b82f6';
const SNOW_COLOR = '#93c5fd';

// All glyphs are drawn on a 24×24 design grid and scaled by the wrapper, so
// the same paths serve the hero icon and the small hourly icons.
const CLOUD_PATH = 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z';
const MOON_PATH = 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z';

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function sunGlyph(cx: number, cy: number, r: number): string {
  const rays: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 1.6);
    const y1 = cy + Math.sin(a) * (r + 1.6);
    const x2 = cx + Math.cos(a) * (r + 3.4);
    const y2 = cy + Math.sin(a) * (r + 3.4);
    rays.push(
      `<line x1="${round2(x1)}" y1="${round2(y1)}" x2="${round2(x2)}" y2="${round2(y2)}" stroke="${SUN_COLOR}" stroke-width="1.8" stroke-linecap="round"/>`,
    );
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${SUN_COLOR}"/>${rays.join('')}`;
}

function cloudGlyph(color: string, transform?: string): string {
  const t = transform ? ` transform="${transform}"` : '';
  return `<path d="${CLOUD_PATH}" fill="${color}"${t}/>`;
}

// Raised cloud leaving y≈16–22 free for precipitation marks.
const PRECIP_CLOUD_TRANSFORM = 'translate(2.4,-2.5) scale(0.8)';

function rainDrops(): string {
  return [8, 12, 16]
    .map(
      (x) =>
        `<line x1="${x + 1}" y1="16.5" x2="${x - 0.5}" y2="21" stroke="${RAIN_COLOR}" stroke-width="1.8" stroke-linecap="round"/>`,
    )
    .join('');
}

function drizzleDots(): string {
  return [8, 12, 16]
    .map(
      (x, i) =>
        `<line x1="${x}" y1="${17 + (i % 2)}" x2="${x}" y2="${18.6 + (i % 2)}" stroke="${RAIN_COLOR}" stroke-width="1.8" stroke-linecap="round"/>`,
    )
    .join('');
}

function snowFlakes(): string {
  return [
    [8, 17.5],
    [12, 20],
    [16, 17.5],
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.2" fill="${SNOW_COLOR}"/>`)
    .join('');
}

const GLYPHS: Record<WeatherIconKey, string> = {
  sun: sunGlyph(12, 12, 5),
  moon: `<path d="${MOON_PATH}" fill="${MOON_COLOR}"/>`,
  'partly-day': `${sunGlyph(8.5, 8, 3.2)}${cloudGlyph(CLOUD_COLOR, 'translate(4.5,4.5) scale(0.82)')}`,
  'partly-night': `<path d="${MOON_PATH}" fill="${MOON_COLOR}" transform="translate(2.5,1.5) scale(0.48)"/>${cloudGlyph(CLOUD_COLOR, 'translate(4.5,4.5) scale(0.82)')}`,
  cloud: cloudGlyph(CLOUD_COLOR),
  fog: `${cloudGlyph(LIGHT_CLOUD_COLOR, 'translate(2.4,-3.5) scale(0.8)')}<line x1="4.5" y1="17.5" x2="19.5" y2="17.5" stroke="${CLOUD_COLOR}" stroke-width="1.8" stroke-linecap="round"/><line x1="6.5" y1="21" x2="17.5" y2="21" stroke="${CLOUD_COLOR}" stroke-width="1.8" stroke-linecap="round"/>`,
  drizzle: `${cloudGlyph(CLOUD_COLOR, PRECIP_CLOUD_TRANSFORM)}${drizzleDots()}`,
  rain: `${cloudGlyph(CLOUD_COLOR, PRECIP_CLOUD_TRANSFORM)}${rainDrops()}`,
  snow: `${cloudGlyph(CLOUD_COLOR, PRECIP_CLOUD_TRANSFORM)}${snowFlakes()}`,
  thunder: `${cloudGlyph(DARK_CLOUD_COLOR, PRECIP_CLOUD_TRANSFORM)}<polygon points="12.5,12 7.5,18 11.5,18 11,22.5 16.5,15.5 12.5,15.5" fill="${SUN_COLOR}"/>`,
};

/**
 * Render one weather glyph as an SVG fragment. (x, y) is the top-left corner
 * of the icon's bounding box; `size` is its rendered width/height in px.
 */
export function weatherIconSvg(key: WeatherIconKey, x: number, y: number, size: number): string {
  return `<g transform="translate(${x},${y}) scale(${round2(size / 24)})">${GLYPHS[key]}</g>`;
}
