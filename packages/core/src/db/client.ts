import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { SCHEMA_DDL } from './ddl';
import * as schema from './schema';

export type HQDatabase = BunSQLiteDatabase<typeof schema>;

/**
 * Open (or create) the project-level SQLite DB at the given path. Enables WAL
 * mode and sensible pragmas, then applies the schema idempotently so older
 * DBs converge without a manual migration step.
 */
export function openProjectDb(path: string): HQDatabase {
  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA synchronous = NORMAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec('PRAGMA busy_timeout = 5000;');
  sqlite.exec(SCHEMA_DDL);
  // Lightweight additive migrations for columns added after the initial
  // schema ship. Each is wrapped to ignore "duplicate column" errors so
  // running against a fresh DB is a no-op.
  for (const stmt of ADDITIVE_ALTERS) {
    try {
      sqlite.exec(stmt);
    } catch {
      // column already exists — ignore
    }
  }
  return drizzle(sqlite, { schema });
}

const ADDITIVE_ALTERS = [
  `ALTER TABLE heartbeats ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`,
];
