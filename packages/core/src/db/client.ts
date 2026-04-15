import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';

export type HQDatabase = BunSQLiteDatabase<typeof schema>;

/**
 * Open (or create) the project-level SQLite DB at the given path.
 * Enables WAL mode and sensible pragmas for a single-writer local workload.
 */
export function openProjectDb(path: string): HQDatabase {
  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA synchronous = NORMAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec('PRAGMA busy_timeout = 5000;');
  return drizzle(sqlite, { schema });
}
