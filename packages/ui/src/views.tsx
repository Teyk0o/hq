/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { avatarBackground, avatarUrl, type TaskState } from '@hq/core';
import type { UsageSnapshot } from '@hq/usage';

export type GenderHint = 'female' | 'male' | 'neutral' | undefined;
export interface AgentPresentation {
  name: string;
  gender?: GenderHint;
}

const COLUMNS: { state: TaskState; label: string; accent: string; icon: string }[] = [
  { state: 'backlog', label: 'Backlog', accent: 'var(--ink-faint)', icon: 'inbox' },
  { state: 'todo', label: 'To do', accent: 'var(--teal)', icon: 'circle-dashed' },
  { state: 'in_progress', label: 'In progress', accent: 'var(--warn)', icon: 'loader' },
  { state: 'peer_review', label: 'Peer review', accent: 'var(--violet)', icon: 'users' },
  { state: 'review', label: 'Your review', accent: 'var(--accent)', icon: 'eye' },
  { state: 'approved', label: 'Approved', accent: 'var(--success)', icon: 'check' },
  { state: 'done', label: 'Done', accent: 'var(--ink-faint)', icon: 'check-check' },
];

export interface KanbanTask {
  id: string;
  title: string;
  status: TaskState;
  assignee: string | null;
  priority: number;
  package: string | null;
}

export interface Filters {
  assignee?: string | undefined;
  priority?: number | undefined;
  package?: string | undefined;
  search?: string | undefined;
}

export const FilterBar: FC<{
  filters: Filters;
  project: string;
  assignees: string[];
  packages: string[];
}> = ({ filters, project, assignees, packages }) => {
  const qs = (override: Partial<Filters>): string => {
    const merged = { ...filters, ...override };
    const params = new URLSearchParams();
    params.set('project', project);
    if (merged.assignee) params.set('assignee', merged.assignee);
    if (merged.priority) params.set('priority', String(merged.priority));
    if (merged.package) params.set('package', merged.package);
    if (merged.search) params.set('search', merged.search);
    return `/board?${params.toString()}`;
  };
  const hasFilter = !!(filters.assignee || filters.priority || filters.package || filters.search);
  return (
    <div class="flex flex-wrap items-center gap-2">
      <a href={qs({ assignee: undefined, priority: undefined, package: undefined, search: undefined })} class={`pill ${!hasFilter ? 'pill-active' : ''}`}>
        All
      </a>
      {assignees.length > 0 && <span class="text-faint text-[11px]">·</span>}
      {assignees.map((a) => (
        <a
          href={qs({ assignee: filters.assignee === a ? undefined : a })}
          class={`pill ${filters.assignee === a ? 'pill-active' : ''}`}
        >
          @{a}
        </a>
      ))}
      <span class="text-faint text-[11px]">·</span>
      {[1, 2, 3, 4, 5].map((p) => (
        <a
          href={qs({ priority: filters.priority === p ? undefined : p })}
          class={`pill ${filters.priority === p ? 'pill-active' : ''}`}
        >
          P{p}
        </a>
      ))}
      {packages.length > 0 && <span class="text-faint text-[11px]">·</span>}
      {packages.map((p) => (
        <a
          href={qs({ package: filters.package === p ? undefined : p })}
          class={`pill ${filters.package === p ? 'pill-active' : ''}`}
        >
          {p}
        </a>
      ))}
    </div>
  );
};

export const BoardHeader: FC<{
  project: string;
  filters: Filters;
  assignees: string[];
  packages: string[];
}> = ({ project, filters, assignees, packages }) => (
  <div class="flex items-center justify-between gap-4 mb-5">
    <FilterBar filters={filters} project={project} assignees={assignees} packages={packages} />
    <div class="flex items-center gap-2">
      <form action="/board" method="get" class="flex items-center">
        <input type="hidden" name="project" value={project} />
        {filters.assignee && <input type="hidden" name="assignee" value={filters.assignee} />}
        {filters.priority && <input type="hidden" name="priority" value={String(filters.priority)} />}
        {filters.package && <input type="hidden" name="package" value={filters.package} />}
        <div class="relative">
          <i data-lucide="search" class="icon-sm" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--ink-faint)"></i>
          <input
            type="search"
            name="search"
            value={filters.search ?? ''}
            placeholder="Search tasks…"
            class="field text-[12px] pl-8 w-56"
          />
        </div>
      </form>
      <button
        class="btn btn-primary"
        hx-get={`/task/new?project=${project}`}
        hx-target="#drawer"
        hx-swap="innerHTML"
      >
        <i data-lucide="plus"></i> New task
      </button>
    </div>
  </div>
);

