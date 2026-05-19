export type ChartOrientation = 'calendar' | 'austral';

const CALENDAR_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const CALENDAR_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
// Austral: rotate to start at July (calendar month index 6).
const AUSTRAL_DAY_OFFSET = CALENDAR_STARTS[6]!;

function rotated<T>(arr: T[], n: number): T[] {
  return arr.slice(n).concat(arr.slice(0, n));
}

function cumulativeStarts(lengths: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const len of lengths) {
    out.push(acc);
    acc += len;
  }
  return out;
}

export interface MonthAxis {
  /** Month label in rendered (left-to-right) order. */
  labels: string[];
  /** Day-of-render where each labeled month starts (0..364). */
  starts: number[];
  /** Width of each month in days (matches `labels` order). */
  lengths: number[];
  /** Offset added to rendered column to read from cube's calendar-indexed arrays. */
  dayOffset: number;
}

const CALENDAR_AXIS: MonthAxis = {
  labels: CALENDAR_MONTHS,
  starts: CALENDAR_STARTS,
  lengths: MONTH_LENGTHS,
  dayOffset: 0,
};

const AUSTRAL_AXIS: MonthAxis = {
  labels: rotated(CALENDAR_MONTHS, 6),
  starts: cumulativeStarts(rotated(MONTH_LENGTHS, 6)),
  lengths: rotated(MONTH_LENGTHS, 6),
  dayOffset: AUSTRAL_DAY_OFFSET,
};

export function monthAxis(orientation: ChartOrientation): MonthAxis {
  return orientation === 'austral' ? AUSTRAL_AXIS : CALENDAR_AXIS;
}

/**
 * Cities outside the tropics in the southern hemisphere render on an axis
 * rotated 6 months so summer sits in the middle of the chart. Tropical
 * latitudes (|lat| ≤ 15°) have weak seasonality, so we leave them on the
 * calendar axis to avoid a confusing relabeled chart for little visual gain.
 */
export function orientationForLatitude(lat: number): ChartOrientation {
  return lat < -15 ? 'austral' : 'calendar';
}
