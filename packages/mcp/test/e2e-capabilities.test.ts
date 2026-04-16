import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { writeFileSync } from 'node:fs';
import { makeE2EProject, type E2EProject } from './helpers/project';
import { startMcpClient, type McpClient } from './helpers/mcp-client';

const args = (project: string, agent: string) => [
  'run',
  new URL('../src/cli-entry.ts', import.meta.url).pathname,
  '--project',
  project,
  '--agent',
  agent,
];
const session = async (project: string, agent: string): Promise<McpClient> => {
  const c = await startMcpClient('bun', args(project, agent));
  await c.initialize();
  return c;
};
const rawDb = (path: string) => new Database(path);

/** Most tests in this file reuse the same Project; each role is a separate agent. */
function roleProject(): E2EProject {
  const proj = makeE2EProject();
  proj.addAgent({ name: 'alice', role: 'worker' });
  proj.addAgent({ name: 'bob', role: 'reviewer' });
  proj.addAgent({ name: 'cara', role: 'readonly' });
  writeFileSync(
    `${proj.root}/.hq/agents/jon.toml`,
    `[agent]
name = "jon"
role = "boss"
soul = "jon.md"
`,
    'utf-8',
  );
  writeFileSync(`${proj.root}/.hq/agents/jon.md`, '# jon\n', 'utf-8');
  rawDb(proj.dbPath)
    .prepare(`INSERT INTO agent_state (name, status, budget_reset_at) VALUES ('jon', 'idle', ?)`)
    .run(Date.now() + 86_400_000);
  return proj;
}

describe('capability: workers cannot create_task', () => {
  let proj: E2EProject;
  beforeAll(() => {
    proj = roleProject();
  });
  afterAll(() => proj.cleanup());

  test('alice create_task → missing_capability', async () => {
    const alice = await session(proj.root, 'alice');
    try {
      await alice.call('start_heartbeat', {});
      const r = await alice.call('create_task', { title: 'forbidden' });
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe('missing_capability');
    } finally {
      await alice.close();
    }
  });
});

describe('capability: workers cannot promote_task', () => {
  let proj: E2EProject;
  beforeAll(() => {
    proj = roleProject();
    // Seed a backlog task to try promoting.
    rawDb(proj.dbPath)
      .prepare(
        `INSERT INTO tasks (id, title, created_by, status, priority) VALUES ('t1', 'x', 'human', 'backlog', 3)`,
      )
      .run();
  });
  afterAll(() => proj.cleanup());

  test('alice promote → missing_capability', async () => {
    const alice = await session(proj.root, 'alice');
    try {
      await alice.call('start_heartbeat', {});
      const r = await alice.call('promote_task', { id: 't1' });
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe('missing_capability');
    } finally {
      await alice.close();
    }
  });
});

describe('capability: reviewers cannot claim_task', () => {
  let proj: E2EProject;
  beforeAll(() => {
    proj = roleProject();
    rawDb(proj.dbPath)
      .prepare(
        `INSERT INTO tasks (id, title, created_by, status, priority) VALUES ('t2', 'x', 'human', 'todo', 3)`,
      )
      .run();
  });
  afterAll(() => proj.cleanup());

  test('bob claim → missing_capability', async () => {
    const bob = await session(proj.root, 'bob');
    try {
      await bob.call('start_heartbeat', {});
      const r = await bob.call('claim_task', { id: 't2' });
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe('missing_capability');
    } finally {
      await bob.close();
    }
  });
});

describe('capability: author cannot review their own task', () => {
  let proj: E2EProject;
  beforeAll(() => {
    proj = roleProject();
    rawDb(proj.dbPath)
      .prepare(
        `INSERT INTO tasks (id, title, created_by, status, priority, assignee) VALUES ('t3', 'x', 'human', 'peer_review', 3, 'alice')`,
      )
      .run();
    // Upgrade alice to also have can_review (matching our default worker role).
  });
  afterAll(() => proj.cleanup());

  test('alice reviewing her own task → self_review', async () => {
    const alice = await session(proj.root, 'alice');
    try {
      await alice.call('start_heartbeat', {});
      const r = await alice.call('submit_review', {
        id: 't3',
        verdict: 'approved',
        body: 'lol',
      });
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe('self_review');
    } finally {
      await alice.close();
    }
  });
});

describe('capability: readonly role cannot claim or create', () => {
  let proj: E2EProject;
  beforeAll(() => {
    proj = roleProject();
    rawDb(proj.dbPath)
      .prepare(
        `INSERT INTO tasks (id, title, created_by, status, priority) VALUES ('t4', 'x', 'human', 'todo', 3)`,
      )
      .run();
  });
  afterAll(() => proj.cleanup());

  test('cara claim → missing_capability', async () => {
    const cara = await session(proj.root, 'cara');
    try {
      await cara.call('start_heartbeat', {});
      const r = await cara.call('claim_task', { id: 't4' });
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe('missing_capability');
    } finally {
      await cara.close();
    }
  });

  test('cara create_task → missing_capability', async () => {
    const cara = await session(proj.root, 'cara');
    try {
      await cara.call('start_heartbeat', {});
      const r = await cara.call('create_task', { title: 'nope' });
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe('missing_capability');
    } finally {
      await cara.close();
    }
  });
});

describe('capability: submit_for_review only by assignee', () => {
  let proj: E2EProject;
  beforeAll(() => {
    proj = roleProject();
    rawDb(proj.dbPath)
      .prepare(
        `INSERT INTO tasks (id, title, created_by, status, priority, assignee) VALUES ('t5', 'x', 'human', 'in_progress', 3, 'alice')`,
      )
      .run();
  });
  afterAll(() => proj.cleanup());

  test('bob trying to submit alice task → not_assignee', async () => {
    // bob is a reviewer, doesn't pass can_claim, but also not assignee
    const bob = await session(proj.root, 'bob');
    try {
      await bob.call('start_heartbeat', {});
      const r = await bob.call('submit_for_review', { id: 't5' });
      expect(r.ok).toBe(false);
      // reviewer first fails on can_claim capability before assignee check
      expect(['not_assignee', 'missing_capability']).toContain(r.error?.code);
    } finally {
      await bob.close();
    }
  });
});