export const Kanban: FC<{ tasks: KanbanTask[]; project: string; agents: AgentPresentation[] }> = ({
  tasks,
  project,
  agents,
}) => (
  <div
    class="grid gap-4 pb-4 overflow-x-auto swap-in"
    style="grid-template-columns: repeat(7, minmax(270px, 1fr))"
  >
    {COLUMNS.map((col) => {
      const colTasks = tasks.filter((t) => t.status === col.state);
      return (
        <section class="flex flex-col">
          <header class="flex items-center gap-2 px-1 mb-3">
            <span class="inline-flex items-center justify-center" style={`color:${col.accent}`}>
              <i data-lucide={col.icon} class="icon-sm"></i>
            </span>
            <h2 class="text-[13px] font-medium">{col.label}</h2>
            <span class="text-[11px] text-faint mono ml-auto">{colTasks.length}</span>
          </header>
          <div class="flex flex-col gap-2.5">
            {colTasks.length === 0 && (
              <div class="text-[12px] text-faint py-4 px-1 text-center italic">Empty</div>
            )}
            {colTasks.map((t) => (
              <TaskCard task={t} project={project} accent={col.accent} agents={agents} />
            ))}
          </div>
        </section>
      );
    })}
  </div>
);

const priorityPill = (p: number): { label: string; color: string; bg: string } => {
  if (p <= 1) return { label: 'P1', color: 'var(--danger)', bg: 'var(--danger-soft)' };
  if (p === 2) return { label: 'P2', color: 'var(--warn)', bg: 'var(--warn-soft)' };
  return { label: `P${p}`, color: 'var(--ink-muted)', bg: 'var(--surface-alt)' };
};

const agentFor = (agents: AgentPresentation[], name: string): AgentPresentation =>
  agents.find((a) => a.name === name) ?? { name };

const Avatar: FC<{ agent: AgentPresentation; size?: number; className?: string }> = ({
  agent,
  size = 24,
  className = '',
}) => (
  <img
    src={avatarUrl({ name: agent.name, ...(agent.gender ? { gender: agent.gender } : {}), size: size * 2 })}
    alt={agent.name}
    class={`rounded-full shrink-0 ${className}`}
    style={`width:${size}px;height:${size}px;background:#${avatarBackground(agent.name)}`}
  />
);

export const TaskCard: FC<{
  task: KanbanTask;
  project: string;
  accent: string;
  agents: AgentPresentation[];
}> = ({ task, project, accent, agents }) => {
  const prio = priorityPill(task.priority);
  return (
    <div
      class="card p-3.5 cursor-pointer transition-shadow"
      style={`border-top: 3px solid ${accent}`}
      hx-get={`/task/${task.id}?project=${project}`}
      hx-target="#drawer"
      hx-swap="innerHTML"
    >
      <div class="flex items-start justify-between gap-2">
        <span class="text-[13.5px] font-medium leading-snug">{task.title}</span>
        <span
          class="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full mono"
          style={`color:${prio.color}; background:${prio.bg}`}
        >
          {prio.label}
        </span>
      </div>
      <div class="mt-3 flex items-center gap-2">
        {task.assignee ? (
          <span class="inline-flex items-center gap-1.5 text-[11px] text-muted">
            <Avatar agent={agentFor(agents, task.assignee)} size={18} />
            {task.assignee}
          </span>
        ) : (
          <span class="text-[11px] text-faint italic inline-flex items-center gap-1">
            <i data-lucide="user" class="icon-sm"></i>
            unassigned
          </span>
        )}
        {task.package && (
          <span class="text-[10px] text-muted px-2 py-0.5 rounded-full border border-soft">
            {task.package}
          </span>
        )}
        <span class="ml-auto text-[10px] text-faint mono">{task.id.slice(0, 6)}</span>
      </div>
    </div>
  );
};

export const UsageWidget: FC<{ snap: UsageSnapshot | null }> = ({ snap }) => {
  if (!snap) return <span class="text-[12px] text-faint">usage loading…</span>;
  return (
    <>
      <UsagePill label="Session" pct={snap.session_pct} />
      <UsagePill label="Week" pct={snap.week_all_pct} />
      <UsagePill label="Sonnet" pct={snap.week_sonnet_pct} />
    </>
  );
};

