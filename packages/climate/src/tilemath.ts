/**
 * Web-Mercator slippy-map tile math for the radar viewport.
 *
 * RainViewer and CARTO both serve standard XYZ tiles; RainViewer documents
 * z ≤ 7, so the radar view is pinned there. All math is in "world pixels":
 * the whole world at zoom z is a square of 2^z * 256 pixels.
 */

export const TILE_SIZE = 256;
export const RADAR_ZOOM = 7;

export interface TileRef {
  /** Tile column, wrapped into [0, 2^z) across the antimeridian. */
  x: number;
  /** Tile row, or null when the viewport extends past the mercator poles. */
  y: number | null;
  /** Position of this tile within the viewport grid. */
  col: number;
  row: number;
}

export interface RadarViewport {
  zoom: number;
  width: number;
  height: number;
  /** Row-major grid of tiles covering the window. */
  tiles: TileRef[];
  cols: number;
  rows: number;
  /** Crop offset: the window's top-left within the first tile, in [0, 256). */
  offsetX: number;
  offsetY: number;
}

/** Fractional world-pixel coordinates of a lon/lat at zoom z. */
export function worldPx(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z * TILE_SIZE;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

/**
 * Compute the tile grid covering a width×height pixel window centered on a
 * city. Tile X wraps across the antimeridian; tile Y past the poles is null
 * (callers render those slots blank).
 */
export function radarViewport(
  lat: number,
  lon: number,
  z = RADAR_ZOOM,
  width = 512,
  height = 512,
): RadarViewport {
  const tileCount = 2 ** z;
  const { x: cx, y: cy } = worldPx(lon, lat, z);
  const left = cx - width / 2;
  const top = cy - height / 2;

  const tx0 = Math.floor(left / TILE_SIZE);
  const ty0 = Math.floor(top / TILE_SIZE);
  const cols = Math.ceil((left + width) / TILE_SIZE) - tx0;
  const rows = Math.ceil((top + height) / TILE_SIZE) - ty0;

  const tiles: TileRef[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const ty = ty0 + row;
      tiles.push({
        x: (((tx0 + col) % tileCount) + tileCount) % tileCount,
        y: ty >= 0 && ty < tileCount ? ty : null,
        col,
        row,
      });
    }
  }

  return {
    zoom: z,
    width,
    height,
    tiles,
    cols,
    rows,
    offsetX: left - tx0 * TILE_SIZE,
    offsetY: top - ty0 * TILE_SIZE,
  };
}
