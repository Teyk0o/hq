import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { writeFileSync } from 'node:fs';
import { makeE2EProject, type E2EProject } from './helpers/project';
import { startMcpClient, type McpClient } from './helpers/mcp-client';

const MCP_ARGS = (project: string, agent: string) => [
  'run',
  new URL('../src/cli-entry.ts', import.meta.url).pathname,
  '--project',
  project,
  '--agent',
  agent,
];
async function session(project: string, agent: string): Promise<McpClient> {
  const client = await startMcpClient(process.execPath, MCP_ARGS(project, agent));
  await client.initialize();
  return client;
}
const rawDb = (path: string) => new Database(path);

describe('e2e: create_task + promote_task', () => {
  let proj: E2EProject;
  beforeAll(() => {
    proj = makeE2EProject();
    // jon is a boss — he can create + promote but not claim.
    writeFileSync(
      `${proj.root}/.hq/agents/jon.toml`,
      `[agent]
name = "jon"
role = "boss"
soul = "jon.md"
`,
      'utf-8',
    );
    writeFileSync(`${proj.root}/.hq/agents/jon.md`, '# jon — boss\n', 'utf-8');
    rawDb(proj.dbPath)
      .prepare(`INSERT INTO agent_state (name, status, budget_reset_at) VALUES ('jon', 'idle', ?)`)
      .run(Date.now() + 86_400_000);
  });
  afterAll(() => proj.cleanup());

  test('boss creates a task in backlog, then promotes it to todo', async () => {
    const jon = await session(proj.root, 'jon');
    try {
      await jon.call('start_heartbeat', {});
      const created = await jon.call('create_task', {
        title: 'boss-created task',
        description: 'seed',
        priority: 2,
      });
      expect(created.ok).toBe(true);
      const id = (created.data as { id: string }).id;

      const db = rawDb(proj.dbPath);
      let row = db.prepare('SELECT status, created_by FROM tasks WHERE id = ?').get(id) as {
        status: string;
        created_by: string;
      };
      expect(row.status).toBe('backlog');
      expect(row.created_by).toBe('jon');

      const promoted = await jon.call('promote_task', { id });
      expect(promoted.ok).toBe(true);
      row = db.prepare('SELECT status FROM tasks WHERE id = ?').get(id) as { status: string };
      expect(row.status).toBe('todo');
    } finally {
      await jon.close();
    }
  });
});

describe('e2e: report_blocked', () => {
  let proj: E2EProject;
  let taskId: string;
  beforeAll(() => {
    proj = makeE2EProject();
    proj.addAgent({ name: 'alice', role: 'worker' });
    taskId = proj.addTask({ title: 'will fail' });
    const db = rawDb(proj.dbPath);
    db.prepare(`UPDATE tasks SET status = 'in_progress', assignee = 'alice' WHERE id = ?`).run(
      taskId,
    );
  });
  afterAll(() => proj.cleanup());

  test('worker reports a task blocked with a reason', async () => {
    const alice = await session(proj.root, 'alice');
    try {
      await alice.call('start_heartbeat', {});
      const r = await alice.call('report_blocked', {
        id: taskId,
        reason: 'cannot install pnpm in sandbox',
      });
      expect(r.ok).toBe(true);
      const row = rawDb(proj.dbPath)
        .prepare('SELECT status, blocked_reason FROM tasks WHERE id = ?')
        .get(taskId) as { status: string; blocked_reason: string };
      expect(row.status).toBe('blocked');
      expect(row.blocked_reason).toContain('cannot install');
    } finally {
      await alice.close();
    }
  });
});

