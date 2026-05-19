import { and, eq } from 'drizzle-orm';
import type { Db } from './client';
import { type Alias, type AliasScope, type City, aliases, cities } from './schema';

/**
 * Pure city input — decoupled from any external SDK type so packages/db doesn't
 * depend on packages/geocode. The orchestration layer maps GeocodeCandidate → CityInput.
 */
export interface CityInput {
  canonicalName: string;
  region: string | null;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  population: number | null;
  openMeteoId: number | null;
}

export function upsertCity(db: Db, input: CityInput): City {
  if (input.openMeteoId !== null) {
    const byOpenMeteoId = db
      .select()
      .from(cities)
      .where(eq(cities.openMeteoId, input.openMeteoId))
      .get();
    if (byOpenMeteoId) return byOpenMeteoId;
  }

  const byLatLon = db
    .select()
    .from(cities)
    .where(and(eq(cities.latitude, input.latitude), eq(cities.longitude, input.longitude)))
    .get();
  if (byLatLon) return byLatLon;

  const inserted = db
    .insert(cities)
    .values({
      canonicalName: input.canonicalName,
      region: input.region,
      country: input.country,
      latitude: input.latitude,
      longitude: input.longitude,
      timezone: input.timezone,
      population: input.population,
      openMeteoId: input.openMeteoId,
      createdAt: new Date(),
    })
    .returning()
    .get();

  if (!inserted) throw new Error('upsertCity: insert returned no row');
  return inserted;
}

export function findCityById(db: Db, id: number): City | null {
  return db.select().from(cities).where(eq(cities.id, id)).get() ?? null;
}

// ----- aliases -----

export interface AliasLookup {
  query: string;
  guildId?: string | null;
  userId?: string | null;
}

export interface AliasHit {
  alias: Alias;
  city: City;
}

/** Scope precedence: user > guild > global. First hit wins. */
export function findAlias(db: Db, lookup: AliasLookup): AliasHit | null {
  const query = normalizeQuery(lookup.query);
  const guildId = lookup.guildId ?? '';
  const userId = lookup.userId ?? '';

  // user scope
  if (userId !== '') {
    const hit = lookupAlias(db, query, 'user', '', userId);
    if (hit) return hit;
  }
  // guild scope
  if (guildId !== '') {
    const hit = lookupAlias(db, query, 'guild', guildId, '');
    if (hit) return hit;
  }
  // global scope
  return lookupAlias(db, query, 'global', '', '');
}

function lookupAlias(
  db: Db,
  query: string,
  scope: AliasScope,
  guildId: string,
  userId: string,
): AliasHit | null {
  const row = db
    .select()
    .from(aliases)
    .where(
      and(
        eq(aliases.query, query),
        eq(aliases.scope, scope),
        eq(aliases.guildId, guildId),
        eq(aliases.userId, userId),
      ),
    )
    .get();
  if (!row) return null;
  const city = findCityById(db, row.cityId);
  if (!city) return null;
  return { alias: row, city };
}

export interface SaveAliasInput {
  query: string;
  scope: AliasScope;
  guildId?: string | null;
  userId?: string | null;
  cityId: number;
}

export function saveAlias(db: Db, input: SaveAliasInput): Alias {
  const query = normalizeQuery(input.query);
  const guildId = input.guildId ?? '';
  const userId = input.userId ?? '';

  const inserted = db
    .insert(aliases)
    .values({
      query,
      scope: input.scope,
      guildId,
      userId,
      cityId: input.cityId,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [aliases.query, aliases.scope, aliases.guildId, aliases.userId],
      set: { cityId: input.cityId },
    })
    .returning()
    .get();

  if (!inserted) throw new Error('saveAlias: insert returned no row');
  return inserted;
}

export function normalizeQuery(query: string): string {
  return query.toLowerCase().trim();
}
