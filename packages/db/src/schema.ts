import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Canonical resolved cities. Keyed by Open-Meteo's geocoder id when available
 * (so re-geocoding the same query returns the same row).
 */
export const cities = sqliteTable(
  'cities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    canonicalName: text('canonical_name').notNull(),
    region: text('region'),
    country: text('country').notNull(),
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    timezone: text('timezone').notNull(),
    population: integer('population'),
    openMeteoId: integer('open_meteo_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('cities_open_meteo_id_idx').on(table.openMeteoId),
    uniqueIndex('cities_latlon_idx').on(table.latitude, table.longitude),
  ],
);

/**
 * Aliases for resolved cities, scoped global / guild / user. Empty strings are
 * sentinels for "not applicable" so the unique index actually enforces
 * (NULL ≠ NULL would let duplicates slip through).
 */
export const aliases = sqliteTable(
  'aliases',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    query: text('query').notNull(),
    scope: text('scope').notNull().$type<'global' | 'guild' | 'user'>(),
    guildId: text('guild_id').notNull().default(''),
    userId: text('user_id').notNull().default(''),
    cityId: integer('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('aliases_scope_lookup_idx').on(
      table.query,
      table.scope,
      table.guildId,
      table.userId,
    ),
  ],
);

export type City = typeof cities.$inferSelect;
export type NewCity = typeof cities.$inferInsert;
export type Alias = typeof aliases.$inferSelect;
export type NewAlias = typeof aliases.$inferInsert;
export type AliasScope = 'global' | 'guild' | 'user';
