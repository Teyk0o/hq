import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { CURRENT_SCHEMA_VERSION, SCHEMA_DDL } from './ddl';
import * as schema from './schema';

export type HQDatabase = BunSQLiteDatabase<typeof schema>;

/**
 * Open (or create) the project-level SQLite DB at the given path. Enables WAL
 * mode and sensible pragmas, creates the base tables if missing, then runs
 * any ordered migrations whose index is higher than the DB's recorded
 * schema_version.
 */
export function openProjectDb(path: string): HQDatabase {
  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA synchronous = NORMAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec('PRAGMA busy_timeout = 5000;');
  sqlite.exec(SCHEMA_DDL);
  applyMigrations(sqlite);
  return drizzle(sqlite, { schema });
}

/**
 * Ordered migration list. Each entry has a `to` version and an `up` step.
 * Migrations only run on DBs whose recorded schema_version is < to. After
 * success the meta table is bumped. This lets us add columns or indices
 * later without forcing a schema wipe on existing operator DBs.
 *
 * Additive-only by convention — we don't do destructive column drops or
 * renames because SQLite makes them painful and our data is single-user
 * local. If we ever need a rename, it's a 3-step migration (new col, copy,
 * drop old) and it gets its own numbered entry.
 */
interface Migration {
  to: number;
  note: string;
  up: (db: Database) => void;
}

const MIGRATIONS: Migration[] = [
  {
    to: 2,
    note: 'additive columns: heartbeats.retry_count, tasks.pr_url',
    up: (db) => {
      tryExec(db, 'ALTER TABLE heartbeats ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0');
      tryExec(db, 'ALTER TABLE tasks ADD COLUMN pr_url TEXT');
    },
  },
];

function tryExec(db: Database, sql: string): void {
  try {
    db.exec(sql);
  } catch {
    // Column or index already present — idempotent by design.
  }
}

function applyMigrations(db: Database): void {
  const row = db
    .query<{ value: string }, []>(`SELECT value FROM meta WHERE key = 'schema_version'`)
    .get();
  const current = row ? Number.parseInt(row.value, 10) || 0 : 0;
  for (const m of MIGRATIONS) {
    if (m.to <= current) continue;
    m.up(db);
  }
  if (current !== CURRENT_SCHEMA_VERSION) {
    db.run(
      `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [String(CURRENT_SCHEMA_VERSION)],
    );
  }
}
