import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openProjectDb, newId } from '@hq/core';
import { createApp } from '../src/server';
import type { Hono } from 'hono';

/**
 * Full HTTP smoke test of the UI server: build the Hono app against an
 * on-disk temp project, then exercise every endpoint and assert the
 * response shape and status code. No browser, no SSE — we just hit the
 * fetch handler directly so the suite runs under bun:test in <1s.
 */

function makeProject(name = 'ui-test') {
  const root = mkdtempSync(join(tmpdir(), 'hq-ui-test-'));
  const hqDir = join(root, '.hq');
  mkdirSync(join(hqDir, 'agents'), { recursive: true });
  writeFileSync(
    join(hqDir, 'project.toml'),
    `[project]
name = "${name}"
default_branch = "main"
`,
    'utf-8',
  );
  writeFileSync(
    join(hqDir, 'agents', 'alice.toml'),
    `[agent]
name = "alice"
role = "worker"
soul = "alice.md"
gender = "female"
`,
    'utf-8',
  );
  writeFileSync(join(hqDir, 'agents', 'alice.md'), '# alice\n', 'utf-8');
  const db = openProjectDb(join(hqDir, 'db.sqlite'));
  void db;
  return { name, root, hqDir };
}

async function request(
  app: Hono,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; text: string; headers: Headers }> {
  const res = await app.fetch(new Request(`http://127.0.0.1${path}`, init));
  return { status: res.status, text: await res.text(), headers: res.headers };
}

