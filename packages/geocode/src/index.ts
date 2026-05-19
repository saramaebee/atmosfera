import { z } from 'zod';
import { matchesQualifier, parseQuery } from './qualifiers';

export { parseQuery, matchesQualifier } from './qualifiers';
export type { ParsedQuery } from './qualifiers';
export { resolveCity, candidateToCityInput } from './resolve';
export type { ResolveResult, ResolveOptions } from './resolve';

export interface GeocodeCandidate {
  source: 'open-meteo';
  canonicalName: string;
  region: string | null;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  population: number | null;
  openMeteoId: number | null;
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
    openMeteoId: r.id,
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

// ----- resolution -----

/**
 * Result of trying to resolve a user query to a single city.
 * - `dominant`: pick this and proceed.
 * - `ambiguous`: caller should disambiguate (Discord menu in Phase 4D; CLI errors).
 * - `none`: no candidate matched (after qualifier filtering, if any).
 */
export type GeocodeResolution =
  | { kind: 'dominant'; candidate: GeocodeCandidate }
  | { kind: 'ambiguous'; candidates: GeocodeCandidate[]; query: string }
  | { kind: 'none'; query: string };

const DOMINANCE_POPULATION_RATIO = 5;
const DOMINANCE_MIN_POPULATION = 100_000;
const MAX_AMBIGUOUS_CANDIDATES = 5;

/**
 * Apply dominance heuristics to a candidate list. If a qualifier filtered out
 * everything but one, that's dominant. Otherwise look at population: top must
 * be >=100k AND >=5x the runner-up.
 */
export function classifyCandidates(
  candidates: GeocodeCandidate[],
  query: string,
): GeocodeResolution {
  if (candidates.length === 0) return { kind: 'none', query };
  if (candidates.length === 1) return { kind: 'dominant', candidate: candidates[0]! };

  const top = candidates[0]!;
  const second = candidates[1]!;
  const topPop = top.population ?? 0;
  const secondPop = second.population ?? 0;

  if (topPop >= DOMINANCE_MIN_POPULATION && topPop >= DOMINANCE_POPULATION_RATIO * secondPop) {
    return { kind: 'dominant', candidate: top };
  }

  return {
    kind: 'ambiguous',
    candidates: candidates.slice(0, MAX_AMBIGUOUS_CANDIDATES),
    query,
  };
}

/**
 * Geocode + qualifier filtering + dominance classification in one call.
 * The HTTP-free unit of work is `classifyCandidates`; this wrapper hits Open-Meteo.
 */
export async function geocodeResolve(query: string): Promise<GeocodeResolution> {
  const { name, qualifier } = parseQuery(query);
  if (name === '') return { kind: 'none', query };

  const all = await geocodeCity(name);
  const filtered = qualifier
    ? all.filter((c) => matchesQualifier({ country: c.country, region: c.region }, qualifier))
    : all;

  return classifyCandidates(filtered, query);
}
