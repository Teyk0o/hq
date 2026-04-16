/** @jsxImportSource hono/jsx */
import { Database } from 'bun:sqlite';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { AgentConfigSchema, loadProjectConfig, newId, type HQEvent } from '@hq/core';
import { getSharedBus } from '@hq/mcp';
import { parse as parseToml } from 'smol-toml';
import {
  ActivityFeed,
  AgentsList,
  BoardHeader,
  GoalsPage,
  Inbox,
  Kanban,
  SettingsPage,
  SidebarAgents,
  TaskCreateForm,
  TaskDrawer,
  UsageWidget,
  type AgentPresentation,
  type Filters,
  type GenderHint,
  type GitCommit,
  type GoalRow,
  type KanbanTask,
} from './views';
import { Layout } from './layout';
import { openPullRequest } from './pr-helper';

export interface UiServerOptions {
  host?: string;
  port?: number;
  projects: Record<string, string>;
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

  /**
   * Load the presentation metadata (name + gender hint) for every agent in the
   * project. The gender hint biases the dicebear seed so two agents that share
   * a name stem still get distinct avatars; an empty gender falls through to
   * the neutral seed prefix. Cheap enough to do per-request since agent rosters
   * are a handful of files.
   */
  const loadAgentPresentations = async (project: string): Promise<AgentPresentation[]> => {
    const path = options.projects[project];
    if (!path) return [];
    const dir = join(path, '.hq', 'agents');
    let entries: string[] = [];
    try {
      entries = readdirSync(dir).filter((f) => f.endsWith('.toml'));
    } catch {
      return [];
    }
    const out: AgentPresentation[] = [];
    for (const file of entries) {
      try {
        const raw = await readFile(join(dir, file), 'utf-8');
        const parsed = AgentConfigSchema.parse(parseToml(raw));
        const agent: AgentPresentation = { name: parsed.agent.name };
        if (parsed.agent.gender) agent.gender = parsed.agent.gender;
        out.push(agent);
      } catch {
        // Skip malformed agent file; the rest of the roster still renders.
      }
    }
    return out;
  };

  const parseFilters = (req: Request): Filters => {
    const url = new URL(req.url);
    const priorityRaw = url.searchParams.get('priority');
    const priority = priorityRaw ? Number.parseInt(priorityRaw, 10) : undefined;
    return {
      assignee: url.searchParams.get('assignee') || undefined,
      priority: Number.isFinite(priority) ? priority : undefined,
      package: url.searchParams.get('package') || undefined,
      search: url.searchParams.get('search') || undefined,
    };
  };

