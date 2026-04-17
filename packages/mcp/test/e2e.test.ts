import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { makeE2EProject, type E2EProject } from './helpers/project';
import { startMcpClient, type McpClient } from './helpers/mcp-client';

/**
 * End-to-end tests: spawn the real hq MCP server as a subprocess for each
 * scenario, drive it over JSON-RPC stdio, and assert the SQLite state after
 * every step. No tmux, no bwrap, no claude — this exercises the MCP layer
 * end-to-end which is the single contract agents depend on.
 */

const MCP_BIN = process.execPath;
const MCP_ARGS = (project: string, agent: string) => [
  'run',
  new URL('../src/cli-entry.ts', import.meta.url).pathname,
  '--project',
  project,
  '--agent',
  agent,
];

async function session(
  project: string,
  agent: string,
): Promise<McpClient> {
  const client = await startMcpClient(MCP_BIN, MCP_ARGS(project, agent));
  await client.initialize();
  return client;
}

function rawDb(path: string) {
  return new Database(path);
}

describe('e2e: worker lifecycle on a single task', () => {
  let proj: E2EProject;

  beforeAll(() => {
    proj = makeE2EProject();
    proj.addAgent({ name: 'alice', role: 'worker' });
    proj.addTask({ title: 'e2e task A' });
  });
  afterAll(() => proj.cleanup());

  test('alice can complete the whole todo → peer_review cycle', async () => {
    const alice = await session(proj.root, 'alice');
    try {
      // 1. Heartbeat starts.
      const started = await alice.call('start_heartbeat', {});
      expect(started.ok).toBe(true);

      // 2. Listing todo tasks returns our seeded row.
      const listed = await alice.call('list_tasks', { status: 'todo' });
      expect(listed.ok).toBe(true);
      const tasks = (listed.data as { tasks: Array<{ id: string; title: string }> }).tasks;
      expect(tasks).toHaveLength(1);
      const taskId = tasks[0]!.id;

      // 3. Claim flips status.
      const claimed = await alice.call('claim_task', { id: taskId });
      expect(claimed.ok).toBe(true);
      const db = rawDb(proj.dbPath);
      const row = db.prepare('SELECT status, assignee FROM tasks WHERE id = ?').get(taskId) as
        | { status: string; assignee: string }
        | undefined;
      expect(row?.status).toBe('in_progress');
      expect(row?.assignee).toBe('alice');

      // 4. submit_for_review without a committed branch is refused.
      const premature = await alice.call('submit_for_review', { id: taskId });
      expect(premature.ok).toBe(false);
      expect(['branch_missing', 'branch_mismatch', 'no_commits']).toContain(
        premature.error?.code,
      );

      // 5. End heartbeat. Agent flips to idle.
      const ended = await alice.call('end_heartbeat', { summary: 'test', tokens_used: 42 });
      expect(ended.ok).toBe(true);
      const state = db
        .prepare(`SELECT status FROM agent_state WHERE name = 'alice'`)
        .get() as { status: string };
      expect(state.status).toBe('idle');
      const hb = db
        .prepare(
          `SELECT outcome, tokens_used FROM heartbeats WHERE agent = 'alice' ORDER BY started_at DESC LIMIT 1`,
        )
        .get() as { outcome: string; tokens_used: number };
      expect(hb.outcome).toBe('ok');
      expect(hb.tokens_used).toBe(42);
      db.close();
    } finally {
      await alice.close();
    }
  });
});

