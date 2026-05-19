/**
 * 9 semantic temperature bands from the spec, mapped to perceptual colors.
 * Each band is [minC, maxC) — minC inclusive, maxC exclusive.
 */

export interface TemperatureBand {
  minC: number;
  maxC: number;
  name: string;
  color: string;
}

export const TEMPERATURE_BANDS: readonly TemperatureBand[] = [
  { minC: -100, maxC: -9, name: 'frigid', color: '#312e81' },
  { minC: -9, maxC: 0, name: 'freezing', color: '#1d4ed8' },
  { minC: 0, maxC: 7, name: 'very cold', color: '#3b82f6' },
  { minC: 7, maxC: 13, name: 'cold', color: '#7dd3fc' },
  { minC: 13, maxC: 18, name: 'cool', color: '#a7f3d0' },
  { minC: 18, maxC: 24, name: 'comfortable', color: '#fef08a' },
  { minC: 24, maxC: 29, name: 'warm', color: '#fb923c' },
  { minC: 29, maxC: 35, name: 'hot', color: '#ef4444' },
  { minC: 35, maxC: 100, name: 'sweltering', color: '#7f1d1d' },
] as const;

export const NA_COLOR = '#e5e7eb';

export function colorForCelsius(t: number): string {
  if (!Number.isFinite(t)) return NA_COLOR;
  for (const band of TEMPERATURE_BANDS) {
    if (t < band.maxC) return band.color;
  }
  return TEMPERATURE_BANDS[TEMPERATURE_BANDS.length - 1]!.color;
}

export function bandForCelsius(t: number): TemperatureBand | null {
  if (!Number.isFinite(t)) return null;
  for (const band of TEMPERATURE_BANDS) {
    if (t < band.maxC) return band;
  }
  return TEMPERATURE_BANDS[TEMPERATURE_BANDS.length - 1] ?? null;
}
