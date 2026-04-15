import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface RegistryEntry {
  name: string;
  path: string;
  registered_at: number;
}

function openRegistry(): Database {
  const dir = join(homedir(), '.hq');
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'registry.sqlite'), { create: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      name TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      registered_at INTEGER NOT NULL
    );
  `);
  return db;
}

export function registerProject(name: string, path: string): void {
  const db = openRegistry();
  db.prepare(
    'INSERT OR REPLACE INTO projects (name, path, registered_at) VALUES (?, ?, ?)',
  ).run(name, path, Date.now());
  db.close();
}

export function unregisterProject(name: string): void {
  const db = openRegistry();
  db.prepare('DELETE FROM projects WHERE name = ?').run(name);
  db.close();
}

export function listProjects(): RegistryEntry[] {
  const db = openRegistry();
  const rows = db.prepare('SELECT name, path, registered_at FROM projects').all() as RegistryEntry[];
  db.close();
  return rows;
}

export function findProject(name: string): RegistryEntry | null {
  const db = openRegistry();
  const row = db
    .prepare('SELECT name, path, registered_at FROM projects WHERE name = ?')
    .get(name) as RegistryEntry | null;
  db.close();
  return row;
}