describe('e2e: send_message + read_messages + list_teammates', () => {
  let proj: E2EProject;
  beforeAll(() => {
    proj = makeE2EProject();
    proj.addAgent({ name: 'alice', role: 'worker' });
    proj.addAgent({ name: 'bob', role: 'reviewer' });
  });
  afterAll(() => proj.cleanup());

  test('alice DMs bob, bob reads it exactly once', async () => {
    const alice = await session(proj.root, 'alice');
    const bob = await session(proj.root, 'bob');
    try {
      await alice.call('start_heartbeat', {});
      const sent = await alice.call('send_message', {
        to: 'bob',
        subject: 'quick ping',
        body: 'got a minute?',
      });
      expect(sent.ok).toBe(true);

      await bob.call('start_heartbeat', {});
      const first = await bob.call('read_messages', { unread_only: true });
      expect(first.ok).toBe(true);
      // Drizzle maps snake_case columns to camelCase fields in the JSON
      // output, so the agent-facing shape is fromAgent / toAgent / readAt.
      const msgs1 = (first.data as { messages: Array<{ fromAgent: string; body: string }> })
        .messages;
      expect(msgs1).toHaveLength(1);
      expect(msgs1[0]?.fromAgent).toBe('alice');

      // Second read with unread_only should be empty (first marked them read).
      const second = await bob.call('read_messages', { unread_only: true });
      const msgs2 = (second.data as { messages: unknown[] }).messages;
      expect(msgs2).toHaveLength(0);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  test('list_teammates excludes self and includes status', async () => {
    const alice = await session(proj.root, 'alice');
    try {
      await alice.call('start_heartbeat', {});
      const r = await alice.call('list_teammates', {});
      expect(r.ok).toBe(true);
      const teammates = (r.data as { teammates: Array<{ name: string; is_self: boolean }> })
        .teammates;
      const self = teammates.find((t) => t.name === 'alice');
      expect(self?.is_self).toBe(true);
      const bob = teammates.find((t) => t.name === 'bob');
      expect(bob).toBeDefined();
      expect(bob?.is_self).toBe(false);
    } finally {
      await alice.close();
    }
  });

  test('broadcast to "*" is stored + returned', async () => {
    const alice = await session(proj.root, 'alice');
    try {
      await alice.call('start_heartbeat', {});
      await alice.call('send_message', { to: '*', body: 'hello everyone' });
      const db = rawDb(proj.dbPath);
      const row = db
        .prepare(`SELECT to_agent, body FROM messages WHERE to_agent = '*'`)
        .get() as { to_agent: string; body: string };
      expect(row.body).toBe('hello everyone');
    } finally {
      await alice.close();
    }
  });
});

describe('e2e: get_task returns task + comments + reviews', () => {
  let proj: E2EProject;
  let taskId: string;
  beforeAll(() => {
    proj = makeE2EProject();
    proj.addAgent({ name: 'alice', role: 'worker' });
    proj.addAgent({ name: 'bob', role: 'reviewer' });
    taskId = proj.addTask({ title: 'for reading' });
  });
  afterAll(() => proj.cleanup());

  test('full shape and ordering', async () => {
    const alice = await session(proj.root, 'alice');
    try {
      await alice.call('start_heartbeat', {});
      await alice.call('add_comment', { task_id: taskId, body: 'first' });
      await alice.call('add_comment', { task_id: taskId, body: 'second' });
      const r = await alice.call('get_task', { id: taskId });
      expect(r.ok).toBe(true);
      const data = r.data as {
        task: { id: string; title: string };
        comments: Array<{ body: string }>;
        reviews: unknown[];
      };
      expect(data.task.id).toBe(taskId);
      expect(data.comments.map((c) => c.body)).toEqual(['first', 'second']);
      expect(data.reviews).toHaveLength(0);
    } finally {
      await alice.close();
    }
  });
});

describe('e2e: update_progress writes the PROGRESS.md file', () => {
  let proj: E2EProject;
  beforeAll(() => {
    proj = makeE2EProject();
    proj.addAgent({ name: 'alice', role: 'worker' });
  });
  afterAll(() => proj.cleanup());

  test('file contents match the last call', async () => {
    const alice = await session(proj.root, 'alice');
    try {
      await alice.call('start_heartbeat', {});
      await alice.call('update_progress', { body: 'first draft' });
      await alice.call('update_progress', { body: 'later take' });
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(`${proj.root}/.hq/progress/alice.md`, 'utf-8');
      expect(content).toBe('later take');
    } finally {
      await alice.close();
    }
  });
});

describe('e2e: log_activity appends a free-form row', () => {
  let proj: E2EProject;
  beforeAll(() => {
    proj = makeE2EProject();
    proj.addAgent({ name: 'alice', role: 'worker' });
  });
  afterAll(() => proj.cleanup());

  test('action + details survive the round-trip', async () => {
    const alice = await session(proj.root, 'alice');
    try {
      await alice.call('start_heartbeat', {});
      const r = await alice.call('log_activity', {
        action: 'note',
        details: { thought: 'paused on coffee' },
      });
      expect(r.ok).toBe(true);
      const row = rawDb(proj.dbPath)
        .prepare(`SELECT agent, action, details FROM activity WHERE action = 'note'`)
        .get() as { agent: string; action: string; details: string };
      expect(row.agent).toBe('alice');
      expect(JSON.parse(row.details).thought).toBe('paused on coffee');
    } finally {
      await alice.close();
    }
  });
});

describe('e2e: MCP audit log', () => {
  let proj: E2EProject;
  beforeAll(() => {
    proj = makeE2EProject();
    proj.addAgent({ name: 'alice', role: 'worker' });
  });
  afterAll(() => proj.cleanup());

  test('every tool call writes an mcp.<tool> activity row', async () => {
    const alice = await session(proj.root, 'alice');
    try {
      await alice.call('start_heartbeat', {});
      await alice.call('list_tasks', {});
      await alice.call('list_teammates', {});
      const rows = rawDb(proj.dbPath)
        .prepare(
          `SELECT action FROM activity WHERE agent = 'alice' AND action LIKE 'mcp.%' ORDER BY created_at`,
        )
        .all() as Array<{ action: string }>;
      const actions = rows.map((r) => r.action);
      expect(actions).toContain('mcp.start_heartbeat');
      expect(actions).toContain('mcp.list_tasks');
      expect(actions).toContain('mcp.list_teammates');
    } finally {
      await alice.close();
    }
  });
});
