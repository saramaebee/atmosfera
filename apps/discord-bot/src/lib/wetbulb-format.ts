import { type ClimateCube, cToF, wetBulbLabel } from '@atmosfera/climate';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function monthName(idx: number): string {
  return MONTH_NAMES[idx] ?? '—';
}

export function formatWetBulbDual(wbC: number): string {
  if (!Number.isFinite(wbC)) return 'n/a';
  return `${wbC.toFixed(1)}°C / ${Math.round(cToF(wbC))}°F`;
}

export function formatWetBulbWithLabel(wbC: number): string {
  if (!Number.isFinite(wbC)) return 'n/a';
  return `${formatWetBulbDual(wbC)} · ${wetBulbLabel(cToF(wbC))}`;
}

/** Mean wet-bulb across afternoon hours of hemisphere-appropriate summer
 * months. NH summer = JJA, SH summer = DJF. Afternoon = 14:00–17:00 local. */
export function summerAfternoonWetBulbC(cube: ClimateCube): number {
  const summerMonths = cube.latitude >= 0 ? [5, 6, 7] : [11, 0, 1];
  const hours = [14, 15, 16, 17];
  let sum = 0;
  let count = 0;
  for (const m of summerMonths) {
    const base = DAYS_BEFORE_MONTH[m]!;
    const len = MONTH_LENGTHS[m]!;
    for (let d = 0; d < len; d++) {
      const doy = base + d;
      if (doy >= 365) continue;
      for (const h of hours) {
        const v = cube.wetBulbMean[doy]?.[h];
        if (v !== undefined && Number.isFinite(v)) {
          sum += v;
          count += 1;
        }
      }
    }
  }
  return count > 0 ? sum / count : Number.NaN;
}

export function wetBulbTakeaway(annualPeakWbC: number): string {
  if (!Number.isFinite(annualPeakWbC)) {
    return 'Not enough humidity data to estimate heat stress for this location.';
  }
  const label = wetBulbLabel(cToF(annualPeakWbC));
  switch (label) {
    case 'comfortable':
      return 'Humidity is essentially never the limiting factor here — sweat cooling works year-round.';
    case 'humid':
      return 'Humidity is rarely a real heat-stress factor; even peak hours stay comfortable for cooling.';
    case 'muggy':
      return 'Peak hours get oppressively humid, but stay below medical heat-stress thresholds.';
    case 'high heat stress':
      return 'Several afternoons each year push into the range where outdoor exertion becomes risky.';
    case 'dangerous':
      return 'Annual peaks reach humid-heat conditions that strain the body — sweat cooling starts to fail.';
    case 'extreme':
      return 'Annual peaks approach the limits of human physiological tolerance for humid heat.';
  }
}
