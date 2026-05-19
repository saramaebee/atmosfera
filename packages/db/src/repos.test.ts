import { describe, expect, it } from 'bun:test';
import { createDb, migrateDb } from './client';
import {
  type CityInput,
  findAlias,
  findCityById,
  normalizeQuery,
  saveAlias,
  upsertCity,
} from './repos';

function freshDb() {
  const db = createDb(':memory:');
  migrateDb(db);
  return db;
}

const buenosAires: CityInput = {
  canonicalName: 'Buenos Aires',
  region: 'Buenos Aires F.D.',
  country: 'Argentina',
  latitude: -34.6131,
  longitude: -58.3772,
  timezone: 'America/Argentina/Buenos_Aires',
  population: 13_076_300,
  openMeteoId: 3435910,
};

const reykjavik: CityInput = {
  canonicalName: 'Reykjavik',
  region: 'Capital Region',
  country: 'Iceland',
  latitude: 64.1355,
  longitude: -21.8954,
  timezone: 'Atlantic/Reykjavik',
  population: 122_853,
  openMeteoId: 3413829,
};

describe('upsertCity', () => {
  it('inserts on first call, returns existing on second by openMeteoId', () => {
    const db = freshDb();
    const a = upsertCity(db, buenosAires);
    const b = upsertCity(db, buenosAires);
    expect(a.id).toBe(b.id);
    expect(a.canonicalName).toBe('Buenos Aires');
  });

  it('returns existing by latLon when openMeteoId is null', () => {
    const db = freshDb();
    const a = upsertCity(db, { ...buenosAires, openMeteoId: null });
    const b = upsertCity(db, { ...buenosAires, openMeteoId: null });
    expect(a.id).toBe(b.id);
  });
});

describe('findAlias + saveAlias scope precedence', () => {
  it('returns null when no alias exists', () => {
    const db = freshDb();
    expect(findAlias(db, { query: 'nyc' })).toBeNull();
  });

  it('saves and retrieves a global alias', () => {
    const db = freshDb();
    const ba = upsertCity(db, buenosAires);
    saveAlias(db, { query: 'BAires', scope: 'global', cityId: ba.id });

    const hit = findAlias(db, { query: 'baires' });
    expect(hit?.city.canonicalName).toBe('Buenos Aires');
    expect(hit?.alias.scope).toBe('global');
  });

  it('user alias overrides guild which overrides global', () => {
    const db = freshDb();
    const ba = upsertCity(db, buenosAires);
    const rk = upsertCity(db, reykjavik);

    // Three aliases for the same query, different scopes pointing to different cities
    saveAlias(db, { query: 'home', scope: 'global', cityId: ba.id });
    saveAlias(db, { query: 'home', scope: 'guild', guildId: 'g1', cityId: rk.id });
    saveAlias(db, { query: 'home', scope: 'user', userId: 'u1', cityId: ba.id });

    // Lookup with user scope → wins
    expect(findAlias(db, { query: 'home', guildId: 'g1', userId: 'u1' })?.city.id).toBe(ba.id);
    // Lookup with guild but no user → guild wins
    expect(findAlias(db, { query: 'home', guildId: 'g1' })?.city.id).toBe(rk.id);
    // Lookup with no scope → global wins
    expect(findAlias(db, { query: 'home' })?.city.id).toBe(ba.id);
  });

  it('reusing the same scope+query updates city_id (idempotent saveAlias)', () => {
    const db = freshDb();
    const ba = upsertCity(db, buenosAires);
    const rk = upsertCity(db, reykjavik);

    saveAlias(db, { query: 'mood', scope: 'global', cityId: ba.id });
    saveAlias(db, { query: 'mood', scope: 'global', cityId: rk.id });

    expect(findAlias(db, { query: 'mood' })?.city.id).toBe(rk.id);
  });
});

describe('findCityById', () => {
  it('returns null for missing id', () => {
    const db = freshDb();
    expect(findCityById(db, 999)).toBeNull();
  });
});

describe('normalizeQuery', () => {
  it('lowercases and trims', () => {
    expect(normalizeQuery('  Buenos Aires  ')).toBe('buenos aires');
  });
});