  const renderBoard = (project: string, filters: Filters) => {
    const db = openDb(project);
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (filters.assignee) {
      conditions.push('t.assignee = ?');
      params.push(filters.assignee);
    }
    if (filters.priority) {
      conditions.push('t.priority = ?');
      params.push(filters.priority);
    }
    if (filters.package) {
      conditions.push('t.package = ?');
      params.push(filters.package);
    }
    if (filters.search) {
      conditions.push('t.title LIKE ?');
      params.push(`%${filters.search}%`);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    // GROUP_CONCAT(DISTINCT reviewer) gives us the unique reviewers so the
    // task card can render their avatar stack without N+1 queries.
    const rows = db
      .prepare(
        `SELECT t.id, t.title, t.status, t.assignee, t.priority, t.package,
                GROUP_CONCAT(DISTINCT r.reviewer) AS reviewer_names
           FROM tasks t
           LEFT JOIN reviews r ON r.task_id = t.id
           ${where}
           GROUP BY t.id
           ORDER BY t.priority, t.created_at DESC`,
      )
      .all(...params) as Array<KanbanTask & { reviewer_names: string | null }>;
    const tasks: KanbanTask[] = rows.map((r) => {
      const { reviewer_names, ...rest } = r;
      const reviewers = reviewer_names ? reviewer_names.split(',').filter(Boolean) : [];
      return { ...rest, reviewers };
    });
    const assignees = (db
      .prepare(`SELECT DISTINCT assignee FROM tasks WHERE assignee IS NOT NULL ORDER BY assignee`)
      .all() as Array<{ assignee: string }>).map((r) => r.assignee);
    const packages = (db
      .prepare(`SELECT DISTINCT package FROM tasks WHERE package IS NOT NULL ORDER BY package`)
      .all() as Array<{ package: string }>).map((r) => r.package);
    db.close();
    return { tasks, assignees, packages };
  };

  app.get('/', (c) => c.redirect(`/board?project=${options.defaultProject}`));

  app.get('/board', async (c) => {
    const project = currentProject(c.req.raw);
    const filters = parseFilters(c.req.raw);
    const { tasks, assignees, packages } = renderBoard(project, filters);
    const agents = await loadAgentPresentations(project);
    const queryParams = new URLSearchParams();
    queryParams.set('project', project);
    if (filters.assignee) queryParams.set('assignee', filters.assignee);
    if (filters.priority) queryParams.set('priority', String(filters.priority));
    if (filters.package) queryParams.set('package', filters.package);
    if (filters.search) queryParams.set('search', filters.search);
    return c.html(
      <Layout project={project} projects={projectNames} title="Board" page="board">
        {/* Single swap target: filter bar + grid together, so clicking a pill
            updates BOTH the active-pill state and the kanban without a reload. */}
        <div
          id="board-surface"
          class="flex-1 min-h-0 flex flex-col"
          hx-get={`/board/inner?${queryParams.toString()}`}
          hx-trigger="sse:task.status_changed from:body, sse:task.created from:body, sse:task.claimed from:body, sse:task.blocked from:body, sse:task.unblocked from:body, sse:task.pushed from:body"
          hx-swap="innerHTML"
        >
          <BoardHeader
            project={project}
            filters={filters}
            assignees={assignees}
            packages={packages}
          />
          <div id="board" class="flex-1 min-h-0">
            <Kanban tasks={tasks} project={project} agents={agents} />
          </div>
        </div>
        <div id="drawer" />
      </Layout>,
    );
  });

  app.get('/board/inner', async (c) => {
    const project = currentProject(c.req.raw);
    const filters = parseFilters(c.req.raw);
    const { tasks, assignees, packages } = renderBoard(project, filters);
    const agents = await loadAgentPresentations(project);
    return c.html(
      <>
        <BoardHeader
          project={project}
          filters={filters}
          assignees={assignees}
          packages={packages}
        />
        <div id="board" class="flex-1 min-h-0">
          <Kanban tasks={tasks} project={project} agents={agents} />
        </div>
      </>,
    );
  });

  app.get('/task/new', (c) => {
    const project = currentProject(c.req.raw);
    return c.html(<TaskCreateForm project={project} />);
  });

  app.get('/task/:id', async (c) => {
    const id = c.req.param('id');
    const project = currentProject(c.req.raw);
    const projectPath = options.projects[project];
    const db = openDb(project);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
      | (KanbanTask & { description?: string; branch?: string | null })
      | null;
    if (!task) {
      db.close();
      return c.notFound();
    }
    const comments = db
      .prepare('SELECT author, body, created_at FROM comments WHERE task_id = ? ORDER BY created_at')
      .all(id) as Array<{ author: string; body: string; created_at: number }>;
    const reviews = db
      .prepare(
        'SELECT reviewer, verdict, body, created_at FROM reviews WHERE task_id = ? ORDER BY created_at',
      )
      .all(id) as Array<{ reviewer: string; verdict: string; body: string; created_at: number }>;
    db.close();
    const commits =
      projectPath && task.branch ? gitCommitsForBranch(projectPath, task.branch) : [];
    const agents = await loadAgentPresentations(project);
    return c.html(
      <TaskDrawer
        task={task}
        comments={comments}
        reviews={reviews}
        commits={commits}
        project={project}
        agents={agents}
      />,
    );
  });

  app.get('/drawer/empty', (c) => c.html(<></>));

  app.get('/activity', async (c) => {
    const project = currentProject(c.req.raw);
    const db = openDb(project);
    const items = db
      .prepare(
        'SELECT agent, action, created_at, details, task_id FROM activity ORDER BY created_at DESC LIMIT 200',
      )
      .all() as Array<{
      agent: string;
      action: string;
      created_at: number;
      details: string;
      task_id: string | null;
    }>;
    db.close();
    const agents = await loadAgentPresentations(project);
    return c.html(
      <Layout project={project} projects={projectNames} title="Activity" page="activity">
        <ActivityFeed items={items} agents={agents} />
      </Layout>,
    );
  });

  app.get('/agents', async (c) => {
    const project = currentProject(c.req.raw);
    const db = openDb(project);
    const states = db
      .prepare(
        'SELECT name, status, last_heartbeat, current_task_id, tokens_today, tokens_budget FROM agent_state ORDER BY name',
      )
      .all() as Array<{
      name: string;
      status: string;
      last_heartbeat: number | null;
      current_task_id: string | null;
      tokens_today: number;
      tokens_budget: number;
    }>;
    db.close();
    const presentations = await loadAgentPresentations(project);
    const genderByName = new Map(presentations.map((p) => [p.name, p.gender]));
    const merged = states.map((s) => {
      const gender = genderByName.get(s.name);
      return gender ? { ...s, gender: gender as GenderHint } : s;
    });
    return c.html(
      <Layout project={project} projects={projectNames} title="Agents" page="agents">
        <AgentsList agents={merged} />
      </Layout>,
    );
  });

  app.get('/agents/sidebar', async (c) => {
    const project = currentProject(c.req.raw);
    const db = openDb(project);
    const states = db
      .prepare(`SELECT name, status FROM agent_state WHERE status != 'archived' ORDER BY name`)
      .all() as Array<{ name: string; status: string }>;
    db.close();
    const presentations = await loadAgentPresentations(project);
    const genderByName = new Map(presentations.map((p) => [p.name, p.gender]));
    const merged = states.map((s) => {
      const gender = genderByName.get(s.name);
      return gender ? { ...s, gender: gender as GenderHint } : s;
    });
    return c.html(<SidebarAgents agents={merged} />);
  });

  const renderGoalsRoot = (project: string) => {
    const db = openDb(project);
    const rows = db
      .prepare(
        `SELECT g.id, g.title, g.description, g.assignees, g.tasks_per_week, g.active,
            (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id AND t.status != 'done') AS open_tasks
         FROM goals g ORDER BY g.active DESC, g.created_at DESC`,
      )
      .all() as Array<{
      id: string;
      title: string;
      description: string;
      assignees: string;
      tasks_per_week: number;
      active: number;
      open_tasks: number;
    }>;
    db.close();
    const goals: GoalRow[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      assignees: JSON.parse(r.assignees || '[]') as string[],
      tasks_per_week: r.tasks_per_week,
      active: Boolean(r.active),
      open_tasks: r.open_tasks,
    }));
    return goals;
  };

  app.get('/goals', async (c) => {
    const project = currentProject(c.req.raw);
    const goals = renderGoalsRoot(project);
    const agents = await loadAgentPresentations(project);
    return c.html(
      <Layout project={project} projects={projectNames} title="Goals" page="goals">
        <div id="goals-root">
          <GoalsPage project={project} goals={goals} agents={agents} />
        </div>
      </Layout>,
    );
  });

  // Returns the goals-root fragment only, for HTMX swaps after mutations.
  const goalsFragment = async (project: string) => {
    const goals = renderGoalsRoot(project);
    const agents = await loadAgentPresentations(project);
    return (
      <div id="goals-root">
        <GoalsPage project={project} goals={goals} agents={agents} />
      </div>
    );
  };

  app.post('/api/goals', async (c) => {
    const project = currentProject(c.req.raw);
    const form = await c.req.parseBody();
    const id = String(form.id ?? '').trim();
    const title = String(form.title ?? '').trim();
    if (!id || !title) return c.json({ error: 'id and title required' }, 400);
    const description = String(form.description ?? '').trim();
    const assignees = String(form.assignees ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const tpw = Number.parseInt(String(form.tasks_per_week ?? '0'), 10) || 0;
    const db = openDb(project);
    db.prepare(
      `INSERT INTO goals (id, title, description, assignees, tasks_per_week, active)
       VALUES (?, ?, ?, ?, ?, 1)`,
    ).run(id, title, description, JSON.stringify(assignees), tpw);
    db.close();
    bus.publish({ type: 'goal.created', goal_id: id });
    return c.html(await goalsFragment(project));
  });

  app.post('/api/goals/:id/toggle', async (c) => {
    const project = currentProject(c.req.raw);
    const id = c.req.param('id');
    const db = openDb(project);
    db.prepare(
      `UPDATE goals SET active = 1 - active, updated_at = ? WHERE id = ?`,
    ).run(Date.now(), id);
    db.close();
    bus.publish({ type: 'goal.updated', goal_id: id });
    return c.html(await goalsFragment(project));
  });

  app.delete('/api/goals/:id', async (c) => {
    const project = currentProject(c.req.raw);
    const id = c.req.param('id');
    const db = openDb(project);
    db.prepare(`DELETE FROM goals WHERE id = ?`).run(id);
    db.close();
    bus.publish({ type: 'goal.updated', goal_id: id });
    return c.html(await goalsFragment(project));
  });

  app.get('/settings', async (c) => {
    const project = currentProject(c.req.raw);
    const projectPath = options.projects[project];
    if (!projectPath) return c.notFound();
    const tomlPath = join(projectPath, '.hq', 'project.toml');
    const cfg = await loadProjectConfig(tomlPath);
    return c.html(
      <Layout project={project} projects={projectNames} title="Settings" page="settings">
        <SettingsPage project={project} config={cfg} tomlPath={tomlPath} />
      </Layout>,
    );
  });

  app.get('/inbox', async (c) => {
    const project = currentProject(c.req.raw);
    const db = openDb(project);
    const messages = db
      .prepare(
        'SELECT id, from_agent, to_agent, subject, body, created_at, read_at FROM messages ORDER BY created_at DESC LIMIT 200',
      )
      .all() as Array<{
      id: string;
      from_agent: string;
      to_agent: string;
      subject: string;
      body: string;
      created_at: number;
      read_at: number | null;
    }>;
    // Mark all messages (to human or broadcast) as read when the user opens
    // the inbox. Agent-directed messages are marked read when the agent's
    // MCP read_messages tool is called.
    db.prepare(
      `UPDATE messages SET read_at = ? WHERE read_at IS NULL AND (to_agent = '*' OR to_agent = 'human')`,
    ).run(Date.now());
    db.close();
    const agents = await loadAgentPresentations(project);
    return c.html(
      <Layout project={project} projects={projectNames} title="Inbox" page="inbox">
        <Inbox messages={messages} agents={agents} project={project} />
      </Layout>,
    );
  });

  // Unread count for the sidebar badge — broadcasts and messages directly
  // addressed to the human that haven't been viewed yet.
  app.get('/inbox/unread', (c) => {
    const project = currentProject(c.req.raw);
    const db = openDb(project);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages WHERE read_at IS NULL AND (to_agent = '*' OR to_agent = 'human')`,
      )
      .get() as { n: number };
    db.close();
    return c.html(
      row.n > 0 ? (
        <span
          class="ml-auto text-[11px] px-2 py-0.5 rounded-full font-semibold text-white"
          style="background: var(--accent); min-width: 18px; text-align: center"
        >
          {row.n}
        </span>
      ) : (
        <span></span>
      ),
    );
  });

  // Human compose: send a message to an agent (or broadcast to all).
  app.post('/api/messages', async (c) => {
    const project = currentProject(c.req.raw);
    const form = await c.req.parseBody();
    const to = String(form.to ?? '').trim();
    const subject = String(form.subject ?? '').trim();
    const body = String(form.body ?? '').trim();
    if (!to || !body) return c.json({ error: 'to + body required' }, 400);
    const db = openDb(project);
    const id = newId();
    db.prepare(
      `INSERT INTO messages (id, from_agent, to_agent, subject, body) VALUES (?, 'human', ?, ?, ?)`,
    ).run(id, to, subject, body);
    db.close();
    bus.publish({ type: 'message.sent', from: 'human', to, message_id: id });
    return c.redirect(`/inbox?project=${project}`);
  });

  app.get('/usage/widget', async (c) => {
    try {
      const { fetchUsage } = await import('@hq/usage');
      const snap = await fetchUsage();
      return c.html(<UsageWidget snap={snap} />);
    } catch {
      return c.html(<UsageWidget snap={null} />);
    }
  });

  // SSE stream
  app.get('/events', (c) => {
    return streamSSE(c, async (stream) => {
      const unsubscribe = bus.subscribe((event: HQEvent) => {
        void stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });
      });
      c.req.raw.signal.addEventListener('abort', unsubscribe);
      while (!c.req.raw.signal.aborted) {
        await stream.sleep(25_000);
        void stream.writeSSE({ event: 'ping', data: String(Date.now()) });
      }
    });
  });

  app.post('/api/events', async (c) => {
    try {
      const event = (await c.req.json()) as HQEvent;
      bus.publish(event);
    } catch {
      return c.json({ error: 'invalid payload' }, 400);
    }
    return c.body(null, 204);
  });

  app.post('/api/tasks', async (c) => {
    const project = currentProject(c.req.raw);
    const form = await c.req.parseBody();
    const title = String(form.title ?? '').trim();
    if (!title) return c.json({ error: 'title required' }, 400);
    const description = String(form.description ?? '').trim();
    const priorityRaw = String(form.priority ?? '3');
    const priority = Number.isFinite(Number.parseInt(priorityRaw, 10))
      ? Number.parseInt(priorityRaw, 10)
      : 3;
    const pkg = String(form.package ?? '').trim() || null;
    const rawStatus = String(form.status ?? 'todo');
    const status = rawStatus === 'backlog' ? 'backlog' : 'todo';

    const db = openDb(project);
    const id = newId();
    db.prepare(
      `INSERT INTO tasks (id, title, description, priority, package, created_by, status)
       VALUES (?, ?, ?, ?, ?, 'human', ?)`,
    ).run(id, title, description, priority, pkg, status);
    db.close();

    bus.publish({ type: 'task.created', task_id: id, by: 'human' });
    return c.html(<></>);
  });

  app.post('/api/tasks/:id/comments', async (c) => {
    const id = c.req.param('id');
    const project = currentProject(c.req.raw);
    const form = await c.req.parseBody();
    const body = String(form.body ?? '').trim();
    if (!body) return c.json({ error: 'body required' }, 400);
    const db = openDb(project);
    const task = db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(id) as
      | { id: string; title: string }
      | null;
    if (!task) {
      db.close();
      return c.json({ error: 'task not found' }, 404);
    }
    const mentions = extractMentions(body);
    const commentId = newId();
    db.prepare(
      `INSERT INTO comments (id, task_id, author, body, mentions) VALUES (?, ?, 'human', ?, ?)`,
    ).run(commentId, id, body, JSON.stringify(mentions));
    // Convert each @mention into an inbox message so the recipient sees it
    // alongside agent-to-agent DMs, and so the message.sent event can trigger
    // an idle agent to wake up.
    const fanoutIds: Array<{ to: string; id: string }> = [];
    for (const mention of mentions) {
      const msgId = newId();
      db.prepare(
        `INSERT INTO messages (id, from_agent, to_agent, subject, body)
         VALUES (?, 'human', ?, ?, ?)`,
      ).run(msgId, mention, `You were mentioned on: ${task.title}`, body);
      fanoutIds.push({ to: mention, id: msgId });
    }
    db.close();
    bus.publish({
      type: 'task.commented',
      task_id: id,
      author: 'human',
      comment_id: commentId,
    });
    for (const f of fanoutIds) {
      bus.publish({ type: 'message.sent', from: 'human', to: f.to, message_id: f.id });
    }
    const refreshed = await renderTaskDrawer(project, id);
    if (!refreshed) return c.json({ error: 'task disappeared' }, 404);
    return c.html(refreshed);
  });

  /** Shared renderer so /task/:id GET and POST comment return the same HTML. */
  const renderTaskDrawer = async (project: string, id: string) => {
    const projectPath = options.projects[project];
    const db = openDb(project);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
      | (KanbanTask & { description?: string; branch?: string | null })
      | null;
    if (!task) {
      db.close();
      return null;
    }
    const comments = db
      .prepare('SELECT author, body, created_at FROM comments WHERE task_id = ? ORDER BY created_at')
      .all(id) as Array<{ author: string; body: string; created_at: number }>;
    const reviews = db
      .prepare(
        'SELECT reviewer, verdict, body, created_at FROM reviews WHERE task_id = ? ORDER BY created_at',
      )
      .all(id) as Array<{ reviewer: string; verdict: string; body: string; created_at: number }>;
    db.close();
    const commits =
      projectPath && task.branch ? gitCommitsForBranch(projectPath, task.branch) : [];
    const agents = await loadAgentPresentations(project);
    return (
      <TaskDrawer
        task={task}
        comments={comments}
        reviews={reviews}
        commits={commits}
        project={project}
        agents={agents}
      />
    );
  };

  app.post('/api/tasks/:id/approve', (c) => {
    const id = c.req.param('id');
    const project = currentProject(c.req.raw);
    const db = openDb(project);
    db.prepare(
      `UPDATE tasks SET status = 'approved', updated_at = ? WHERE id = ? AND status = 'review'`,
    ).run(Date.now(), id);
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

  /**
   * Push the agent's branch to origin under the human's git identity. We
   * deliberately run git push from the daemon process (not from inside the
   * agent's bwrap sandbox) so the user's SSH keys and ~/.netrc are used
   * directly without having to thread them through. Error stderr is
   * surfaced so the UI can toast a real message on auth / conflict failures.
   */
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

    // Before pushing, fetch origin and try to rebase the agent's branch onto
    // the project's default branch. If the rebase conflicts, we leave the
    // branch as-is, flip the task to blocked with a reason, and bail out —
    // the human (or the author agent) must resolve the conflict manually.
    const cfgForPush = await loadProjectConfig(join(projectPath, '.hq', 'project.toml'));
    const defaultBranch = cfgForPush.project.default_branch;

    const fetch = Bun.spawnSync(['git', 'fetch', 'origin', defaultBranch], {
      cwd: projectPath,
    });
    if (fetch.exitCode !== 0) {
      console.warn(`[push] fetch failed for ${id}: ${fetch.stderr.toString().trim()}`);
      // Not fatal — we can still try to push. If origin is unreachable the
      // subsequent push will fail with a clean error.
    }

    const rebase = Bun.spawnSync(
      ['git', 'rebase', `origin/${defaultBranch}`, task.branch],
      { cwd: projectPath },
    );
    if (rebase.exitCode !== 0) {
      // Abort the half-done rebase so we don't leave the working copy dirty.
      Bun.spawnSync(['git', 'rebase', '--abort'], { cwd: projectPath });
      const reason = `merge conflict against ${defaultBranch}: ${rebase.stderr.toString().trim().slice(0, 400)}`;
      db.prepare(
        `UPDATE tasks SET status = 'blocked', blocked_reason = ?, updated_at = ? WHERE id = ?`,
      ).run(reason, Date.now(), id);
      db.close();
      bus.publish({ type: 'task.blocked', task_id: id, reason });
      bus.publish({
        type: 'task.status_changed',
        task_id: id,
        from: 'approved',
        to: 'blocked',
        by: 'human',
      });
      return c.json({ error: reason }, 409);
    }

    const push = Bun.spawnSync(['git', 'push', '-u', '--force-with-lease', 'origin', task.branch], {
      cwd: projectPath,
    });
    if (push.exitCode !== 0) {
      db.close();
      const stderr = push.stderr.toString().trim() || 'git push failed';
      return c.json({ error: stderr }, 422);
    }

    // Fetch the task title so we can use it as the PR title.
    const full = db.prepare('SELECT title FROM tasks WHERE id = ?').get(id) as
      | { title: string }
      | undefined;
    const pr = await openPullRequest(projectPath, task.branch, full?.title ?? `Task ${id}`);
    if (pr.error) {
      console.warn(`[push] PR creation skipped for ${id}: ${pr.error}`);
    }

    db.prepare(
      `UPDATE tasks SET status = 'done', pushed = 1, pr_url = COALESCE(?, pr_url),
         completed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(pr.url ?? null, Date.now(), Date.now(), id);

    // Auto-unblock: any blocked task whose sole remaining dep was this one
    // becomes claimable. We only demote to 'todo' if every declared dep is
    // now 'done'; partial completion leaves it blocked.
    const dependents = db
      .prepare(
        `SELECT task_id FROM task_dependencies WHERE depends_on = ?`,
      )
      .all(id) as Array<{ task_id: string }>;
    const unblocked: string[] = [];
    for (const dep of dependents) {
      const remaining = db
        .prepare(
          `SELECT COUNT(*) AS n FROM task_dependencies d
             LEFT JOIN tasks t ON t.id = d.depends_on
             WHERE d.task_id = ? AND COALESCE(t.status,'backlog') != 'done'`,
        )
        .get(dep.task_id) as { n: number };
      if (remaining.n === 0) {
        const target = db
          .prepare(`SELECT status FROM tasks WHERE id = ?`)
          .get(dep.task_id) as { status: string } | undefined;
        if (target?.status === 'blocked') {
          db.prepare(
            `UPDATE tasks SET status = 'todo', blocked_reason = NULL, updated_at = ? WHERE id = ?`,
          ).run(Date.now(), dep.task_id);
          unblocked.push(dep.task_id);
        }
      }
    }

    db.close();
    bus.publish({ type: 'task.pushed', task_id: id, branch: task.branch });
    bus.publish({
      type: 'task.status_changed',
      task_id: id,
      from: 'approved',
      to: 'done',
      by: 'human',
    });
    for (const uid of unblocked) {
      bus.publish({ type: 'task.unblocked', task_id: uid });
      bus.publish({
        type: 'task.status_changed',
        task_id: uid,
        from: 'blocked',
        to: 'todo',
        by: 'daemon',
      });
    }
    return c.body(null, 204);
  });

  app.post('/api/daemon/pause', (c) => {
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
      // non-fatal
    }
  })();
}

