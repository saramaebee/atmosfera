import { type ForecastNow, type UpcomingHour, cToF } from '@atmosfera/climate';
import { type ChartTheme, DARK_THEME } from './theme';
import { weatherInfo } from './weather-codes';
import { weatherIconSvg } from './weather-icons';

export interface NowCardHourEntry {
  /** Local ISO timestamp, e.g. "2026-08-08T17:00". */
  timeIso: string;
  tempC: number;
  weatherCode: number;
  isDay: boolean;
}

export interface NowCardInput {
  cityName: string;
  current: {
    /** Local ISO timestamp; may have sub-hour granularity ("…T14:15"). */
    timeIso: string;
    tempC: number;
    weatherCode: number;
    isDay: boolean;
    humidityPct: number;
    windSpeedKmh: number;
    windDirectionDeg: number;
  };
  upcoming: NowCardHourEntry[];
}

export const NOW_CARD_WIDTH = 900;
const HEIGHT = 448;
const PAD = 40;

const COMPASS_POINTS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

export function compassPoint(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360;
  return COMPASS_POINTS[Math.round(normalized / 22.5) % 16]!;
}

export function hourLabel(iso: string): string {
  const hour = Number.parseInt(iso.slice(11, 13), 10);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function weekdayName(iso: string): string {
  const year = Number.parseInt(iso.slice(0, 4), 10);
  const month = Number.parseInt(iso.slice(5, 7), 10);
  const day = Number.parseInt(iso.slice(8, 10), 10);
  return WEEKDAYS[new Date(year, month - 1, day).getDay()]!;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function nowCardInputFromForecast(
  cityName: string,
  forecast: ForecastNow,
  upcoming: UpcomingHour[],
): NowCardInput {
  return {
    cityName,
    current: {
      timeIso: forecast.current.time,
      tempC: forecast.current.temperature_2m,
      weatherCode: forecast.current.weather_code,
      isDay: forecast.current.is_day === 1,
      humidityPct: forecast.current.relative_humidity_2m,
      windSpeedKmh: forecast.current.wind_speed_10m,
      windDirectionDeg: forecast.current.wind_direction_10m,
    },
    upcoming: upcoming.map((h) => ({
      timeIso: h.time,
      tempC: h.tempC,
      weatherCode: h.weatherCode,
      isDay: h.isDay,
    })),
  };
}

export function renderNowCardSvg(input: NowCardInput, theme: ChartTheme = DARK_THEME): string {
  const { current, upcoming } = input;
  const info = weatherInfo(current.weatherCode, current.isDay);
  const innerWidth = NOW_CARD_WIDTH - PAD * 2;
  const TEXT = theme.text;
  const MUTED = theme.muted;
  const DIVIDER = theme.divider;

  // Header: condition + city top-left, weekday · time top-right.
  const header = `
  <text x="${PAD}" y="58" font-size="24" font-weight="700" fill="${TEXT}" font-family="sans-serif">${escapeXml(info.label)}</text>
  <text x="${PAD}" y="84" font-size="15" fill="${MUTED}" font-family="sans-serif">${escapeXml(input.cityName)}</text>
  <text x="${NOW_CARD_WIDTH - PAD}" y="58" font-size="13" fill="${MUTED}" text-anchor="end" font-family="sans-serif">${weekdayName(current.timeIso)} · ${hourLabel(current.timeIso)}</text>`;

  // Hero: 96px icon + big dual-unit current temperature.
  const tempC = Math.round(current.tempC);
  const tempF = Math.round(cToF(current.tempC));
  const hero = `
  ${weatherIconSvg(info.icon, PAD, 116, 96, theme.name)}
  <text x="164" y="182" font-family="sans-serif"><tspan font-size="56" font-weight="700" fill="${TEXT}">${tempC}°C</tspan><tspan font-size="26" fill="${MUTED}" dx="10">/ ${tempF}°F</tspan></text>`;

  // Hourly strip: 7 equal columns.
  const colWidth = innerWidth / Math.max(upcoming.length, 1);
  const strip = upcoming
    .map((h, i) => {
      const cx = PAD + colWidth * (i + 0.5);
      const hourly = weatherInfo(h.weatherCode, h.isDay);
      const c = Math.round(h.tempC);
      const f = Math.round(cToF(h.tempC));
      return `
  <text x="${cx.toFixed(2)}" y="262" font-size="13" fill="${MUTED}" text-anchor="middle" font-family="sans-serif">${hourLabel(h.timeIso)}</text>
  ${weatherIconSvg(hourly.icon, cx - 20, 274, 40, theme.name)}
  <text x="${cx.toFixed(2)}" y="344" font-size="20" font-weight="700" fill="${TEXT}" text-anchor="middle" font-family="sans-serif">${c}°</text>
  <text x="${cx.toFixed(2)}" y="362" font-size="12" fill="${MUTED}" text-anchor="middle" font-family="sans-serif">${f}°F</text>`;
    })
    .join('');

  const footer = `
  <line x1="${PAD}" y1="392" x2="${NOW_CARD_WIDTH - PAD}" y2="392" stroke="${DIVIDER}" stroke-width="1"/>
  <text x="${PAD}" y="424" font-size="14" fill="${MUTED}" font-family="sans-serif">Humidity ${Math.round(current.humidityPct)}%</text>
  <text x="${NOW_CARD_WIDTH - PAD}" y="424" font-size="14" fill="${MUTED}" text-anchor="end" font-family="sans-serif">Wind ${Math.round(current.windSpeedKmh)} km/h ${compassPoint(current.windDirectionDeg)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${NOW_CARD_WIDTH}" height="${HEIGHT}" viewBox="0 0 ${NOW_CARD_WIDTH} ${HEIGHT}">
  <rect width="${NOW_CARD_WIDTH}" height="${HEIGHT}" fill="${theme.bg}"/>${header}${hero}${strip}${footer}
</svg>`;
}
