export type WeatherIconKey =
  | 'sun'
  | 'moon'
  | 'partly-day'
  | 'partly-night'
  | 'cloud'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunder';

export interface WeatherInfo {
  label: string;
  icon: WeatherIconKey;
}

interface CodeEntry {
  label: string;
  day: WeatherIconKey;
  night: WeatherIconKey;
}

function entry(label: string, day: WeatherIconKey, night: WeatherIconKey = day): CodeEntry {
  return { label, day, night };
}

// WMO weather interpretation codes as documented by Open-Meteo.
const WEATHER_CODES: Record<number, CodeEntry> = {
  0: entry('Clear', 'sun', 'moon'),
  1: entry('Mainly clear', 'sun', 'moon'),
  2: entry('Partly cloudy', 'partly-day', 'partly-night'),
  3: entry('Overcast', 'cloud'),
  45: entry('Fog', 'fog'),
  48: entry('Depositing rime fog', 'fog'),
  51: entry('Light drizzle', 'drizzle'),
  53: entry('Drizzle', 'drizzle'),
  55: entry('Heavy drizzle', 'drizzle'),
  56: entry('Freezing drizzle', 'drizzle'),
  57: entry('Heavy freezing drizzle', 'drizzle'),
  61: entry('Light rain', 'rain'),
  63: entry('Rain', 'rain'),
  65: entry('Heavy rain', 'rain'),
  66: entry('Freezing rain', 'rain'),
  67: entry('Heavy freezing rain', 'rain'),
  71: entry('Light snow', 'snow'),
  73: entry('Snow', 'snow'),
  75: entry('Heavy snow', 'snow'),
  77: entry('Snow grains', 'snow'),
  80: entry('Light rain showers', 'rain'),
  81: entry('Rain showers', 'rain'),
  82: entry('Violent rain showers', 'rain'),
  85: entry('Light snow showers', 'snow'),
  86: entry('Snow showers', 'snow'),
  95: entry('Thunderstorm', 'thunder'),
  96: entry('Thunderstorm with hail', 'thunder'),
  99: entry('Thunderstorm with heavy hail', 'thunder'),
};

// Open-Meteo occasionally emits codes outside the documented set; falling back
// keeps an unmapped code from failing the whole command.
const FALLBACK: CodeEntry = entry('Cloudy', 'cloud');

export function weatherInfo(code: number, isDay: boolean): WeatherInfo {
  const e = WEATHER_CODES[code] ?? FALLBACK;
  return { label: e.label, icon: isDay ? e.day : e.night };
}
