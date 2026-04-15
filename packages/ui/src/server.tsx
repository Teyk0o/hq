/** @jsxImportSource hono/jsx */
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { HQEvent } from '@hq/core';
import { getSharedBus } from '@hq/mcp';
import { Kanban, TaskDrawer, UsageWidget, ActivityFeed, AgentsList } from './views';
import { Layout } from './layout';
import type { KanbanTask } from './views';

export interface UiServerOptions {
  host?: string;
  port?: number;
  /** Map of project name → absolute path, populated from the registry at startup. */
  projects: Record<string, string>;
  /** Initial project shown if none specified. */
  defaultProject: string;
}

export function createApp(options: UiServerOptions): Hono {
  const app = new Hono();
  const bus = getSharedBus();

  const openDb = (project: string): Database => {
    const path = options.projects[project];
    if (!path) throw new Error(`Unknown project: ${project}`);
    return new Database(join(path, '.hq', 'db.sqlite'));
  };

  const projectNames = Object.keys(options.projects);
  const currentProject = (req: Request): string => {
    const url = new URL(req.url);
    const requested = url.searchParams.get('project');
    if (requested && projectNames.includes(requested)) return requested;
    return options.defaultProject;
  };

  app.get('/', (c) => c.redirect('/board'));

  const renderBoard = (project: string) => {
    const db = openDb(project);
    const tasks = db
      .prepare(
        `SELECT id, title, status, assignee, priority, package FROM tasks
         WHERE status != 'done' ORDER BY priority, created_at DESC`,
      )
      .all() as KanbanTask[];
    db.close();
    return <Kanban tasks={tasks} project={project} />;
  };

  app.get('/board', (c) => {
    const project = currentProject(c.req.raw);
    return c.html(
      <Layout project={project} projects={projectNames}>
        <div
          id="board"
          hx-get={`/board/inner?project=${project}`}
          hx-trigger="sse:task.status_changed from:body, sse:task.created from:body, sse:task.claimed from:body, sse:task.commented from:body, sse:task.reviewed from:body, sse:task.blocked from:body, sse:task.unblocked from:body, sse:task.pushed from:body"
          hx-swap="innerHTML"
        >
          {renderBoard(project)}
        </div>
        <div id="drawer" />
      </Layout>,
    );
  });

  app.get('/board/inner', (c) => {
    const project = currentProject(c.req.raw);
    return c.html(renderBoard(project));
  });

  app.get('/task/:id', (c) => {
    const id = c.req.param('id');
    const project = currentProject(c.req.raw);
    const db = openDb(project);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as KanbanTask | null;
    if (!task) {
      db.close();
      return c.notFound();
    }
    const comments = db.prepare('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at').all(id);
    const reviews = db.prepare('SELECT * FROM reviews WHERE task_id = ? ORDER BY created_at').all(id);
    db.close();
    return c.html(<TaskDrawer task={task} comments={comments} reviews={reviews} />);
  });

  app.get('/drawer/empty', (c) => c.html(<></>));

  app.get('/activity', (c) => {
    const project = currentProject(c.req.raw);
    const db = openDb(project);
    const items = db
      .prepare('SELECT agent, action, created_at, details FROM activity ORDER BY created_at DESC LIMIT 200')
      .all() as Array<{ agent: string; action: string; created_at: number; details: string }>;
    db.close();
    return c.html(
      <Layout project={project} projects={projectNames} title="Activity — HQ">
        <ActivityFeed items={items} />
      </Layout>,
    );
  });

  app.get('/agents', (c) => {
    const project = currentProject(c.req.raw);
    const db = openDb(project);
    const agents = db
      .prepare('SELECT name, status, last_heartbeat FROM agent_state')
      .all() as Array<{ name: string; status: string; last_heartbeat: number | null }>;
    db.close();
    return c.html(
      <Layout project={project} projects={projectNames} title="Agents — HQ">
        <AgentsList agents={agents} />
      </Layout>,
    );
  });

  // Usage widget — rendered HTML, refreshed via hx-trigger="sse:claude.usage_updated".
  app.get('/usage/widget', async (c) => {
    try {
      const { fetchUsage } = await import('@hq/usage');
      const snap = await fetchUsage();
      return c.html(<UsageWidget snap={snap} />);
    } catch {
      return c.html(<UsageWidget snap={null} />);
    }
  });

  // SSE stream.
  app.get('/events', (c) => {
    const project = currentProject(c.req.raw);
    return streamSSE(c, async (stream) => {
      const unsubscribe = bus.subscribe((event: HQEvent) => {
        void stream.writeSSE({
          event: event.type,
          data: JSON.stringify({ ...event, project }),
        });
      });
      c.req.raw.signal.addEventListener('abort', unsubscribe);
      // Keep alive.
      while (!c.req.raw.signal.aborted) {
        await stream.sleep(30_000);
        void stream.writeSSE({ event: 'ping', data: String(Date.now()) });
      }
    });
  });

  // Human actions
  app.post('/api/tasks/:id/approve', (c) => {
    const id = c.req.param('id');
    const project = currentProject(c.req.raw);
    const db = openDb(project);
    db.prepare(`UPDATE tasks SET status = 'approved', updated_at = ? WHERE id = ? AND status = 'review'`).run(
      Date.now(),
      id,
    );
    db.close();
    bus.publish({
      type: 'task.status_changed',
      task_id: id,
      from: 'review',
      to: 'approved',
      by: 'human',
    });
    return c.body(null, 204);
  });

  app.post('/api/tasks/:id/reject', (c) => {
    const id = c.req.param('id');
    const project = currentProject(c.req.raw);
    const db = openDb(project);
    db.prepare(
      `UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ? AND status = 'review'`,
    ).run(Date.now(), id);
    db.close();
    bus.publish({
      type: 'task.status_changed',
      task_id: id,
      from: 'review',
      to: 'in_progress',
      by: 'human',
    });
    return c.body(null, 204);
  });

  app.post('/api/tasks/:id/push', async (c) => {
    const id = c.req.param('id');
    const project = currentProject(c.req.raw);
    const projectPath = options.projects[project];
    if (!projectPath) return c.json({ error: 'unknown project' }, 400);
    const db = openDb(project);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
      | { status: string; branch: string | null }
      | null;
    if (!task || task.status !== 'approved' || !task.branch) {
      db.close();
      return c.json({ error: 'task not pushable' }, 400);
    }
    // Best-effort git push from the project root.
    const proc = Bun.spawn(['git', 'push', '-u', 'origin', task.branch], {
      cwd: projectPath,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await proc.exited;
    db.prepare(`UPDATE tasks SET status = 'done', pushed = 1, completed_at = ?, updated_at = ? WHERE id = ?`).run(
      Date.now(),
      Date.now(),
      id,
    );
    db.close();
    bus.publish({ type: 'task.pushed', task_id: id, branch: task.branch });
    bus.publish({
      type: 'task.status_changed',
      task_id: id,
      from: 'approved',
      to: 'done',
      by: 'human',
    });
    return c.body(null, 204);
  });

  app.post('/api/daemon/pause', (c) => {
    // The daemon listens to this via bus in-process.
    bus.publish({ type: 'daemon.quota_paused', week_all_pct: 0 });
    return c.body(null, 204);
  });

  return app;
}

export async function startUi(options: UiServerOptions): Promise<void> {
  const app = createApp(options);
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 7433;
  Bun.serve({ fetch: app.fetch, hostname: host, port, idleTimeout: 255 });
  console.log(`[ui] http://${host}:${port}`);
  // Push an initial usage snapshot via the bus so the widget renders something.
  void (async () => {
    try {
      const { fetchUsage } = await import('@hq/usage');
      const snap = await fetchUsage();
      getSharedBus().publish({
        type: 'claude.usage_updated',
        session_pct: snap.session_pct,
        week_all_pct: snap.week_all_pct,
        week_sonnet_pct: snap.week_sonnet_pct,
      });
    } catch {
      // non-fatal; widget stays in loading state
    }
  })();
  // Keep reference for tree-shaking of the widget renderer; otherwise unused.
  void UsageWidget;
}