function extractMentions(body: string): string[] {
  const re = /@([a-z][a-z0-9_-]*)/gi;
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    seen.add(match[1]!.toLowerCase());
  }
  return [...seen];
}

/**
 * Read the last N commits on the given branch. Uses Bun.spawnSync so the
 * handler stays synchronous; the dataset is small (10 commits max) and these
 * handlers are single-user local.
 */
function gitCommitsForBranch(projectPath: string, branch: string, limit = 10): GitCommit[] {
  try {
    const sync = Bun.spawnSync([
      'git',
      '-C',
      projectPath,
      'log',
      '--pretty=format:%H%x1f%s%x1f%an%x1f%ai',
      `-${limit}`,
      branch,
      '--',
    ]);
    if (sync.exitCode !== 0) return [];
    const text = sync.stdout.toString().trim();
    if (!text) return [];
    const commits: GitCommit[] = [];
    for (const line of text.split('\n')) {
      const [hash, subject, author, at] = line.split('\x1f');
      if (!hash) continue;
      const stats = gitShortStat(projectPath, hash);
      commits.push({
        hash,
        subject: subject ?? '',
        author: author ?? '',
        at: at ?? '',
        ...(stats ? { stats } : {}),
      });
    }
    return commits;
  } catch {
    return [];
  }
}

function gitShortStat(projectPath: string, hash: string): string | null {
  try {
    const sync = Bun.spawnSync([
      'git',
      '-C',
      projectPath,
      'show',
      '--shortstat',
      '--oneline',
      hash,
    ]);
    if (sync.exitCode !== 0) return null;
    const line = sync.stdout
      .toString()
      .split('\n')
      .find((l) => /file.+changed/.test(l));
    return line ? line.trim() : null;
  } catch {
    return null;
  }
}
