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
  reviewers?: string[];
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
  // Build the query string without the surrounding /board? path — the pills
  // do an HTMX GET against /board/inner?... and use hx-push-url to rewrite
  // the visible URL to /board?... so navigation stays lightweight (no
  // full-page reload, just a swap of the kanban grid).
  const params = (override: Partial<Filters>): string => {
    const merged = { ...filters, ...override };
    const p = new URLSearchParams();
    p.set('project', project);
    if (merged.assignee) p.set('assignee', merged.assignee);
    if (merged.priority) p.set('priority', String(merged.priority));
    if (merged.package) p.set('package', merged.package);
    if (merged.search) p.set('search', merged.search);
    return p.toString();
  };
  const hasFilter = !!(filters.assignee || filters.priority || filters.package || filters.search);
  const pill = (active: boolean, override: Partial<Filters>, label: string) => {
    const qs = params(override);
    return (
      <button
        type="button"
        class={`pill ${active ? 'pill-active' : ''}`}
        hx-get={`/board/inner?${qs}`}
        hx-target="#board-surface"
        hx-swap="innerHTML"
        hx-push-url={`/board?${qs}`}
      >
        {label}
      </button>
    );
  };
  return (
    <div class="flex flex-wrap items-center gap-2">
      {pill(!hasFilter, { assignee: undefined, priority: undefined, package: undefined, search: undefined }, 'All')}
      {assignees.length > 0 && <span class="text-faint text-[12px]">·</span>}
      {assignees.map((a) =>
        pill(filters.assignee === a, { assignee: filters.assignee === a ? undefined : a }, `@${a}`),
      )}
      <span class="text-faint text-[12px]">·</span>
      {[1, 2, 3, 4, 5].map((p) =>
        pill(filters.priority === p, { priority: filters.priority === p ? undefined : p }, `P${p}`),
      )}
      {packages.length > 0 && <span class="text-faint text-[12px]">·</span>}
      {packages.map((p) =>
        pill(filters.package === p, { package: filters.package === p ? undefined : p }, p),
      )}
    </div>
  );
};

export const BoardHeader: FC<{
  project: string;
  filters: Filters;
  assignees: string[];
  packages: string[];
}> = ({ project, filters, assignees, packages }) => {
  // Pre-build the current filter state for the search's hx-include so typing
  // keeps existing pill selections intact.
  const sharedParams = new URLSearchParams();
  sharedParams.set('project', project);
  if (filters.assignee) sharedParams.set('assignee', filters.assignee);
  if (filters.priority) sharedParams.set('priority', String(filters.priority));
  if (filters.package) sharedParams.set('package', filters.package);

  return (
    <div class="flex items-center justify-between gap-4 mb-6 flex-wrap">
      <FilterBar filters={filters} project={project} assignees={assignees} packages={packages} />
      <div class="flex items-center gap-2.5 shrink-0">
        <div class="relative" style="width: 260px">
          <i
            data-lucide="search"
            class="icon-sm"
            style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--ink-faint);pointer-events:none"
          ></i>
          <input
            type="search"
            name="search"
            value={filters.search ?? ''}
            placeholder="Search tasks…"
            class="field"
            style="padding-left: 36px"
            hx-get={`/board/inner?${sharedParams.toString()}`}
            hx-trigger="keyup changed delay:300ms, search"
            hx-target="#board-surface"
            hx-swap="innerHTML"
            hx-push-url="true"
            hx-include="this"
          />
        </div>
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
};

