import { z } from 'zod';

export interface GeocodeCandidate {
  source: 'open-meteo';
  canonicalName: string;
  region: string | null;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  population: number | null;
}

const openMeteoResultSchema = z.object({
  id: z.number(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  country: z.string(),
  admin1: z.string().optional(),
  timezone: z.string(),
  population: z.number().optional(),
});

const openMeteoResponseSchema = z.object({
  results: z.array(openMeteoResultSchema).optional(),
});

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

export async function geocodeCity(query: string): Promise<GeocodeCandidate[]> {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set('name', query);
  url.searchParams.set('count', '10');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo geocoding failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const parsed = openMeteoResponseSchema.parse(json);
  const results = parsed.results ?? [];

  return results.map((r) => ({
    source: 'open-meteo' as const,
    canonicalName: r.name,
    region: r.admin1 ?? null,
    country: r.country,
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone,
    population: r.population ?? null,
  }));
}

export async function geocodeTop(query: string): Promise<GeocodeCandidate> {
  const candidates = await geocodeCity(query);
  const top = candidates[0];
  if (!top) {
    throw new Error(`No geocoding results for "${query}"`);
  }
  return top;
}

export function formatCandidate(c: GeocodeCandidate): string {
  const parts = [c.canonicalName];
  if (c.region) parts.push(c.region);
  parts.push(c.country);
  return parts.join(', ');
}
