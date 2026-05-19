import { type City, type CityInput, type Db, findAlias, upsertCity } from '@atmosfera/db';
import { type GeocodeCandidate, geocodeResolve } from './index';

export type ResolveResult =
  | { kind: 'resolved'; city: City; via: 'alias' | 'geocoder' }
  | { kind: 'ambiguous'; candidates: GeocodeCandidate[]; query: string }
  | { kind: 'none'; query: string };

export interface ResolveOptions {
  guildId?: string;
  userId?: string;
}

/**
 * Resolve a free-text city query to a stored City row. Layered lookup:
 *   1. aliases (user > guild > global precedence)
 *   2. Open-Meteo geocoder + qualifier parsing + dominance check
 *      - dominant: upsert the city, return resolved
 *      - ambiguous: return candidates for the caller to disambiguate
 *      - none: return none for the caller to error on
 */
export async function resolveCity(
  db: Db,
  query: string,
  options: ResolveOptions = {},
): Promise<ResolveResult> {
  const aliasHit = findAlias(db, { query, ...options });
  if (aliasHit) {
    return { kind: 'resolved', city: aliasHit.city, via: 'alias' };
  }

  const geocoded = await geocodeResolve(query);

  switch (geocoded.kind) {
    case 'none':
      return { kind: 'none', query };
    case 'ambiguous':
      return { kind: 'ambiguous', candidates: geocoded.candidates, query };
    case 'dominant': {
      const city = upsertCity(db, candidateToCityInput(geocoded.candidate));
      return { kind: 'resolved', city, via: 'geocoder' };
    }
  }
}

export function candidateToCityInput(c: GeocodeCandidate): CityInput {
  return {
    canonicalName: c.canonicalName,
    region: c.region,
    country: c.country,
    latitude: c.latitude,
    longitude: c.longitude,
    timezone: c.timezone,
    population: c.population,
    openMeteoId: c.openMeteoId,
  };
}
