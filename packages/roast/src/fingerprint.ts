import type { ClimateCube } from '@atmosfera/climate';
import type { City } from '@atmosfera/db';
import type { ClimateFingerprint, Contrast } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

function monthDayFromDoy(doy: number): string {
  for (let m = 11; m >= 0; m--) {
    if (doy >= MONTH_STARTS[m]!) return `${MONTHS[m]} ${doy - MONTH_STARTS[m]! + 1}`;
  }
  return '';
}

function argMax(arr: number[]): { index: number; value: number } {
  let i = 0;
  let v = arr[0] ?? 0;
  for (let j = 1; j < arr.length; j++) {
    if (arr[j]! > v) {
      v = arr[j]!;
      i = j;
    }
  }
  return { index: i, value: v };
}

function argMin(arr: number[]): { index: number; value: number } {
  let i = 0;
  let v = arr[0] ?? 0;
  for (let j = 1; j < arr.length; j++) {
    if (arr[j]! < v) {
      v = arr[j]!;
      i = j;
    }
  }
  return { index: i, value: v };
}

function dailyMean(matrix: number[][]): number[] {
  return matrix.map((row) => {
    let s = 0;
    for (const v of row) s += v;
    return s / row.length;
  });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function extractFingerprint(city: City, cube: ClimateCube): ClimateFingerprint {
  const dailyMeanT = dailyMean(cube.temperatureMean);
  const hot = argMax(dailyMeanT);
  const cold = argMin(dailyMeanT);
  const muggy = argMax(cube.muggyProbability);
  const wet = argMax(cube.wetDayProbability);

  let above35 = 0;
  let below0 = 0;
  let annualSum = 0;
  for (let d = 0; d < 365; d++) {
    annualSum += dailyMeanT[d]!;
    const row = cube.temperatureMean[d]!;
    let anyAbove35 = false;
    let anyBelow0 = false;
    for (let h = 0; h < 24; h++) {
      const t = row[h]!;
      if (t > 35) anyAbove35 = true;
      if (t < 0) anyBelow0 = true;
    }
    if (anyAbove35) above35++;
    if (anyBelow0) below0++;
  }

  const wetDaysPerYear = cube.wetDayProbability.reduce((s, v) => s + v, 0);
  const muggyHoursPerYear = cube.muggyProbability.reduce((s, v) => s + v, 0) * 24;

  return {
    cityName: city.canonicalName,
    region: city.region,
    country: city.country,
    peakMuggyDay: {
      doy: muggy.index,
      monthDay: monthDayFromDoy(muggy.index),
      probability: round1(muggy.value * 100) / 100,
    },
    peakWetDay: {
      doy: wet.index,
      monthDay: monthDayFromDoy(wet.index),
      probability: round1(wet.value * 100) / 100,
    },
    hottestDay: {
      doy: hot.index,
      monthDay: monthDayFromDoy(hot.index),
      meanC: round1(hot.value),
    },
    coldestDay: {
      doy: cold.index,
      monthDay: monthDayFromDoy(cold.index),
      meanC: round1(cold.value),
    },
    annualMeanC: round1(annualSum / 365),
    annualAmplitudeC: round1(hot.value - cold.value),
    daysAbove35C: above35,
    daysBelow0C: below0,
    wetDaysPerYear: Math.round(wetDaysPerYear),
    muggyHoursPerYear: Math.round(muggyHoursPerYear),
  };
}

export function extractContrast(a: ClimateFingerprint, b: ClimateFingerprint): Contrast {
  return {
    tempDeltaAnnualC: round1(Math.abs(a.annualMeanC - b.annualMeanC)),
    tempDeltaSummerC: round1(Math.abs(a.hottestDay.meanC - b.hottestDay.meanC)),
    tempDeltaWinterC: round1(Math.abs(a.coldestDay.meanC - b.coldestDay.meanC)),
    muggyDeltaPctPeak:
      round1(Math.abs(a.peakMuggyDay.probability - b.peakMuggyDay.probability) * 100) / 100,
    amplitudeRatio: round1(
      Math.max(a.annualAmplitudeC, b.annualAmplitudeC) /
        Math.max(0.1, Math.min(a.annualAmplitudeC, b.annualAmplitudeC)),
    ),
    wetDaysDelta: Math.abs(a.wetDaysPerYear - b.wetDaysPerYear),
  };
}