describe('UI HTTP endpoints', () => {
  let proj: ReturnType<typeof makeProject>;
  let app: Hono;

  beforeAll(() => {
    proj = makeProject();
    // Seed a handful of DB rows so the pages render with content.
    const sqlite = new (require('bun:sqlite').Database)(
      join(proj.hqDir, 'db.sqlite'),
    ) as import('bun:sqlite').Database;
    sqlite
      .prepare(`INSERT INTO agent_state (name, status, budget_reset_at) VALUES ('alice', 'idle', ?)`)
      .run(Date.now() + 86_400_000);
    sqlite
      .prepare(
        `INSERT INTO tasks (id, title, status, priority, created_by) VALUES (?, 'seed task', 'todo', 3, 'human')`,
      )
      .run(newId());
    sqlite
      .prepare(
        `INSERT INTO heartbeats (id, agent, started_at, log_path) VALUES (?, 'alice', ?, ?)`,
      )
      .run(newId(), Date.now() - 60_000, `${proj.hqDir}/logs/alice/dummy.log`);
    sqlite.close();

    app = createApp({
      projects: { [proj.name]: proj.root },
      defaultProject: proj.name,
    });
  });

  afterAll(() => {
    rmSync(proj.root, { recursive: true, force: true });
  });

  test('GET / redirects to /board', async () => {
    const r = await request(app, '/');
    expect([301, 302]).toContain(r.status);
    expect(r.headers.get('location')).toMatch(/\/board/);
  });

  test('GET /board renders HTML with the seeded task', async () => {
    const r = await request(app, `/board?project=${proj.name}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('seed task');
    expect(r.text).toContain('board-surface');
  });

  test('GET /board/inner returns a fragment', async () => {
    const r = await request(app, `/board/inner?project=${proj.name}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('seed task');
  });

  test('GET /agents lists alice', async () => {
    const r = await request(app, `/agents?project=${proj.name}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('alice');
  });

  test('GET /goals renders with the Add form', async () => {
    const r = await request(app, `/goals?project=${proj.name}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Add a goal');
  });

  test('GET /inbox renders', async () => {
    const r = await request(app, `/inbox?project=${proj.name}`);
    expect(r.status).toBe(200);
  });

  test('GET /activity renders', async () => {
    const r = await request(app, `/activity?project=${proj.name}`);
    expect(r.status).toBe(200);
  });

  test('GET /metrics renders the bar chart section', async () => {
    const r = await request(app, `/metrics?project=${proj.name}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Throughput');
  });

  test('GET /settings renders with project name', async () => {
    const r = await request(app, `/settings?project=${proj.name}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain(proj.name);
  });

  test('GET /api/health returns JSON', async () => {
    const r = await request(app, '/api/health');
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text) as { ok: boolean; uptime_ms: number };
    expect(typeof body.ok).toBe('boolean');
    expect(body.uptime_ms).toBeGreaterThanOrEqual(0);
  });

  test('GET /inbox/unread returns HTML fragment', async () => {
    const r = await request(app, `/inbox/unread?project=${proj.name}`);
    expect(r.status).toBe(200);
  });

  test('GET /agents/sidebar returns HTML fragment', async () => {
    const r = await request(app, `/agents/sidebar?project=${proj.name}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('alice');
  });

  test('GET /board/all lists projects', async () => {
    const r = await request(app, '/board/all');
    expect(r.status).toBe(200);
    expect(r.text).toContain(proj.name);
  });

  test('POST /api/tasks creates a task and returns empty drawer', async () => {
    const body = new URLSearchParams({
      title: 'api-created',
      description: 'via tests',
      priority: '2',
    });
    const r = await request(app, `/api/tasks?project=${proj.name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    expect(r.status).toBe(200);
    const sqlite = new (require('bun:sqlite').Database)(
      join(proj.hqDir, 'db.sqlite'),
    ) as import('bun:sqlite').Database;
    const row = sqlite
      .prepare(`SELECT status, priority FROM tasks WHERE title = 'api-created'`)
      .get() as { status: string; priority: number };
    expect(row.status).toBe('todo');
    expect(row.priority).toBe(2);
    sqlite.close();
  });

  test('POST /api/goals creates a goal', async () => {
    const body = new URLSearchParams({
      id: 'g1',
      title: 'Ship v1',
      description: 'core stability',
      assignees: 'alice, bob',
      tasks_per_week: '3',
    });
    const r = await request(app, `/api/goals?project=${proj.name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    expect(r.status).toBe(200);
    const sqlite = new (require('bun:sqlite').Database)(
      join(proj.hqDir, 'db.sqlite'),
    ) as import('bun:sqlite').Database;
    const row = sqlite.prepare(`SELECT title, active, tasks_per_week, assignees FROM goals WHERE id = 'g1'`).get() as {
      title: string;
      active: number;
      tasks_per_week: number;
      assignees: string;
    };
    expect(row.title).toBe('Ship v1');
    expect(row.active).toBe(1);
    expect(row.tasks_per_week).toBe(3);
    const asg = JSON.parse(row.assignees) as string[];
    expect(asg).toEqual(['alice', 'bob']);
    sqlite.close();
  });

  test('POST /api/goals/:id/toggle flips active', async () => {
    const r = await request(app, `/api/goals/g1/toggle?project=${proj.name}`, { method: 'POST' });
    expect(r.status).toBe(200);
    const sqlite = new (require('bun:sqlite').Database)(
      join(proj.hqDir, 'db.sqlite'),
    ) as import('bun:sqlite').Database;
    const row = sqlite.prepare(`SELECT active FROM goals WHERE id = 'g1'`).get() as {
      active: number;
    };
    expect(row.active).toBe(0);
    sqlite.close();
  });

  test('POST /api/agents/alice/pause sets paused', async () => {
    const r = await request(app, `/api/agents/alice/pause?project=${proj.name}`, {
      method: 'POST',
    });
    expect(r.status).toBe(204);
    const sqlite = new (require('bun:sqlite').Database)(
      join(proj.hqDir, 'db.sqlite'),
    ) as import('bun:sqlite').Database;
    const row = sqlite.prepare(`SELECT status FROM agent_state WHERE name = 'alice'`).get() as {
      status: string;
    };
    expect(row.status).toBe('paused');
    sqlite.close();
  });

  test('POST /api/agents/alice/resume puts agent back to idle', async () => {
    const r = await request(app, `/api/agents/alice/resume?project=${proj.name}`, {
      method: 'POST',
    });
    expect(r.status).toBe(204);
    const sqlite = new (require('bun:sqlite').Database)(
      join(proj.hqDir, 'db.sqlite'),
    ) as import('bun:sqlite').Database;
    const row = sqlite.prepare(`SELECT status FROM agent_state WHERE name = 'alice'`).get() as {
      status: string;
    };
    expect(row.status).toBe('idle');
    sqlite.close();
  });

  test('POST /api/messages creates a message row', async () => {
    const body = new URLSearchParams({
      to: 'alice',
      subject: 'hello',
      body: 'from the test suite',
    });
    const r = await request(app, `/api/messages?project=${proj.name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    expect([200, 302]).toContain(r.status);
    const sqlite = new (require('bun:sqlite').Database)(
      join(proj.hqDir, 'db.sqlite'),
    ) as import('bun:sqlite').Database;
    const row = sqlite
      .prepare(`SELECT body FROM messages WHERE subject = 'hello'`)
      .get() as { body: string };
    expect(row.body).toBe('from the test suite');
    sqlite.close();
  });

  test('POST /api/events accepts an HQEvent JSON', async () => {
    const r = await request(app, '/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'task.created', task_id: 'synthetic', by: 'test' }),
    });
    expect(r.status).toBe(204);
  });

  test('POST /api/events refuses malformed JSON', async () => {
    const r = await request(app, '/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(r.status).toBe(400);
  });

  test('GET /health/widget returns a span', async () => {
    const r = await request(app, '/health/widget');
    expect(r.status).toBe(200);
    expect(r.text).toContain('daemon');
  });

  test('404 on unknown task', async () => {
    const r = await request(app, `/task/does-not-exist?project=${proj.name}`);
    expect(r.status).toBe(404);
  });

  test('404 on unknown heartbeat', async () => {
    const r = await request(app, `/heartbeats/does-not-exist?project=${proj.name}`);
    expect(r.status).toBe(404);
  });
});
