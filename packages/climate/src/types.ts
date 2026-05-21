/**
 * Hourly weather variables for one calendar year, aligned by index.
 * Times are in the location's local timezone (Open-Meteo `timezone=auto`).
 */
export interface HourlyYearData {
  time: string[];
  temperature_2m: (number | null)[];
  dew_point_2m: (number | null)[];
  relative_humidity_2m: (number | null)[];
  precipitation: (number | null)[];
  cloud_cover: (number | null)[];
}

/**
 * Daily/hourly climatology aggregated over a window of years.
 * Day axis is 0..364 (Feb 29 dropped); hour axis is 0..23 local.
 */
export interface ClimateCube {
  latitude: number;
  longitude: number;
  timezone: string;
  window: { startYear: number; endYear: number };
  version: string;

  temperatureMean: number[][];
  temperatureP10: number[][];
  temperatureP90: number[][];
  dewpointMean: number[][];
  cloudcoverMean: number[][];

  muggyProbability: number[];
  wetDayProbability: number[];

  /** Mean wet-bulb temperature (°C) per hour-of-year, computed from raw
   * temperature + RH observations across all years in the window. */
  wetBulbMean: number[][];
  /** Mean across years of each year's single hottest hourly wet-bulb (°C). */
  wetBulbAnnualPeakMean: number;
  /** Average hours/year of observations with wet-bulb above 75/80/85°F. */
  wetBulbHoursAbove75F: number;
  wetBulbHoursAbove80F: number;
  wetBulbHoursAbove85F: number;
  /** 0-based month index with the highest mean wet-bulb across all its hours. */
  wetBulbWorstMonthIndex: number;
  wetBulbWorstMonthMean: number;
}

export const CUBE_VERSION = 'v2-wetbulb';
export const CLIMATOLOGY_START_YEAR = 2011;
export const CLIMATOLOGY_END_YEAR = 2025;