describe('e2e: claim race between two workers', () => {
  let proj: E2EProject;

  beforeAll(() => {
    proj = makeE2EProject();
    proj.addAgent({ name: 'alice', role: 'worker' });
    proj.addAgent({ name: 'bob', role: 'worker' });
    proj.addTask({ title: 'the coveted task' });
  });
  afterAll(() => proj.cleanup());

  test('exactly one of two concurrent claims wins', async () => {
    const alice = await session(proj.root, 'alice');
    const bob = await session(proj.root, 'bob');
    try {
      await alice.call('start_heartbeat', {});
      await bob.call('start_heartbeat', {});
      const db = rawDb(proj.dbPath);
      const taskId = (db.prepare(`SELECT id FROM tasks LIMIT 1`).get() as { id: string }).id;

      const [a, b] = await Promise.all([
        alice.call('claim_task', { id: taskId }),
        bob.call('claim_task', { id: taskId }),
      ]);
      const winners = [a.ok, b.ok].filter(Boolean).length;
      expect(winners).toBe(1);
      const loser = a.ok ? b : a;
      // Depending on subprocess timing the loser may catch the task either at
      // the UPDATE step (claim_race_lost) or at the pre-transition check
      // after the winner committed (invalid_transition). Both are valid
      // "you didn't win the race" outcomes.
      expect(['claim_race_lost', 'invalid_transition']).toContain(loser.error?.code);

      // DB row should show exactly one assignee.
      const row = db.prepare(`SELECT assignee FROM tasks WHERE id = ?`).get(taskId) as {
        assignee: string;
      };
      expect(['alice', 'bob']).toContain(row.assignee);
      db.close();
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});

describe('e2e: peer-review gate auto-promotes to review', () => {
  let proj: E2EProject;
  let taskId: string;

  beforeAll(async () => {
    proj = makeE2EProject();
    proj.addAgent({ name: 'alice', role: 'worker' });
    proj.addAgent({ name: 'bob', role: 'reviewer' });
    taskId = proj.addTask({ title: 'review me' });
    // Fast-path the task to peer_review directly via the DB; the branch/git
    // contract is exercised by other tests, here we focus on the gate.
    const db = rawDb(proj.dbPath);
    db.prepare(`UPDATE tasks SET status = 'peer_review', assignee = 'alice' WHERE id = ?`).run(
      taskId,
    );
    db.close();
  });
  afterAll(() => proj.cleanup());

  test('bob can review; single approved review moves task to review', async () => {
    const bob = await session(proj.root, 'bob');
    try {
      await bob.call('start_heartbeat', {});
      const approved = await bob.call('submit_review', {
        id: taskId,
        verdict: 'approved',
        body: 'LGTM',
      });
      expect(approved.ok).toBe(true);
      const next = (approved.data as { next_status: string }).next_status;
      expect(next).toBe('review');

      const db = rawDb(proj.dbPath);
      const row = db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(taskId) as {
        status: string;
      };
      expect(row.status).toBe('review');
      db.close();
    } finally {
      await bob.close();
    }
  });
});

describe('e2e: changes_requested kicks the task back to todo', () => {
  let proj: E2EProject;
  let taskId: string;

  beforeAll(() => {
    proj = makeE2EProject();
    proj.addAgent({ name: 'alice', role: 'worker' });
    proj.addAgent({ name: 'bob', role: 'reviewer' });
    taskId = proj.addTask({ title: 'needs work' });
    const db = rawDb(proj.dbPath);
    db.prepare(`UPDATE tasks SET status = 'peer_review', assignee = 'alice' WHERE id = ?`).run(
      taskId,
    );
    db.close();
  });
  afterAll(() => proj.cleanup());

  test('changes_requested moves task back + requires non-empty body', async () => {
    const bob = await session(proj.root, 'bob');
    try {
      await bob.call('start_heartbeat', {});
      const empty = await bob.call('submit_review', {
        id: taskId,
        verdict: 'changes_requested',
        body: '',
      });
      expect(empty.ok).toBe(false);
      expect(empty.error?.code).toBe('missing_body');

      const real = await bob.call('submit_review', {
        id: taskId,
        verdict: 'changes_requested',
        body: 'missing tests',
      });
      expect(real.ok).toBe(true);

      const db = rawDb(proj.dbPath);
      const row = db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(taskId) as {
        status: string;
      };
      expect(row.status).toBe('todo');
      db.close();
    } finally {
      await bob.close();
    }
  });
});

describe('e2e: @mentions fan out to the messages inbox', () => {
  let proj: E2EProject;
  let taskId: string;

  beforeAll(() => {
    proj = makeE2EProject();
    proj.addAgent({ name: 'alice', role: 'worker' });
    proj.addAgent({ name: 'bob', role: 'reviewer' });
    taskId = proj.addTask({ title: 'ping bob' });
  });
  afterAll(() => proj.cleanup());

  test('add_comment with @bob creates a messages row addressed to bob', async () => {
    const alice = await session(proj.root, 'alice');
    try {
      await alice.call('start_heartbeat', {});
      const res = await alice.call('add_comment', {
        task_id: taskId,
        body: 'Hey @bob can you look at this?',
      });
      expect(res.ok).toBe(true);
      const fanout = (res.data as { fanout: number }).fanout;
      expect(fanout).toBe(1);

      const db = rawDb(proj.dbPath);
      const msg = db
        .prepare(`SELECT from_agent, to_agent FROM messages WHERE to_agent = 'bob'`)
        .get() as { from_agent: string; to_agent: string };
      expect(msg.from_agent).toBe('alice');
      expect(msg.to_agent).toBe('bob');
      db.close();
    } finally {
      await alice.close();
    }
  });
});

describe('e2e: package scope blocks out-of-scope claims', () => {
  let proj: E2EProject;
  let apiTask: string;
  let docsTask: string;

  beforeAll(() => {
    proj = makeE2EProject();
    proj.addAgent({ name: 'alice', role: 'worker' });
    // Alice's scope restricted to 'api' via direct TOML edit.
    const tomlPath = `${proj.root}/.hq/agents/alice.toml`;
    const fs = require('node:fs') as typeof import('node:fs');
    fs.writeFileSync(
      tomlPath,
      `[agent]
name = "alice"
role = "worker"
soul = "alice.md"

[scope]
packages = ["api"]
`,
      'utf-8',
    );
    apiTask = proj.addTask({ title: 'api task', package: 'api' });
    docsTask = proj.addTask({ title: 'docs task', package: 'docs' });
  });
  afterAll(() => proj.cleanup());

  test('can claim api, refuses docs with out_of_scope', async () => {
    const alice = await session(proj.root, 'alice');
    try {
      await alice.call('start_heartbeat', {});
      const ok = await alice.call('claim_task', { id: apiTask });
      expect(ok.ok).toBe(true);

      const nope = await alice.call('claim_task', { id: docsTask });
      expect(nope.ok).toBe(false);
      expect(nope.error?.code).toBe('out_of_scope');
    } finally {
      await alice.close();
    }
  });
});