export const Kanban: FC<{ tasks: KanbanTask[]; project: string; agents: AgentPresentation[] }> = ({
  tasks,
  project,
  agents,
}) => (
  <div
    class="h-full grid gap-5 overflow-x-auto swap-in"
    style="grid-template-columns: repeat(7, minmax(280px, 1fr))"
  >
    {COLUMNS.map((col) => {
      const colTasks = tasks.filter((t) => t.status === col.state);
      return (
        <section class="flex flex-col min-h-0 h-full">
          <header class="flex items-center gap-2 px-1 mb-3 shrink-0">
            <span class="inline-flex items-center justify-center" style={`color:${col.accent}`}>
              <i data-lucide={col.icon}></i>
            </span>
            <h2 class="text-[14px] font-semibold">{col.label}</h2>
            <span class="text-[13px] text-faint mono ml-auto">{colTasks.length}</span>
          </header>
          <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1 pb-2">
            {colTasks.length === 0 && (
              <div class="text-[13px] text-faint py-4 px-1 text-center italic">Empty</div>
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
      class="card p-4 cursor-pointer transition-shadow"
      style={`border-top: 3px solid ${accent}`}
      hx-get={`/task/${task.id}?project=${project}`}
      hx-target="#drawer"
      hx-swap="innerHTML"
    >
      <div class="flex items-start justify-between gap-2">
        <span class="text-[14px] font-medium leading-snug">{task.title}</span>
        <span
          class="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full mono"
          style={`color:${prio.color}; background:${prio.bg}`}
        >
          {prio.label}
        </span>
      </div>
      <div class="mt-3 flex items-center gap-2 flex-wrap">
        {task.assignee ? (
          <span class="inline-flex items-center gap-1.5 text-[12px] text-muted">
            <Avatar agent={agentFor(agents, task.assignee)} size={20} />
            {task.assignee}
          </span>
        ) : (
          <span class="text-[12px] text-faint italic inline-flex items-center gap-1">
            <i data-lucide="user" class="icon-sm"></i>
            unassigned
          </span>
        )}
        {task.package && (
          <span class="text-[11px] text-muted px-2 py-0.5 rounded-full border border-soft">
            {task.package}
          </span>
        )}
        {task.reviewers && task.reviewers.length > 0 && (
          <ReviewerStack reviewers={task.reviewers} agents={agents} />
        )}
        <span class="ml-auto text-[11px] text-faint mono">{task.id.slice(0, 6)}</span>
      </div>
    </div>
  );
};

const ReviewerStack: FC<{ reviewers: string[]; agents: AgentPresentation[] }> = ({
  reviewers,
  agents,
}) => (
  <span
    class="inline-flex items-center gap-0.5 text-[11px] text-muted"
    title={`Reviewed by ${reviewers.join(', ')}`}
  >
    <i data-lucide="eye" class="icon-sm" style="color:var(--violet)"></i>
    <span class="flex -space-x-1.5 ml-0.5">
      {reviewers.slice(0, 3).map((r) => (
        <span
          class="inline-block rounded-full ring-2"
          style="--tw-ring-color: var(--surface); ring-width: 2px; box-shadow: 0 0 0 2px var(--surface)"
        >
          <Avatar agent={agentFor(agents, r)} size={18} />
        </span>
      ))}
      {reviewers.length > 3 && (
        <span
          class="inline-flex items-center justify-center rounded-full text-[9px] font-semibold bg-white border border-soft"
          style="width:18px;height:18px;color:var(--ink-muted);box-shadow: 0 0 0 2px var(--surface)"
        >
          +{reviewers.length - 3}
        </span>
      )}
    </span>
  </span>
);

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
      class="inline-flex items-center gap-1.5 text-[13px] px-3 py-1 rounded-full"
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
  task: KanbanTask & { description?: string; branch?: string | null; pr_url?: string | null };
  comments: Array<{ author: string; body: string; created_at: number }>;
  reviews: Array<{ reviewer: string; verdict: string; body: string; created_at: number }>;
  commits: GitCommit[];
  project: string;
  agents: AgentPresentation[];
}> = ({ task, comments, reviews, commits, project, agents }) => {
  const statusAccent = COLUMNS.find((c) => c.state === task.status)?.accent ?? 'var(--ink-faint)';
  return (
    <div class="drawer fixed right-0 top-0 h-full w-[520px] bg-white border-l border-soft overflow-y-auto z-30" style="background: var(--surface); box-shadow: -8px 0 32px rgba(31,30,26,0.06)">
      <div class="sticky top-0 border-b border-soft px-7 py-4 flex items-center justify-between z-10" style="background: var(--surface)">
        <span class="text-[12px] text-faint mono">{task.id}</span>
        <button
          class="btn btn-sm"
          hx-get="/drawer/empty"
          hx-target="#drawer"
          aria-label="close"
        >
          <i data-lucide="x"></i>
        </button>
      </div>
      <div class="px-7 py-6">
        <h2 class="text-[24px] font-semibold leading-tight">{task.title}</h2>
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <span
            class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[13px] font-medium"
            style={`color:${statusAccent}; background: color-mix(in srgb, ${statusAccent} 18%, transparent)`}
          >
            <span class="w-1.5 h-1.5 rounded-full" style={`background:${statusAccent}`} />
            {COLUMNS.find((c) => c.state === task.status)?.label ?? task.status}
          </span>
          {task.assignee && (
            <span class="inline-flex items-center gap-1.5 text-[13px] text-muted">
              <Avatar agent={agentFor(agents, task.assignee)} size={20} />
              {task.assignee}
            </span>
          )}
          {task.branch && (
            <span class="inline-flex items-center gap-1.5 text-[12px] text-muted mono">
              <i data-lucide="git-branch" class="icon-sm"></i>
              {task.branch}
            </span>
          )}
          {task.pr_url && (
            <a
              href={task.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 text-[12px]"
              style="color: var(--accent)"
            >
              <i data-lucide="git-pull-request" class="icon-sm"></i>
              Open PR
            </a>
          )}
        </div>

        {task.description && (
          <div class="mt-5 text-[14px] text-muted whitespace-pre-wrap leading-relaxed">{task.description}</div>
        )}

        {task.status === 'review' && (
          <div class="mt-6 flex gap-2">
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
            class="btn btn-primary mt-6 w-full justify-center"
            hx-post={`/api/tasks/${task.id}/push`}
            hx-swap="none"
          >
            <i data-lucide="upload"></i> Push & mark done
          </button>
        )}

        {commits.length > 0 && (
          <section class="mt-8">
            <h3 class="text-[12px] font-semibold uppercase tracking-wider text-faint mb-3 flex items-center gap-1.5">
              <i data-lucide="git-commit" class="icon-sm"></i> Commits · <span class="mono">{commits.length}</span>
            </h3>
            <ul class="space-y-2">
              {commits.map((c) => (
                <li class="card px-4 py-2.5">
                  <div class="flex items-center gap-2 text-[13px]">
                    <span class="mono text-faint">{c.hash.slice(0, 7)}</span>
                    <span class="flex-1 truncate">{c.subject}</span>
                    <span class="text-[11px] text-faint">{c.author}</span>
                  </div>
                  {c.stats && <div class="text-[12px] text-faint mono mt-1">{c.stats}</div>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section class="mt-8">
          <h3 class="text-[12px] font-semibold uppercase tracking-wider text-faint mb-3 flex items-center gap-1.5">
            <i data-lucide="message-square-check" class="icon-sm"></i> Reviews · <span class="mono">{reviews.length}</span>
          </h3>
          {reviews.length === 0 ? (
            <p class="text-[13px] text-faint italic">No reviews yet.</p>
          ) : (
            <ul class="space-y-2.5">
              {reviews.map((r) => (
                <li class="card p-4">
                  <div class="flex items-center gap-2 mb-2">
                    <Avatar agent={agentFor(agents, r.reviewer)} size={22} />
                    <span class="font-medium text-[14px]">{r.reviewer}</span>
                    <span class="ml-auto"><VerdictBadge verdict={r.verdict} /></span>
                  </div>
                  {r.body && <div class="text-[14px] text-muted whitespace-pre-wrap">{r.body}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section class="mt-8">
          <h3 class="text-[12px] font-semibold uppercase tracking-wider text-faint mb-3 flex items-center gap-1.5">
            <i data-lucide="message-circle" class="icon-sm"></i> Comments · <span class="mono">{comments.length}</span>
          </h3>
          {comments.length === 0 ? (
            <p class="text-[13px] text-faint italic mb-3">No comments.</p>
          ) : (
            <ul class="space-y-2.5 mb-3">
              {comments.map((c) => {
                const isHuman = c.author === 'human';
                return (
                  <li class="card p-4">
                    <div class="flex items-center gap-2 mb-2">
                      {isHuman ? (
                        <span
                          class="w-[22px] h-[22px] rounded-full flex items-center justify-center text-white"
                          style="background: var(--accent)"
                        >
                          <i data-lucide="user" class="icon-sm" style="width:12px;height:12px"></i>
                        </span>
                      ) : (
                        <Avatar agent={agentFor(agents, c.author)} size={22} />
                      )}
                      <span class="font-medium text-[14px]">{c.author}</span>
                      <span class="ml-auto text-[11px] text-faint mono">
                        {new Date(c.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div class="text-[14px] text-muted whitespace-pre-wrap">{c.body}</div>
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
              rows={3}
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
      class="inline-flex items-center gap-1 text-[12px] px-2.5 py-0.5 rounded-full font-medium"
      style={`color:${color}; background:${bg}`}
    >
      <i data-lucide={icon} class="icon-sm"></i>
      {label}
    </span>
  );
};

export const TaskCreateForm: FC<{ project: string }> = ({ project }) => (
  <div class="drawer fixed right-0 top-0 h-full w-[520px] border-l border-soft overflow-y-auto z-30" style="background: var(--surface); box-shadow: -8px 0 32px rgba(31,30,26,0.06)">
    <div class="sticky top-0 border-b border-soft px-7 py-4 flex items-center justify-between z-10" style="background: var(--surface)">
      <span class="text-[15px] font-semibold flex items-center gap-2">
        <i data-lucide="plus-circle"></i> New task
      </span>
      <button class="btn btn-sm" hx-get="/drawer/empty" hx-target="#drawer">
        <i data-lucide="x"></i>
      </button>
    </div>
    <form
      class="px-7 py-6 flex flex-col gap-5"
      hx-post={`/api/tasks?project=${project}`}
      hx-swap="innerHTML"
      hx-target="#drawer"
    >
      <label class="flex flex-col gap-2">
        <span class="text-[12px] font-semibold uppercase tracking-wider text-faint">Title</span>
        <input
          name="title"
          required
          autofocus
          class="field"
          placeholder="What should be done?"
          style="height:44px;font-size:15px"
        />
      </label>
      <label class="flex flex-col gap-2">
        <span class="text-[12px] font-semibold uppercase tracking-wider text-faint">Description</span>
        <textarea
          name="description"
          rows={5}
          class="field"
          placeholder="Optional context, acceptance criteria, or references."
        ></textarea>
      </label>
      <div class="grid grid-cols-2 gap-4">
        <label class="flex flex-col gap-2">
          <span class="text-[12px] font-semibold uppercase tracking-wider text-faint">Priority</span>
          <select name="priority" class="field">
            <option value="1">P1 — urgent</option>
            <option value="2">P2 — high</option>
            <option value="3" selected>P3 — normal</option>
            <option value="4">P4 — low</option>
            <option value="5">P5 — backlog</option>
          </select>
        </label>
        <label class="flex flex-col gap-2">
          <span class="text-[12px] font-semibold uppercase tracking-wider text-faint">Package</span>
          <input name="package" class="field" placeholder="optional tag" />
        </label>
      </div>
      <label class="flex flex-col gap-2">
        <span class="text-[12px] font-semibold uppercase tracking-wider text-faint">Status</span>
        <select name="status" class="field">
          <option value="todo" selected>To do — immediately claimable</option>
          <option value="backlog">Backlog — boss promotes later</option>
        </select>
      </label>
      <div class="flex gap-2 mt-2">
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
  project: string;
}> = ({ messages, agents, project }) => (
  <div class="max-w-4xl space-y-5">
    <ComposeMessage project={project} agents={agents} />
    <ul class="space-y-3">
    {messages.length === 0 && (
      <li class="text-[14px] text-faint py-10 text-center">
        <i data-lucide="inbox" class="icon-lg" style="color:var(--ink-faint)"></i>
        <div class="mt-3">No messages yet.</div>
      </li>
    )}
    {messages.map((m) => {
      const isBroadcast = m.to_agent === '*';
      return (
        <li class="card p-5">
          <div class="flex items-center gap-3 mb-3">
            <Avatar agent={agentFor(agents, m.from_agent)} size={32} />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-[14px]">
                <span class="font-semibold">{m.from_agent}</span>
                <i data-lucide="arrow-right" class="icon-sm" style="color:var(--ink-faint)"></i>
                {isBroadcast ? (
                  <span class="text-muted font-medium">everyone</span>
                ) : (
                  <span class="text-muted inline-flex items-center gap-1.5">
                    <Avatar agent={agentFor(agents, m.to_agent)} size={18} /> {m.to_agent}
                  </span>
                )}
              </div>
              {m.subject && <div class="text-[14px] font-medium mt-0.5">{m.subject}</div>}
            </div>
            <span class="text-[12px] text-faint mono">
              {new Date(m.created_at).toLocaleString()}
            </span>
          </div>
          <div class="text-[14px] text-muted whitespace-pre-wrap leading-relaxed">{m.body}</div>
        </li>
      );
    })}
    </ul>
  </div>
);

const ComposeMessage: FC<{ project: string; agents: AgentPresentation[] }> = ({
  project,
  agents,
}) => (
  <details class="card p-0 overflow-hidden">
    <summary
      class="px-5 py-4 flex items-center gap-2 cursor-pointer list-none hover-bg"
      style="user-select:none"
    >
      <i data-lucide="pencil-line"></i>
      <span class="font-semibold text-[14px]">Send a message to the team</span>
      <i data-lucide="chevron-down" class="icon-sm ml-auto" style="color:var(--ink-faint)"></i>
    </summary>
    <form
      class="px-5 pb-5 flex flex-col gap-3"
      hx-post={`/api/messages?project=${project}`}
      hx-swap="none"
    >
      <div class="grid grid-cols-2 gap-3">
        <label class="flex flex-col gap-1.5">
          <span class="text-[12px] font-semibold uppercase tracking-wider text-faint">To</span>
          <select name="to" class="field" required>
            <option value="*">Everyone (broadcast)</option>
            {agents.map((a) => (
              <option value={a.name}>@{a.name}</option>
            ))}
          </select>
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-[12px] font-semibold uppercase tracking-wider text-faint">Subject</span>
          <input name="subject" class="field" placeholder="optional" />
        </label>
      </div>
      <label class="flex flex-col gap-1.5">
        <span class="text-[12px] font-semibold uppercase tracking-wider text-faint">Message</span>
        <textarea name="body" rows={3} required class="field" placeholder="Write your message…" />
      </label>
      <div class="flex justify-end">
        <button type="submit" class="btn btn-primary">
          <i data-lucide="send-horizontal"></i> Send
        </button>
      </div>
    </form>
  </details>
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
    <ul class="space-y-1 max-w-4xl">
      {items.length === 0 && (
        <li class="text-[14px] text-faint py-10 text-center">No activity yet.</li>
      )}
      {items.map((i) => {
        const isHuman = i.agent === 'human';
        return (
          <li class="flex items-center gap-3 px-4 py-2.5 rounded-lg hover-bg">
            <i data-lucide={actionIcon(i.action)} style="color:var(--ink-faint)"></i>
            {isHuman ? (
              <span
                class="w-7 h-7 rounded-full flex items-center justify-center text-white"
                style="background: var(--accent)"
              >
                <i data-lucide="user" class="icon-sm" style="width:14px;height:14px"></i>
              </span>
            ) : (
              <Avatar agent={agentFor(agents, i.agent)} size={28} />
            )}
            <div class="flex-1 min-w-0 text-[14px]">
              <span class="font-medium">{i.agent}</span>{' '}
              <span class="text-muted">{i.action}</span>
              {i.task_id && (
                <span class="ml-2 text-faint mono text-[12px]">{i.task_id.slice(0, 6)}</span>
              )}
            </div>
            <span class="text-[12px] text-faint mono shrink-0">
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
        <div class="card p-6">
          <div class="flex items-center gap-4">
            <Avatar agent={a} size={52} />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-[16px]">{a.name}</span>
                <span
                  class={`w-2 h-2 rounded-full ${a.status === 'working' ? 'pulse-dot' : ''}`}
                  style={`background:${statusColor}`}
                />
              </div>
              <div class="text-[12px] text-faint mt-1 capitalize">
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
            <div class="mt-4 text-[13px] text-muted inline-flex items-center gap-1.5">
              <i data-lucide="loader" class="icon-sm"></i>
              Working on <span class="mono">{a.current_task_id.slice(0, 6)}</span>
            </div>
          )}
          {a.tokens_budget > 0 && (
            <div class="mt-4">
              <div class="flex justify-between text-[12px] text-faint mb-1.5">
                <span>Daily tokens</span>
                <span class="mono">{pct}%</span>
              </div>
              <div class="h-1.5 rounded-full" style="background: var(--surface-alt)">
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
    {agents.length === 0 && <li class="text-[13px] text-faint px-1 py-1">No agents</li>}
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
        <li class="flex items-center gap-2.5 px-2.5 py-1.5 text-[14px] hover-bg rounded-lg">
          <Avatar agent={a} size={24} />
          <span class="flex-1 truncate">{a.name}</span>
          <span
            class={`w-2 h-2 rounded-full ${a.status === 'working' ? 'pulse-dot' : ''}`}
            style={`background:${statusColor}`}
          />
        </li>
      );
    })}
  </ul>
);
