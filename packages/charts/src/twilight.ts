import SunCalc from 'suncalc';

/**
 * Per-day night segments at a location. Each segment is [startHour, endHour]
 * within local hours [0, 24], representing time when the sun is below the
 * horizon. Most days have 1 or 2 segments (single night, or pre-dawn + evening).
 * Polar days have 0 segments (alwaysDay); polar nights have 1 spanning [0, 24].
 */
export interface DayTwilight {
  nightSegments: [number, number][];
  alwaysDay: boolean;
  alwaysNight: boolean;
}

// Representative non-leap year inside the climatology window. Day-of-year 0..364 maps here.
const REP_YEAR = 2023;
const DAYS_BEFORE_MONTH_NONLEAP = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

function doyToCalendarDate(doy: number): { month: number; day: number } {
  for (let m = 11; m >= 0; m--) {
    if (doy >= DAYS_BEFORE_MONTH_NONLEAP[m]!) {
      return { month: m, day: doy - DAYS_BEFORE_MONTH_NONLEAP[m]! + 1 };
    }
  }
  return { month: 0, day: 1 };
}

/**
 * Compute the local→UTC offset (in ms) at this calendar date in `timezone`.
 * Done once per day; reused for all 48 samples within that local day.
 */
function offsetMsForDay(
  fmt: Intl.DateTimeFormat,
  year: number,
  month: number,
  day: number,
): number {
  const utcNoon = Date.UTC(year, month, day, 12);
  const parts = fmt.formatToParts(new Date(utcNoon));
  const lY = Number(parts.find((p) => p.type === 'year')?.value ?? year);
  const lM = Number(parts.find((p) => p.type === 'month')?.value ?? month + 1) - 1;
  const lD = Number(parts.find((p) => p.type === 'day')?.value ?? day);
  const lHraw = Number(parts.find((p) => p.type === 'hour')?.value ?? 12);
  const lH = lHraw === 24 ? 0 : lHraw;
  const lMin = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return Date.UTC(year, month, day, 12) - Date.UTC(lY, lM, lD, lH, lMin);
}

const SAMPLES_PER_HOUR = 2;
const SAMPLES = 24 * SAMPLES_PER_HOUR;

export function computeTwilightYear(
  latitude: number,
  longitude: number,
  timezone: string,
): DayTwilight[] {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const out: DayTwilight[] = new Array(365);

  for (let doy = 0; doy < 365; doy++) {
    const { month, day } = doyToCalendarDate(doy);
    const offsetMs = offsetMsForDay(fmt, REP_YEAR, month, day);

    const isBelow = new Array<boolean>(SAMPLES);
    let above = 0;
    let below = 0;

    for (let s = 0; s < SAMPLES; s++) {
      const hour = s / SAMPLES_PER_HOUR;
      const localUtcRaw = Date.UTC(REP_YEAR, month, day, Math.floor(hour), (hour % 1) * 60);
      const utc = new Date(localUtcRaw + offsetMs);
      const alt = SunCalc.getPosition(utc, latitude, longitude).altitude;
      const isDark = alt <= 0;
      isBelow[s] = isDark;
      if (isDark) below++;
      else above++;
    }

    if (above === 0) {
      out[doy] = { nightSegments: [[0, 24]], alwaysDay: false, alwaysNight: true };
      continue;
    }
    if (below === 0) {
      out[doy] = { nightSegments: [], alwaysDay: true, alwaysNight: false };
      continue;
    }

    const segments: [number, number][] = [];
    let segStart: number | null = null;
    for (let s = 0; s < SAMPLES; s++) {
      const dark = isBelow[s]!;
      if (dark && segStart === null) segStart = s;
      else if (!dark && segStart !== null) {
        segments.push([segStart / SAMPLES_PER_HOUR, s / SAMPLES_PER_HOUR]);
        segStart = null;
      }
    }
    if (segStart !== null) segments.push([segStart / SAMPLES_PER_HOUR, 24]);

    out[doy] = { nightSegments: segments, alwaysDay: false, alwaysNight: false };
  }
  return out;
}

/** Total dark hours in a day's local 24-hour window. */
export function darkHours(tw: DayTwilight): number {
  if (tw.alwaysNight) return 24;
  if (tw.alwaysDay) return 0;
  let sum = 0;
  for (const [a, b] of tw.nightSegments) sum += b - a;
  return sum;
}
