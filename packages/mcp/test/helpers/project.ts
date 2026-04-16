import { mkdtempSync, writeFileSync } from 'node:fs';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openProjectDb, newId } from '@hq/core';

export interface E2EProject {
  root: string;
  dbPath: string;
  addAgent: (opts: { name: string; role: string; soul?: string }) => void;
  addTask: (opts: { title: string; priority?: number; package?: string; status?: string }) => string;
  cleanup: () => void;
}

/**
 * Build a self-contained project rooted under /tmp with the shape hq init
 * would produce: .hq/project.toml, .hq/agents/*.toml + *.md, fresh DB with
 * schema applied. No git, no tmux, no daemon — just the data artefacts an
 * MCP server needs to see.
 */
export function makeE2EProject(): E2EProject {
  const root = mkdtempSync(join(tmpdir(), 'hq-e2e-'));
  const hqDir = join(root, '.hq');
  mkdirSync(join(hqDir, 'agents'), { recursive: true });
  writeFileSync(
    join(hqDir, 'project.toml'),
    `[project]
name = "e2e"
default_model = "sonnet"
default_branch = "main"

[scheduler]
interval_minutes = 15

[kanban]
min_reviewers = 1
`,
    'utf-8',
  );

  const dbPath = join(hqDir, 'db.sqlite');
  // openProjectDb applies the DDL + migrations up to CURRENT_SCHEMA_VERSION.
  // We don't keep the handle here — each caller opens its own.
  openProjectDb(dbPath);

  return {
    root,
    dbPath,
    addAgent({ name, role, soul }) {
      writeFileSync(
        join(hqDir, 'agents', `${name}.toml`),
        `[agent]
name = "${name}"
role = "${role}"
soul = "${name}.md"
active = true
`,
        'utf-8',
      );
      writeFileSync(
        join(hqDir, 'agents', `${name}.md`),
        soul ?? `# ${name}\n\nA ${role} on the e2e project.\n`,
        'utf-8',
      );
      // Seed agent_state so MCP tools can look it up if needed later.
      const db = openProjectDb(dbPath);
      const sqlite = (
        db as unknown as { $client: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } } }
      ).$client;
      sqlite
        .prepare(
          `INSERT OR IGNORE INTO agent_state (name, status, budget_reset_at) VALUES (?, 'idle', ?)`,
        )
        .run(name, Date.now() + 86_400_000);
    },
    addTask({ title, priority = 3, package: pkg, status = 'todo' }) {
      const id = newId();
      const db = openProjectDb(dbPath);
      const sqlite = (
        db as unknown as { $client: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } } }
      ).$client;
      sqlite
        .prepare(
          `INSERT INTO tasks (id, title, priority, package, created_by, status) VALUES (?, ?, ?, ?, 'human', ?)`,
        )
        .run(id, title, priority, pkg ?? null, status);
      return id;
    },
    cleanup() {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}
