import type { Db } from '@atmosfera/db';

let dbInstance: Db | null = null;

export function setWebDb(db: Db): void {
  dbInstance = db;
}

export function getWebDb(): Db {
  if (!dbInstance) throw new Error('web db not initialised');
  return dbInstance;
}
