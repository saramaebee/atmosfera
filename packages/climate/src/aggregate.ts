import { MUGGY_SIGMA_DAYS, WETDAY_SIGMA_DAYS, gaussianSmooth1d } from './smoothing';
import {
  CLIMATOLOGY_END_YEAR,
  CLIMATOLOGY_START_YEAR,
  CUBE_VERSION,
  type ClimateCube,
  type HourlyYearData,
} from './types';

const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export function parseLocalTimestamp(ts: string): {
  month: number;
  day: number;
  hour: number;
} {
  // Open-Meteo format: "2024-01-01T00:00"
  const month = Number.parseInt(ts.slice(5, 7), 10);
  const day = Number.parseInt(ts.slice(8, 10), 10);
  const hour = Number.parseInt(ts.slice(11, 13), 10);
  return { month, day, hour };
}

/** 0-based day-of-year, ignoring Feb 29. Returns null for Feb 29. */
export function dayOfYearNoLeap(month: number, day: number): number | null {
  if (month === 2 && day === 29) return null;
  const base = DAYS_BEFORE_MONTH[month - 1];
  if (base === undefined) return null;
  return base + day - 1;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  const weight = index - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function mean(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function makeMatrixOfArrays(): number[][][] {
  const out: number[][][] = new Array(365);
  for (let d = 0; d < 365; d++) {
    const row: number[][] = new Array(24);
    for (let h = 0; h < 24; h++) row[h] = [];
    out[d] = row;
  }
  return out;
}

function reduceMatrix(samples: number[][][], reducer: (vs: number[]) => number): number[][] {
  const out: number[][] = new Array(365);
  for (let d = 0; d < 365; d++) {
    const row: number[] = new Array(24);
    for (let h = 0; h < 24; h++) row[h] = reducer(samples[d]![h]!);
    out[d] = row;
  }
  return out;
}

/** Muggy threshold from spec: dew point ≥ 18°C. */
export const MUGGY_DEWPOINT_C = 18;

/** Wet-day threshold from spec: daily precipitation ≥ 1 mm. */
export const WET_DAY_MM = 1;

export interface AggregateOptions {
  latitude: number;
  longitude: number;
  timezone: string;
  startYear?: number;
  endYear?: number;
}

/**
 * Aggregate a sequence of yearly hourly datasets into a ClimateCube.
 * Pure function — no I/O. The caller provides the year data.
 */
export function aggregateCube(years: HourlyYearData[], opts: AggregateOptions): ClimateCube {
  const startYear = opts.startYear ?? CLIMATOLOGY_START_YEAR;
  const endYear = opts.endYear ?? CLIMATOLOGY_END_YEAR;

  const tempSamples = makeMatrixOfArrays();
  const dewSamples = makeMatrixOfArrays();
  const cloudSamples = makeMatrixOfArrays();

  const wetDayCounts = new Array<number>(365).fill(0);
  const observedYears = new Array<number>(365).fill(0);

  for (const yearData of years) {
    const precipByDay = new Map<number, number>();

    for (let i = 0; i < yearData.time.length; i++) {
      const ts = yearData.time[i]!;
      const { month, day, hour } = parseLocalTimestamp(ts);
      const doy = dayOfYearNoLeap(month, day);
      if (doy === null) continue;

      const t = yearData.temperature_2m[i];
      const dp = yearData.dew_point_2m[i];
      const c = yearData.cloud_cover[i];
      const p = yearData.precipitation[i];

      if (t !== null && t !== undefined) tempSamples[doy]![hour]!.push(t);
      if (dp !== null && dp !== undefined) dewSamples[doy]![hour]!.push(dp);
      if (c !== null && c !== undefined) cloudSamples[doy]![hour]!.push(c);

      const precipVal = p ?? 0;
      precipByDay.set(doy, (precipByDay.get(doy) ?? 0) + precipVal);
    }

    for (const [doy, total] of precipByDay) {
      observedYears[doy] = (observedYears[doy] ?? 0) + 1;
      if (total >= WET_DAY_MM) wetDayCounts[doy] = (wetDayCounts[doy] ?? 0) + 1;
    }
  }

  const temperatureMean = reduceMatrix(tempSamples, mean);
  const temperatureP10 = reduceMatrix(tempSamples, (vs) => percentile(vs, 0.1));
  const temperatureP90 = reduceMatrix(tempSamples, (vs) => percentile(vs, 0.9));
  const dewpointMean = reduceMatrix(dewSamples, mean);
  const cloudcoverMean = reduceMatrix(cloudSamples, mean);

  const muggyProbability = new Array<number>(365);
  for (let d = 0; d < 365; d++) {
    let muggy = 0;
    let total = 0;
    for (let h = 0; h < 24; h++) {
      for (const dp of dewSamples[d]![h]!) {
        total += 1;
        if (dp >= MUGGY_DEWPOINT_C) muggy += 1;
      }
    }
    muggyProbability[d] = total > 0 ? muggy / total : 0;
  }

  const wetDayProbability = new Array<number>(365);
  for (let d = 0; d < 365; d++) {
    const observed = observedYears[d] ?? 0;
    wetDayProbability[d] = observed > 0 ? (wetDayCounts[d] ?? 0) / observed : 0;
  }

  return {
    latitude: opts.latitude,
    longitude: opts.longitude,
    timezone: opts.timezone,
    window: { startYear, endYear },
    version: CUBE_VERSION,
    temperatureMean,
    temperatureP10,
    temperatureP90,
    dewpointMean,
    cloudcoverMean,
    muggyProbability: gaussianSmooth1d(muggyProbability, MUGGY_SIGMA_DAYS),
    wetDayProbability: gaussianSmooth1d(wetDayProbability, WETDAY_SIGMA_DAYS),
  };
}
