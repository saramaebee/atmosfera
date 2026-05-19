import { describe, expect, it } from 'bun:test';
import { createDb, migrateDb, saveAlias, upsertCity } from '@atmosfera/db';
import { resolveCity } from './resolve';

function freshDb() {
  const db = createDb(':memory:');
  migrateDb(db);
  return db;
}

describe('resolveCity', () => {
  it('returns alias-resolved city without hitting the network', async () => {
    const db = freshDb();
    const ba = upsertCity(db, {
      canonicalName: 'Buenos Aires',
      region: 'Buenos Aires F.D.',
      country: 'Argentina',
      latitude: -34.6131,
      longitude: -58.3772,
      timezone: 'America/Argentina/Buenos_Aires',
      population: 13_076_300,
      openMeteoId: 3435910,
    });
    saveAlias(db, { query: 'BAires', scope: 'global', cityId: ba.id });

    const result = await resolveCity(db, 'BAires');
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.city.canonicalName).toBe('Buenos Aires');
      expect(result.via).toBe('alias');
    }
  });

  it('geocodes + upserts on a fresh dominant query (live)', async () => {
    const db = freshDb();
    const result = await resolveCity(db, 'Reykjavik');
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.city.country).toBe('Iceland');
      expect(result.via).toBe('geocoder');
    }
  }, 15_000);

  it('returns ambiguous for bare "Columbia" (live)', async () => {
    const db = freshDb();
    const result = await resolveCity(db, 'Columbia');
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      const regions = result.candidates.map((c) => c.region);
      expect(regions).toContain('South Carolina');
      expect(regions).toContain('Missouri');
    }
  }, 15_000);

  it('"Columbia, South Carolina" qualifier disambiguates (live)', async () => {
    const db = freshDb();
    const result = await resolveCity(db, 'Columbia, South Carolina');
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.city.region).toBe('South Carolina');
    }
  }, 15_000);
});
