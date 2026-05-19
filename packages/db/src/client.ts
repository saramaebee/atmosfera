import { Database } from 'bun:sqlite';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';

export type Db = BunSQLiteDatabase<typeof schema>;

export function createDb(path: string): Db {
  const sqlite = new Database(path);
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  return drizzle(sqlite, { schema });
}
