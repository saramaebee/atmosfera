import { describe, expect, it } from 'bun:test';
import { RADAR_ZOOM, TILE_SIZE, radarViewport, worldPx } from './tilemath';

/** Invert worldPx: world-pixel coords at zoom z back to lon/lat. */
function unproject(x: number, y: number, z: number): { lon: number; lat: number } {
  const n = 2 ** z * TILE_SIZE;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lon, lat };
}

describe('worldPx', () => {
  it('maps the null island to the world center at z7', () => {
    expect(worldPx(0, 0, 7)).toEqual({ x: 16384, y: 16384 });
  });

  it('matches hand-computed values for London at z7', () => {
    const { x, y } = worldPx(-0.1278, 51.5074, 7);
    expect(x).toBeCloseTo(16372.36736, 4);
    expect(y).toBeCloseTo(10896.196325, 4);
  });
});

describe('radarViewport', () => {
  it('centers the window exactly on the city (round-trip)', () => {
    const lat = 25.7617;
    const lon = -80.1918;
    const vp = radarViewport(lat, lon);
    // Reconstruct the window center from the first tile + crop offset. The
    // first tile's x is unwrapped here (Miami is nowhere near the antimeridian).
    const cx = vp.tiles[0]!.x * TILE_SIZE + vp.offsetX + vp.width / 2;
    const cy = vp.tiles[0]!.y! * TILE_SIZE + vp.offsetY + vp.height / 2;
    const back = unproject(cx, cy, vp.zoom);
    expect(back.lon).toBeCloseTo(lon, 6);
    expect(back.lat).toBeCloseTo(lat, 6);
  });

  it('produces a 3x3 grid with in-range offsets for a typical city', () => {
    const vp = radarViewport(51.5074, -0.1278);
    expect(vp.zoom).toBe(RADAR_ZOOM);
    expect(vp.cols).toBe(3);
    expect(vp.rows).toBe(3);
    expect(vp.tiles).toHaveLength(9);
    expect(vp.offsetX).toBeGreaterThanOrEqual(0);
    expect(vp.offsetX).toBeLessThan(TILE_SIZE);
    expect(vp.offsetY).toBeGreaterThanOrEqual(0);
    expect(vp.offsetY).toBeLessThan(TILE_SIZE);
    // Row-major ordering with col/row indices.
    expect(vp.tiles[0]).toMatchObject({ col: 0, row: 0 });
    expect(vp.tiles[8]).toMatchObject({ col: 2, row: 2 });
    // Consecutive columns are consecutive tile Xs.
    expect(vp.tiles[1]!.x).toBe(vp.tiles[0]!.x + 1);
  });

  it('shrinks to 2 columns/rows when the window is tile-aligned', () => {
    // (0, 0) at z7 sits exactly on a tile corner: left = 16128 = 63 * 256.
    const vp = radarViewport(0, 0);
    expect(vp.cols).toBe(2);
    expect(vp.rows).toBe(2);
    expect(vp.offsetX).toBe(0);
    expect(vp.offsetY).toBe(0);
  });

  it('wraps tile X across the antimeridian', () => {
    const vp = radarViewport(-18.1416, 179.9);
    const xs = vp.tiles.filter((t) => t.row === 0).map((t) => t.x);
    expect(xs).toContain(127);
    expect(xs).toContain(0);
    for (const t of vp.tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(2 ** vp.zoom);
    }
  });

  it('marks rows past the mercator pole as null instead of clamping', () => {
    // lat 85: window top is ~-200 world px, above the top of the map.
    const vp = radarViewport(85, 0);
    const topRow = vp.tiles.filter((t) => t.row === 0);
    expect(topRow.every((t) => t.y === null)).toBe(true);
    const bottomRow = vp.tiles.filter((t) => t.row === vp.rows - 1);
    expect(bottomRow.every((t) => t.y !== null)).toBe(true);
  });
});
