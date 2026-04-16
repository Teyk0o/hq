import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openProjectDb } from '../src/db';
import { CURRENT_SCHEMA_VERSION } from '../src/db/ddl';

describe('schema migrations', () => {
  test('fresh DB lands at CURRENT_SCHEMA_VERSION immediately', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-migration-test-'));
    try {
      openProjectDb(join(dir, 'db.sqlite'));
      const raw = new Database(join(dir, 'db.sqlite'));
      const row = raw
        .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
        .get() as { value: string };
      expect(row.value).toBe(String(CURRENT_SCHEMA_VERSION));
      raw.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a DB created manually without pr_url gets the column on next open', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-migration-test-'));
    try {
      // Craft a DB representing an older HQ version: the tables carry every
      // column from the initial DDL EXCEPT the migration-added ones
      // (heartbeats.retry_count and tasks.pr_url) and no meta.schema_version
      // row. This is exactly the shape of a pre-migration operator DB.
      const raw = new Database(join(dir, 'db.sqlite'), { create: true, strict: true });
      raw.exec(`
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          goal_id TEXT,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          assignee TEXT,
          created_by TEXT NOT NULL,
          status TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 3,
          package TEXT,
          branch TEXT,
          pushed INTEGER NOT NULL DEFAULT 0,
          blocked_reason TEXT,
          created_at INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT 0,
          claimed_at INTEGER,
          completed_at INTEGER
        );
        CREATE TABLE heartbeats (
          id TEXT PRIMARY KEY,
          agent TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          outcome TEXT,
          log_path TEXT NOT NULL,
          tokens_used INTEGER NOT NULL DEFAULT 0,
          tasks_worked TEXT NOT NULL DEFAULT '[]',
          error TEXT
        );
      `);
      raw.close();

      // Re-open via our migration-aware client.
      openProjectDb(join(dir, 'db.sqlite'));
      const after = new Database(join(dir, 'db.sqlite'));

      // Columns should now exist.
      const taskCols = after
        .prepare(`PRAGMA table_info('tasks')`)
        .all() as Array<{ name: string }>;
      expect(taskCols.some((c) => c.name === 'pr_url')).toBe(true);

      const hbCols = after
        .prepare(`PRAGMA table_info('heartbeats')`)
        .all() as Array<{ name: string }>;
      expect(hbCols.some((c) => c.name === 'retry_count')).toBe(true);

      // schema_version is now set.
      const row = after
        .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
        .get() as { value: string };
      expect(Number.parseInt(row.value, 10)).toBeGreaterThanOrEqual(CURRENT_SCHEMA_VERSION);
      after.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('re-opening an already-migrated DB is a no-op', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-migration-test-'));
    try {
      openProjectDb(join(dir, 'db.sqlite'));
      openProjectDb(join(dir, 'db.sqlite'));
      openProjectDb(join(dir, 'db.sqlite'));
      const raw = new Database(join(dir, 'db.sqlite'));
      const row = raw
        .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
        .get() as { value: string };
      expect(row.value).toBe(String(CURRENT_SCHEMA_VERSION));
      raw.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
