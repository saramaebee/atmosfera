/**
 * Hourly weather variables for one calendar year, aligned by index.
 * Times are in the location's local timezone (Open-Meteo `timezone=auto`).
 */
export interface HourlyYearData {
  time: string[];
  temperature_2m: (number | null)[];
  dew_point_2m: (number | null)[];
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
}

export const CUBE_VERSION = 'v1-gauss';
export const CLIMATOLOGY_START_YEAR = 2011;
export const CLIMATOLOGY_END_YEAR = 2025;
