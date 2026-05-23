import type { Database } from 'bun:sqlite';

let dbInstance: Database | null = null;

export function setExplainDb(db: Database): void {
  dbInstance = db;
}

export function getDb(): Database {
  if (!dbInstance) throw new Error('explain DB not initialized — call setExplainDb() first');
  return dbInstance;
}
