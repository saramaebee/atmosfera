import { describe, expect, it } from 'bun:test';
import { createDb, migrateDb } from './client';
import { cities } from './schema';

function freshDb() {
  const db = createDb(':memory:');
  migrateDb(db);
  return db;
}

describe('migrateDb + cities', () => {
  it('runs migrations and round-trips a city', () => {
    const db = freshDb();

    const inserted = db
      .insert(cities)
      .values({
        canonicalName: 'Buenos Aires',
        country: 'Argentina',
        region: 'Buenos Aires F.D.',
        latitude: -34.6037,
        longitude: -58.3816,
        timezone: 'America/Argentina/Buenos_Aires',
        population: 13_076_300,
        openMeteoId: 3435910,
        createdAt: new Date(),
      })
      .returning()
      .all();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.canonicalName).toBe('Buenos Aires');
    expect(inserted[0]?.population).toBe(13_076_300);

    const found = db.select().from(cities).all();
    expect(found).toHaveLength(1);
    expect(found[0]?.country).toBe('Argentina');
  });
});