const UsagePill: FC<{ label: string; pct: number }> = ({ label, pct }) => {
  const color = pct >= 80 ? 'var(--danger)' : pct >= 60 ? 'var(--warn)' : 'var(--success)';
  const bg = pct >= 80 ? 'var(--danger-soft)' : pct >= 60 ? 'var(--warn-soft)' : 'var(--success-soft)';
  return (
    <span
      class="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full"
      style={`color:${color}; background:${bg}`}
    >
      <span class="font-medium">{label}</span>
      <span class="mono font-semibold">{pct}%</span>
    </span>
  );
};

export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  at: string;
  stats?: string;
}

export const TaskDrawer: FC<{
  task: KanbanTask & { description?: string; branch?: string | null };
  comments: Array<{ author: string; body: string; created_at: number }>;
  reviews: Array<{ reviewer: string; verdict: string; body: string; created_at: number }>;
  commits: GitCommit[];
  project: string;
  agents: AgentPresentation[];
}> = ({ task, comments, reviews, commits, project, agents }) => {
  const statusAccent = COLUMNS.find((c) => c.state === task.status)?.accent ?? 'var(--ink-faint)';
  return (
    <div class="drawer fixed right-0 top-0 h-full w-[480px] bg-white border-l border-soft overflow-y-auto z-30" style="background: var(--surface); box-shadow: -8px 0 32px rgba(31,30,26,0.06)">
      <div class="sticky top-0 border-b border-soft px-6 py-3 flex items-center justify-between" style="background: var(--surface)">
        <span class="text-[11px] text-faint mono">{task.id}</span>
        <button
          class="btn text-[12px] px-2 py-1"
          hx-get="/drawer/empty"
          hx-target="#drawer"
          aria-label="close"
        >
          <i data-lucide="x"></i>
        </button>
      </div>
      <div class="px-6 py-5">
        <h2 class="text-[22px] font-semibold leading-tight serif">{task.title}</h2>
        <div class="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
          <span
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px]"
            style={`color:${statusAccent}; background: color-mix(in srgb, ${statusAccent} 18%, transparent)`}
          >
            <span class="w-1.5 h-1.5 rounded-full" style={`background:${statusAccent}`} />
            {COLUMNS.find((c) => c.state === task.status)?.label ?? task.status}
          </span>
          {task.assignee && (
            <span class="inline-flex items-center gap-1.5 text-muted">
              <Avatar agent={agentFor(agents, task.assignee)} size={18} />
              {task.assignee}
            </span>
          )}
          {task.branch && (
            <span class="inline-flex items-center gap-1.5 text-muted mono text-[11px]">
              <i data-lucide="git-branch" class="icon-sm"></i>
              {task.branch}
            </span>
          )}
        </div>

        {task.description && (
          <div class="mt-4 text-[13px] text-muted whitespace-pre-wrap leading-relaxed">{task.description}</div>
        )}

        {task.status === 'review' && (
          <div class="mt-5 flex gap-2">
            <button
              class="btn btn-success flex-1 justify-center"
              hx-post={`/api/tasks/${task.id}/approve`}
              hx-swap="none"
            >
              <i data-lucide="check"></i> Approve
            </button>
            <button
              class="btn btn-danger flex-1 justify-center"
              hx-post={`/api/tasks/${task.id}/reject`}
              hx-swap="none"
            >
              <i data-lucide="x"></i> Reject
            </button>
          </div>
        )}
        {task.status === 'approved' && (
          <button
            class="btn btn-primary mt-5 w-full justify-center"
            hx-post={`/api/tasks/${task.id}/push`}
            hx-swap="none"
          >
            <i data-lucide="upload"></i> Push & mark done
          </button>
        )}

        {commits.length > 0 && (
          <section class="mt-7">
            <h3 class="text-[11px] uppercase tracking-wider text-faint mb-2 flex items-center gap-1.5">
              <i data-lucide="git-commit" class="icon-sm"></i> Commits · <span class="mono">{commits.length}</span>
            </h3>
            <ul class="space-y-1.5">
              {commits.map((c) => (
                <li class="card px-3 py-2">
                  <div class="flex items-center gap-2 text-[12px]">
                    <span class="mono text-faint">{c.hash.slice(0, 7)}</span>
                    <span class="flex-1 truncate">{c.subject}</span>
                    <span class="text-[10px] text-faint">{c.author}</span>
                  </div>
                  {c.stats && <div class="text-[11px] text-faint mono mt-0.5">{c.stats}</div>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section class="mt-7">
          <h3 class="text-[11px] uppercase tracking-wider text-faint mb-2 flex items-center gap-1.5">
            <i data-lucide="message-square-check" class="icon-sm"></i> Reviews · <span class="mono">{reviews.length}</span>
          </h3>
          {reviews.length === 0 ? (
            <p class="text-[12px] text-faint italic">No reviews yet.</p>
          ) : (
            <ul class="space-y-2">
              {reviews.map((r) => (
                <li class="card p-3">
                  <div class="flex items-center gap-2 mb-1">
                    <Avatar agent={agentFor(agents, r.reviewer)} size={18} />
                    <span class="font-medium text-[13px]">{r.reviewer}</span>
                    <span class="ml-auto"><VerdictBadge verdict={r.verdict} /></span>
                  </div>
                  {r.body && <div class="text-[13px] text-muted whitespace-pre-wrap">{r.body}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section class="mt-7">
          <h3 class="text-[11px] uppercase tracking-wider text-faint mb-2 flex items-center gap-1.5">
            <i data-lucide="message-circle" class="icon-sm"></i> Comments · <span class="mono">{comments.length}</span>
          </h3>
          {comments.length === 0 ? (
            <p class="text-[12px] text-faint italic mb-3">No comments.</p>
          ) : (
            <ul class="space-y-2 mb-3">
              {comments.map((c) => {
                const isHuman = c.author === 'human';
                return (
                  <li class="card p-3">
                    <div class="flex items-center gap-2 mb-1">
                      {isHuman ? (
                        <span
                          class="w-[18px] h-[18px] rounded-full flex items-center justify-center text-white"
                          style="background: var(--accent)"
                        >
                          <i data-lucide="user" class="icon-sm" style="width:10px;height:10px"></i>
                        </span>
                      ) : (
                        <Avatar agent={agentFor(agents, c.author)} size={18} />
                      )}
                      <span class="font-medium text-[13px]">{c.author}</span>
                      <span class="ml-auto text-[10px] text-faint mono">
                        {new Date(c.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div class="text-[13px] text-muted whitespace-pre-wrap">{c.body}</div>
                  </li>
                );
              })}
            </ul>
          )}
          <form
            class="flex flex-col gap-2"
            hx-post={`/api/tasks/${task.id}/comments?project=${project}`}
            hx-target="#drawer"
            hx-swap="innerHTML"
          >
            <textarea
              name="body"
              required
              rows={2}
              class="field"
              placeholder="Add a comment (use @name to notify)…"
            ></textarea>
            <div class="flex justify-end">
              <button type="submit" class="btn">
                <i data-lucide="send-horizontal"></i> Post comment
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
};

const VerdictBadge: FC<{ verdict: string }> = ({ verdict }) => {
  const ok = verdict === 'approved';
  const color = ok ? 'var(--success)' : 'var(--danger)';
  const bg = ok ? 'var(--success-soft)' : 'var(--danger-soft)';
  const label = ok ? 'Approved' : 'Changes requested';
  const icon = ok ? 'check' : 'x';
  return (
    <span
      class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full"
      style={`color:${color}; background:${bg}`}
    >
      <i data-lucide={icon} class="icon-sm"></i>
      {label}
    </span>
  );
};

export const TaskCreateForm: FC<{ project: string }> = ({ project }) => (
  <div class="drawer fixed right-0 top-0 h-full w-[480px] border-l border-soft overflow-y-auto z-30" style="background: var(--surface); box-shadow: -8px 0 32px rgba(31,30,26,0.06)">
    <div class="sticky top-0 border-b border-soft px-6 py-3 flex items-center justify-between" style="background: var(--surface)">
      <span class="text-[13px] font-semibold flex items-center gap-1.5">
        <i data-lucide="plus-circle"></i> New task
      </span>
      <button class="btn text-[12px] px-2 py-1" hx-get="/drawer/empty" hx-target="#drawer">
        <i data-lucide="x"></i>
      </button>
    </div>
    <form
      class="px-6 py-5 flex flex-col gap-4"
      hx-post={`/api/tasks?project=${project}`}
      hx-swap="innerHTML"
      hx-target="#drawer"
    >
      <label class="flex flex-col gap-1.5">
        <span class="text-[11px] uppercase tracking-wider text-faint">Title</span>
        <input
          name="title"
          required
          autofocus
          class="field text-[14px]"
          placeholder="What should be done?"
        />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="text-[11px] uppercase tracking-wider text-faint">Description</span>
        <textarea
          name="description"
          rows={5}
          class="field"
          placeholder="Optional context, acceptance criteria, or references."
        ></textarea>
      </label>
      <div class="grid grid-cols-2 gap-3">
        <label class="flex flex-col gap-1.5">
          <span class="text-[11px] uppercase tracking-wider text-faint">Priority</span>
          <select name="priority" class="field">
            <option value="1">P1 — urgent</option>
            <option value="2">P2 — high</option>
            <option value="3" selected>P3 — normal</option>
            <option value="4">P4 — low</option>
            <option value="5">P5 — backlog</option>
          </select>
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-[11px] uppercase tracking-wider text-faint">Package</span>
          <input name="package" class="field" placeholder="optional tag" />
        </label>
      </div>
      <label class="flex flex-col gap-1.5">
        <span class="text-[11px] uppercase tracking-wider text-faint">Status</span>
        <select name="status" class="field">
          <option value="todo" selected>To do — immediately claimable</option>
          <option value="backlog">Backlog — boss promotes later</option>
        </select>
      </label>
      <div class="flex gap-2 mt-1">
        <button type="submit" class="btn btn-primary flex-1 justify-center">
          <i data-lucide="plus"></i> Create task
        </button>
        <button type="button" class="btn" hx-get="/drawer/empty" hx-target="#drawer">
          Cancel
        </button>
      </div>
    </form>
  </div>
);

export const Inbox: FC<{
  messages: Array<{
    id: string;
    from_agent: string;
    to_agent: string;
    subject: string;
    body: string;
    created_at: number;
    read_at: number | null;
  }>;
  agents: AgentPresentation[];
}> = ({ messages, agents }) => (
  <ul class="space-y-3 max-w-3xl">
    {messages.length === 0 && (
      <li class="text-[13px] text-faint py-8 text-center">
        <i data-lucide="inbox" class="icon-lg" style="color:var(--ink-faint)"></i>
        <div class="mt-2">No messages yet.</div>
      </li>
    )}
    {messages.map((m) => {
      const isBroadcast = m.to_agent === '*';
      return (
        <li class="card p-4">
          <div class="flex items-center gap-2.5 mb-2">
            <Avatar agent={agentFor(agents, m.from_agent)} size={28} />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-[13px]">
                <span class="font-medium">{m.from_agent}</span>
                <i data-lucide="arrow-right" class="icon-sm" style="color:var(--ink-faint)"></i>
                {isBroadcast ? (
                  <span class="text-muted font-medium">everyone</span>
                ) : (
                  <span class="text-muted inline-flex items-center gap-1.5">
                    <Avatar agent={agentFor(agents, m.to_agent)} size={16} /> {m.to_agent}
                  </span>
                )}
              </div>
              {m.subject && <div class="text-[13px] font-medium mt-0.5">{m.subject}</div>}
            </div>
            <span class="text-[11px] text-faint mono">
              {new Date(m.created_at).toLocaleString()}
            </span>
          </div>
          <div class="text-[13px] text-muted whitespace-pre-wrap leading-relaxed">{m.body}</div>
        </li>
      );
    })}
  </ul>
);

export const ActivityFeed: FC<{
  items: Array<{ agent: string; action: string; created_at: number; details: string; task_id?: string | null }>;
  agents: AgentPresentation[];
}> = ({ items, agents }) => {
  const actionIcon = (a: string) => {
    if (a.startsWith('task.claimed')) return 'hand';
    if (a.startsWith('task.')) return 'layout-grid';
    if (a.startsWith('agent.heartbeat_started')) return 'play';
    if (a.startsWith('agent.heartbeat')) return 'square';
    if (a.startsWith('review')) return 'check';
    return 'dot';
  };
  return (
    <ul class="space-y-1 max-w-3xl">
      {items.length === 0 && (
        <li class="text-[13px] text-faint py-8 text-center">No activity yet.</li>
      )}
      {items.map((i) => {
        const isHuman = i.agent === 'human';
        return (
          <li class="flex items-center gap-3 px-3 py-2 rounded-lg hover-bg">
            <i data-lucide={actionIcon(i.action)} class="icon-sm" style="color:var(--ink-faint)"></i>
            {isHuman ? (
              <span
                class="w-6 h-6 rounded-full flex items-center justify-center text-white"
                style="background: var(--accent)"
              >
                <i data-lucide="user" class="icon-sm" style="width:12px;height:12px"></i>
              </span>
            ) : (
              <Avatar agent={agentFor(agents, i.agent)} size={24} />
            )}
            <div class="flex-1 min-w-0 text-[13px]">
              <span class="font-medium">{i.agent}</span>{' '}
              <span class="text-muted">{i.action}</span>
              {i.task_id && (
                <span class="ml-2 text-faint mono text-[11px]">{i.task_id.slice(0, 6)}</span>
              )}
            </div>
            <span class="text-[11px] text-faint mono shrink-0">
              {new Date(i.created_at).toLocaleString()}
            </span>
          </li>
        );
      })}
    </ul>
  );
};

export const AgentsList: FC<{
  agents: Array<{
    name: string;
    gender?: GenderHint;
    status: string;
    last_heartbeat: number | null;
    current_task_id: string | null;
    tokens_today: number;
    tokens_budget: number;
  }>;
}> = ({ agents }) => (
  <div class="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
    {agents.length === 0 && (
      <p class="text-[13px] text-faint py-8 col-span-full text-center">No agents defined yet.</p>
    )}
    {agents.map((a) => {
      const statusColor =
        a.status === 'working'
          ? 'var(--warn)'
          : a.status === 'blocked'
            ? 'var(--danger)'
            : a.status === 'archived'
              ? 'var(--ink-faint)'
              : a.status === 'paused_quota'
                ? 'var(--violet)'
                : 'var(--success)';
      const pct =
        a.tokens_budget > 0
          ? Math.min(100, Math.round((a.tokens_today / a.tokens_budget) * 100))
          : 0;
      return (
        <div class="card p-5">
          <div class="flex items-center gap-3">
            <Avatar agent={a} size={44} />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-[15px]">{a.name}</span>
                <span
                  class={`w-2 h-2 rounded-full ${a.status === 'working' ? 'pulse-dot' : ''}`}
                  style={`background:${statusColor}`}
                />
              </div>
              <div class="text-[11px] text-faint mt-0.5 capitalize">
                {a.status.replace(/_/g, ' ')}
                {a.last_heartbeat && (
                  <span class="ml-1.5 mono">
                    · {new Date(a.last_heartbeat).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          </div>
          {a.current_task_id && (
            <div class="mt-4 text-[12px] text-muted inline-flex items-center gap-1.5">
              <i data-lucide="loader" class="icon-sm"></i>
              Working on <span class="mono">{a.current_task_id.slice(0, 6)}</span>
            </div>
          )}
          {a.tokens_budget > 0 && (
            <div class="mt-4">
              <div class="flex justify-between text-[11px] text-faint mb-1">
                <span>Daily tokens</span>
                <span class="mono">{pct}%</span>
              </div>
              <div class="h-1 rounded-full" style="background: var(--surface-alt)">
                <div
                  class="h-full rounded-full transition-all"
                  style={`width:${pct}%; background: var(--accent)`}
                />
              </div>
            </div>
          )}
        </div>
      );
    })}
  </div>
);

export const SidebarAgents: FC<{
  agents: Array<{ name: string; gender?: GenderHint; status: string }>;
}> = ({ agents }) => (
  <ul class="flex flex-col gap-0.5">
    {agents.length === 0 && <li class="text-[12px] text-faint px-1 py-1">No agents</li>}
    {agents.map((a) => {
      const statusColor =
        a.status === 'working'
          ? 'var(--warn)'
          : a.status === 'blocked'
            ? 'var(--danger)'
            : a.status === 'archived'
              ? 'var(--ink-faint)'
              : 'var(--success)';
      return (
        <li class="flex items-center gap-2 px-2 py-1 text-[13px] hover-bg rounded-md">
          <Avatar agent={a} size={20} />
          <span class="flex-1 truncate">{a.name}</span>
          <span
            class={`w-1.5 h-1.5 rounded-full ${a.status === 'working' ? 'pulse-dot' : ''}`}
            style={`background:${statusColor}`}
          />
        </li>
      );
    })}
  </ul>
);
