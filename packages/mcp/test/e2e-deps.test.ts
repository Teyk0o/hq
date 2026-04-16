import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
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
  const c = await startMcpClient(process.execPath, args(project, agent));
  await c.initialize();
  return c;
};
const rawDb = (path: string) => new Database(path);

describe('e2e: task dependencies', () => {
  let proj: E2EProject;
  let parentId: string;
  let childId: string;

  beforeAll(() => {
    proj = makeE2EProject();
    proj.addAgent({ name: 'alice', role: 'worker' });
    parentId = proj.addTask({ title: 'parent' });
    childId = proj.addTask({ title: 'child depends on parent' });
    // Declare the dep directly via DB — the MCP doesn't expose a dep-setting
    // tool yet; operators seed task_dependencies manually.
    rawDb(proj.dbPath)
      .prepare(`INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)`)
      .run(childId, parentId);
  });
  afterAll(() => proj.cleanup());

  test('child cannot be claimed while parent is still todo', async () => {
    const alice = await session(proj.root, 'alice');
    try {
      await alice.call('start_heartbeat', {});
      const r = await alice.call('claim_task', { id: childId });
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe('deps_not_met');
      const details = r.error?.details as { unmet: string[] } | undefined;
      expect(details?.unmet).toContain(parentId);
    } finally {
      await alice.close();
    }
  });

  test('child becomes claimable once parent is done', async () => {
    rawDb(proj.dbPath)
      .prepare(`UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ?`)
      .run(Date.now(), parentId);

    const alice = await session(proj.root, 'alice');
    try {
      await alice.call('start_heartbeat', {});
      const r = await alice.call('claim_task', { id: childId });
      expect(r.ok).toBe(true);
      const row = rawDb(proj.dbPath)
        .prepare('SELECT status, assignee FROM tasks WHERE id = ?')
        .get(childId) as { status: string; assignee: string };
      expect(row.status).toBe('in_progress');
      expect(row.assignee).toBe('alice');
    } finally {
      await alice.close();
    }
  });
});
