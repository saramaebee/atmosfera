import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const cities = sqliteTable('cities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  canonicalName: text('canonical_name').notNull(),
  region: text('region'),
  country: text('country').notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  timezone: text('timezone').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export type City = typeof cities.$inferSelect;
export type NewCity = typeof cities.$inferInsert;
