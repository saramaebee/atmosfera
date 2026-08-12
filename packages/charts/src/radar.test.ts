import { describe, expect, it } from 'bun:test';
import {
  encodeRadarGif,
  formatFrameTime,
  formatGeneratedStamp,
  pngTileDataUri,
  renderRadarFrameSvg,
} from './radar';
import { svgToRgba } from './raster';

// Smallest valid PNG (1x1 transparent), enough for data-URI embedding tests.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function frameInput(overrides: Partial<Parameters<typeof renderRadarFrameSvg>[0]> = {}) {
  return {
    width: 512,
    height: 512,
    cols: 3,
    rows: 3,
    offsetX: 100.5,
    offsetY: 42.25,
    basemapImages: Array.from({ length: 9 }, () => pngTileDataUri(TINY_PNG)),
    radarTiles: Array.from({ length: 9 }, () => TINY_PNG),
    timeLabel: '2:30 PM',
    cityName: 'Miami, Florida, United States',
    generatedLabel: 'Aug 12, 2:35 PM',
    ...overrides,
  };
}

describe('formatFrameTime', () => {
  // 2026-08-12T14:30:00Z
  const t = 1786545000;

  it('formats in the given timezone', () => {
    expect(formatFrameTime(t, 'America/New_York')).toBe('10:30 AM');
    expect(formatFrameTime(t, 'Asia/Tokyo')).toBe('11:30 PM');
    expect(formatFrameTime(t, 'UTC')).toBe('2:30 PM');
  });

  it('respects DST boundaries', () => {
    // 2026-01-12T14:30:00Z — EST (UTC-5) instead of EDT (UTC-4).
    expect(formatFrameTime(1768228200, 'America/New_York')).toBe('9:30 AM');
  });
});

describe('formatGeneratedStamp', () => {
  // 2026-08-12T14:30:00Z
  const t = 1786545000_000;

  it('formats date + time in the given timezone', () => {
    expect(formatGeneratedStamp(t, 'America/New_York')).toBe('Aug 12, 10:30 AM');
    expect(formatGeneratedStamp(t, 'UTC')).toBe('Aug 12, 2:30 PM');
  });

  it('rolls the date across the antimeridian-adjacent timezones', () => {
    // 14:30 UTC is already Aug 13 in Auckland (UTC+12).
    expect(formatGeneratedStamp(t, 'Pacific/Auckland')).toBe('Aug 13, 2:30 AM');
  });
});

describe('pngTileDataUri', () => {
  it('encodes a buffer as a PNG data URI', () => {
    expect(pngTileDataUri(TINY_PNG)).toBe(`data:image/png;base64,${TINY_PNG.toString('base64')}`);
  });
});

describe('renderRadarFrameSvg', () => {
  it('embeds tiles as data URIs with the crop translate', () => {
    const svg = renderRadarFrameSvg(frameInput());
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('translate(-100.5,-42.25)');
    expect(svg.match(/data:image\/png;base64,/g)).toHaveLength(18);
    expect(svg.match(/opacity="0.75"/g)).toHaveLength(9);
    expect(svg).toContain('2:30 PM');
    expect(svg).toContain('Miami, Florida, United States');
    expect(svg).toContain('radar © RainViewer · map © OpenStreetMap contributors © CARTO');
    expect(svg).toContain('<tspan font-weight="700">atmósfera</tspan> · Aug 12, 2:35 PM');
    // City marker at the window center.
    expect(svg).toContain('<circle cx="256" cy="256" r="4" fill="#2563eb"/>');
  });

  it('omits null tiles instead of rendering broken images', () => {
    const svg = renderRadarFrameSvg(
      frameInput({
        basemapImages: [null, ...Array.from({ length: 8 }, () => pngTileDataUri(TINY_PNG))],
        radarTiles: Array.from({ length: 9 }, () => null),
      }),
    );
    expect(svg.match(/data:image\/png;base64,/g)).toHaveLength(8);
    expect(svg).not.toContain('opacity="0.75"');
  });

  it('positions tiles on the 256px grid', () => {
    const svg = renderRadarFrameSvg(frameInput());
    expect(svg).toContain('<image x="0" y="0"');
    expect(svg).toContain('<image x="512" y="512"');
  });

  it('rasterizes without throwing', () => {
    const { pixels, width, height } = svgToRgba(renderRadarFrameSvg(frameInput()));
    expect(width).toBe(512);
    expect(height).toBe(512);
    expect(pixels.length).toBe(512 * 512 * 4);
  });
});

describe('encodeRadarGif', () => {
  it('encodes synthetic frames into a looping GIF', () => {
    const size = 16;
    const makeFrame = (r: number) => {
      const f = new Uint8Array(size * size * 4);
      for (let i = 0; i < f.length; i += 4) {
        f[i] = r;
        f[i + 1] = 128;
        f[i + 2] = 255 - r;
        f[i + 3] = 255;
      }
      return f;
    };
    const gif = encodeRadarGif([makeFrame(0), makeFrame(200)], size, size);
    expect(gif.length).toBeGreaterThan(0);
    expect(Buffer.from(gif.subarray(0, 6)).toString('ascii')).toBe('GIF89a');
  });

  it('throws on an empty frame list', () => {
    expect(() => encodeRadarGif([], 16, 16)).toThrow('no frames');
  });
});
