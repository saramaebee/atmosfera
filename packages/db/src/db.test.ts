import { describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createDb } from './client';
import { cities } from './schema';

describe('packages/db', () => {
  it('round-trips a city via bun:sqlite + drizzle', () => {
    const db = createDb(':memory:');

    db.run(sql`CREATE TABLE cities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_name TEXT NOT NULL,
      region TEXT,
      country TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      timezone TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);

    const inserted = db
      .insert(cities)
      .values({
        canonicalName: 'Buenos Aires',
        country: 'Argentina',
        latitude: -34.6037,
        longitude: -58.3816,
        timezone: 'America/Argentina/Buenos_Aires',
        createdAt: new Date(),
      })
      .returning()
      .all();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.canonicalName).toBe('Buenos Aires');

    const found = db.select().from(cities).all();
    expect(found).toHaveLength(1);
    expect(found[0]?.country).toBe('Argentina');
  });
});
