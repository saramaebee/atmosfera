import { Database } from 'bun:sqlite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from './schema';

export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };

export function createDb(path: string): Db {
  const sqlite = new Database(path);
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  return drizzle(sqlite, { schema }) as Db;
}

/**
 * Run all pending migrations against the given Db.
 * Migration files live at packages/db/migrations/ — resolved relative to this
 * source file so the path is stable regardless of cwd.
 */
export function migrateDb(db: Db): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(here, '..', 'migrations');
  migrate(db, { migrationsFolder });
}
