import type { Database } from 'bun:sqlite';

let dbInstance: Database | null = null;

/**
 * Bind the underlying bun:sqlite client. Called once at bot startup with
 * `atmosferaDrizzleDb.$client`. user-roast's DB helpers use raw SQL on this
 * client (their queries — UNION-ALL aggregates, FTS5 MATCH with bm25 — are
 * awkward in Drizzle and were faithfully ported from skilishu).
 */
export function setUserRoastDb(db: Database): void {
  dbInstance = db;
}

export function getDb(): Database {
  if (!dbInstance) throw new Error('user-roast DB not initialized — call setUserRoastDb() first');
  return dbInstance;
}
