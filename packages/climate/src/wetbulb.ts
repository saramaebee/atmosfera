/**
 * Wet-bulb temperature estimation via Stull (2011) — a single-step empirical
 * approximation accurate to ±1°C for the typical range of meteorological
 * conditions (1013 hPa, T −20…50°C, RH 5…99%).
 *
 * Stull, R. (2011). Wet-bulb temperature from relative humidity and air
 * temperature. Journal of Applied Meteorology and Climatology, 50(11),
 * 2267-2269. https://doi.org/10.1175/JAMC-D-11-0143.1
 */
export function wetBulbC(tempC: number, rhPercent: number): number {
  return (
    tempC * Math.atan(0.151977 * Math.sqrt(rhPercent + 8.313659)) +
    Math.atan(tempC + rhPercent) -
    Math.atan(rhPercent - 1.676331) +
    0.00391838 * rhPercent ** 1.5 * Math.atan(0.023101 * rhPercent) -
    4.686035
  );
}

export function cToF(c: number): number {
  return c * 1.8 + 32;
}

export function fToC(f: number): number {
  return (f - 32) / 1.8;
}

export type WetBulbLabel =
  | 'comfortable'
  | 'humid'
  | 'muggy'
  | 'high heat stress'
  | 'dangerous'
  | 'extreme';

export function wetBulbLabel(wbF: number): WetBulbLabel {
  if (wbF < 70) return 'comfortable';
  if (wbF < 75) return 'humid';
  if (wbF < 80) return 'muggy';
  if (wbF < 85) return 'high heat stress';
  if (wbF < 90) return 'dangerous';
  return 'extreme';
}

/** Heat-stress threshold constants in °C (precomputed from 75/80/85°F). */
export const WB_75F_C = fToC(75);
export const WB_80F_C = fToC(80);
export const WB_85F_C = fToC(85);
