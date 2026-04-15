/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { TaskState } from '@hq/core';
import type { UsageSnapshot } from '@hq/usage';

const COLUMNS: { state: TaskState; label: string; accent: string }[] = [
  { state: 'backlog', label: 'Backlog', accent: '#9B9A97' },
  { state: 'todo', label: 'To do', accent: '#6B7280' },
  { state: 'in_progress', label: 'In progress', accent: '#D9730D' },
  { state: 'peer_review', label: 'Peer review', accent: '#9065B0' },
  { state: 'review', label: 'Human review', accent: '#2383E2' },
  { state: 'approved', label: 'Approved', accent: '#0F7B6C' },
  { state: 'done', label: 'Done', accent: '#A0A0A0' },
];

export interface KanbanTask {
  id: string;
  title: string;
  status: TaskState;
  assignee: string | null;
  priority: number;
  package: string | null;
}

export const Kanban: FC<{ tasks: KanbanTask[]; project: string }> = ({ tasks, project }) => (
  <div
    class="grid gap-4 pb-4 overflow-x-auto swap-in"
    style="grid-template-columns: repeat(7, minmax(260px, 1fr))"
  >
    {COLUMNS.map((col) => {
      const colTasks = tasks.filter((t) => t.status === col.state);
      return (
        <section class="flex flex-col">
          <header class="flex items-center gap-2 px-1 mb-2">
            <span class="w-2 h-2 rounded-full" style={`background:${col.accent}`} />
            <h2 class="text-[13px] font-medium">{col.label}</h2>
            <span class="text-[12px] text-faint mono">{colTasks.length}</span>
          </header>
          <div class="flex flex-col gap-2">
            {colTasks.length === 0 && (
              <div class="text-[12px] text-faint py-4 px-1">No tasks</div>
            )}
            {colTasks.map((t) => (
              <TaskCard task={t} project={project} accent={col.accent} />
            ))}
          </div>
        </section>
      );
    })}
  </div>
);

const priorityPill = (p: number): { label: string; color: string; bg: string } => {
  if (p <= 1) return { label: 'P1', color: '#E03E3E', bg: '#FBEAE9' };
  if (p === 2) return { label: 'P2', color: '#D9730D', bg: '#FBEDD8' };
  if (p === 3) return { label: 'P3', color: '#787874', bg: '#F1F1EF' };
  if (p === 4) return { label: 'P4', color: '#787874', bg: '#F1F1EF' };
  return { label: 'P5', color: '#9B9A97', bg: '#F1F1EF' };
};

const agentInitial = (name: string | null): { initial: string; color: string } => {
  if (!name) return { initial: '?', color: '#D3D2CE' };
  const colors = ['#2383E2', '#9065B0', '#0F7B6C', '#D9730D', '#E03E3E'];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const color = colors[Math.abs(hash) % colors.length]!;
  return { initial: name[0]!.toUpperCase(), color };
};

export const TaskCard: FC<{ task: KanbanTask; project: string; accent: string }> = ({
  task,
  project,
  accent,
}) => {
  const prio = priorityPill(task.priority);
  const avatar = agentInitial(task.assignee);
  return (
    <div
      class="task-card group bg-white border border-soft rounded-lg p-3 cursor-pointer hover:shadow-sm transition-shadow"
      style={`border-left: 3px solid ${accent}`}
      hx-get={`/task/${task.id}?project=${project}`}
      hx-target="#drawer"
      hx-swap="innerHTML"
    >
      <div class="flex items-start justify-between gap-2">
        <span class="text-[13px] font-medium leading-snug">{task.title}</span>
        <span
          class="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded mono"
          style={`color:${prio.color}; background:${prio.bg}`}
        >
          {prio.label}
        </span>
      </div>
      <div class="mt-2 flex items-center gap-2">
        {task.assignee ? (
          <span
            class="inline-flex items-center gap-1.5 text-[11px] text-muted"
            title={task.assignee}
          >
            <span
              class="w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-semibold"
              style={`background:${avatar.color}`}
            >
              {avatar.initial}
            </span>
            {task.assignee}
          </span>
        ) : (
          <span class="text-[11px] text-faint italic">unassigned</span>
        )}
        {task.package && (
          <span class="text-[10px] text-muted px-1.5 py-0.5 rounded border border-soft">
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
  const color = pct >= 80 ? '#E03E3E' : pct >= 60 ? '#D9730D' : '#0F7B6C';
  const bg = pct >= 80 ? '#FBEAE9' : pct >= 60 ? '#FBEDD8' : '#DDEDEA';
  return (
    <span
      class="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md"
      style={`color:${color}; background:${bg}`}
    >
      <span class="font-medium">{label}</span>
      <span class="mono font-semibold">{pct}%</span>
    </span>
  );
};

export const TaskDrawer: FC<{
  task: KanbanTask & { description?: string; branch?: string | null };
  comments: Array<{ author: string; body: string; created_at: number }>;
  reviews: Array<{ reviewer: string; verdict: string; body: string; created_at: number }>;
}> = ({ task, comments, reviews }) => {
  const avatar = agentInitial(task.assignee);
  return (
    <div class="drawer fixed right-0 top-0 h-full w-[460px] bg-white border-l border-soft shadow-xl overflow-y-auto z-30">
      <div class="sticky top-0 bg-white border-b border-soft px-5 py-3 flex items-center justify-between">
        <span class="text-[11px] text-faint mono">{task.id}</span>
        <button
          class="w-6 h-6 rounded hover-bg flex items-center justify-center text-muted"
          hx-get="/drawer/empty"
          hx-target="#drawer"
          aria-label="close"
        >
          ✕
        </button>
      </div>
      <div class="px-5 py-4">
        <h2 class="text-[20px] font-semibold leading-tight">{task.title}</h2>
        <div class="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
          <StatusBadge status={task.status} />
          {task.assignee && (
            <span class="inline-flex items-center gap-1.5 text-muted">
              <span
                class="w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-semibold"
                style={`background:${avatar.color}`}
              >
                {avatar.initial}
              </span>
              {task.assignee}
            </span>
          )}
          {task.branch && <span class="text-muted mono text-[11px]">{task.branch}</span>}
        </div>

        {task.description && (
          <div class="mt-4 text-[13px] text-muted whitespace-pre-wrap">{task.description}</div>
        )}

        {task.status === 'review' && (
          <div class="mt-5 flex gap-2">
            <button
              class="flex-1 text-[13px] font-medium py-2 rounded-md text-white"
              style="background: var(--accent-green)"
              hx-post={`/api/tasks/${task.id}/approve`}
              hx-swap="none"
            >
              Approve
            </button>
            <button
              class="flex-1 text-[13px] font-medium py-2 rounded-md text-white"
              style="background: var(--accent-red)"
              hx-post={`/api/tasks/${task.id}/reject`}
              hx-swap="none"
            >
              Reject
            </button>
          </div>
        )}
        {task.status === 'approved' && (
          <button
            class="mt-5 w-full text-[13px] font-medium py-2 rounded-md text-white"
            style="background: var(--accent-blue)"
            hx-post={`/api/tasks/${task.id}/push`}
            hx-swap="none"
          >
            Push & mark done
          </button>
        )}

        <section class="mt-6">
          <h3 class="text-[11px] uppercase tracking-wider text-faint mb-2">
            Reviews <span class="mono">{reviews.length}</span>
          </h3>
          {reviews.length === 0 ? (
            <p class="text-[12px] text-faint italic">No reviews yet.</p>
          ) : (
            <ul class="space-y-2">
              {reviews.map((r) => (
                <li class="text-[13px] border border-soft rounded-md p-3">
                  <div class="flex items-center justify-between mb-1">
                    <span class="font-medium">{r.reviewer}</span>
                    <VerdictBadge verdict={r.verdict} />
                  </div>
                  {r.body && <div class="text-muted whitespace-pre-wrap">{r.body}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section class="mt-6">
          <h3 class="text-[11px] uppercase tracking-wider text-faint mb-2">
            Comments <span class="mono">{comments.length}</span>
          </h3>
          {comments.length === 0 ? (
            <p class="text-[12px] text-faint italic">No comments.</p>
          ) : (
            <ul class="space-y-2">
              {comments.map((c) => (
                <li class="text-[13px] border border-soft rounded-md p-3">
                  <div class="flex items-center justify-between mb-1">
                    <span class="font-medium">{c.author}</span>
                    <span class="text-faint text-[11px] mono">
                      {new Date(c.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div class="text-muted whitespace-pre-wrap">{c.body}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};

const StatusBadge: FC<{ status: TaskState }> = ({ status }) => {
  const col = COLUMNS.find((c) => c.state === status);
  const label = col?.label ?? status;
  const accent = col?.accent ?? '#9B9A97';
  return (
    <span
      class="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded"
      style={`color:${accent}; background:${accent}15`}
    >
      <span class="w-1.5 h-1.5 rounded-full" style={`background:${accent}`} />
      {label}
    </span>
  );
};

const VerdictBadge: FC<{ verdict: string }> = ({ verdict }) => {
  const ok = verdict === 'approved';
  const color = ok ? '#0F7B6C' : '#E03E3E';
  const label = ok ? 'Approved' : 'Changes requested';
  return (
    <span
      class="text-[11px] px-2 py-0.5 rounded"
      style={`color:${color}; background:${color}15`}
    >
      {label}
    </span>
  );
};

export const ActivityFeed: FC<{
  items: Array<{ agent: string; action: string; created_at: number; details: string; task_id?: string | null }>;
}> = ({ items }) => {
  const actionIcon = (a: string) => {
    if (a.startsWith('task.')) return '▦';
    if (a.startsWith('agent.heartbeat')) return '●';
    if (a.startsWith('review')) return '✓';
    return '•';
  };
  return (
    <ul class="space-y-1">
      {items.length === 0 && (
        <li class="text-[13px] text-faint py-4">No activity yet.</li>
      )}
      {items.map((i) => (
        <li class="flex items-start gap-3 py-2 border-b border-soft">
          <span class="w-4 text-center text-faint mt-0.5">{actionIcon(i.action)}</span>
          <div class="flex-1 min-w-0">
            <div class="text-[13px]">
              <span class="font-medium">{i.agent}</span>{' '}
              <span class="text-muted">{i.action}</span>
              {i.task_id && (
                <span class="ml-2 text-faint mono text-[11px]">{i.task_id.slice(0, 6)}</span>
              )}
            </div>
          </div>
          <span class="text-[11px] text-faint mono shrink-0">
            {new Date(i.created_at).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
};

export const AgentsList: FC<{
  agents: Array<{
    name: string;
    status: string;
    last_heartbeat: number | null;
    current_task_id: string | null;
    tokens_today: number;
    tokens_budget: number;
  }>;
}> = ({ agents }) => (
  <div class="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
    {agents.length === 0 && (
      <p class="text-[13px] text-faint py-4 col-span-full">No agents defined.</p>
    )}
    {agents.map((a) => {
      const avatar = agentInitial(a.name);
      const statusColor =
        a.status === 'working'
          ? '#D9730D'
          : a.status === 'blocked'
            ? '#E03E3E'
            : a.status === 'archived'
              ? '#9B9A97'
              : a.status === 'paused_quota'
                ? '#9065B0'
                : '#0F7B6C';
      const pct = a.tokens_budget > 0 ? Math.min(100, Math.round((a.tokens_today / a.tokens_budget) * 100)) : 0;
      return (
        <div class="bg-white border border-soft rounded-lg p-4">
          <div class="flex items-center gap-3">
            <div
              class="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-[14px]"
              style={`background:${avatar.color}`}
            >
              {avatar.initial}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-medium text-[14px]">{a.name}</span>
                <span
                  class={`w-2 h-2 rounded-full ${a.status === 'working' ? 'pulse-dot' : ''}`}
                  style={`background:${statusColor}`}
                />
              </div>
              <div class="text-[11px] text-faint mt-0.5">
                {a.status}
                {a.last_heartbeat && (
                  <span class="ml-2 mono">
                    {new Date(a.last_heartbeat).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          </div>
          {a.current_task_id && (
            <div class="mt-3 text-[12px] text-muted">
              Working on <span class="mono">{a.current_task_id.slice(0, 6)}</span>
            </div>
          )}
          {a.tokens_budget > 0 && (
            <div class="mt-3">
              <div class="flex justify-between text-[11px] text-faint mb-1">
                <span>Tokens today</span>
                <span class="mono">{pct}%</span>
              </div>
              <div class="h-1 rounded-full" style="background: var(--notion-hover)">
                <div class="h-full rounded-full" style={`width:${pct}%; background: var(--accent-blue)`} />
              </div>
            </div>
          )}
        </div>
      );
    })}
  </div>
);

export const SidebarAgents: FC<{
  agents: Array<{ name: string; status: string }>;
}> = ({ agents }) => (
  <ul class="flex flex-col gap-0.5">
    {agents.length === 0 && <li class="text-[12px] text-faint px-2 py-1">No agents</li>}
    {agents.map((a) => {
      const avatar = agentInitial(a.name);
      const statusColor =
        a.status === 'working'
          ? '#D9730D'
          : a.status === 'blocked'
            ? '#E03E3E'
            : a.status === 'archived'
              ? '#9B9A97'
              : '#0F7B6C';
      return (
        <li class="flex items-center gap-2 px-2 py-1 text-[13px] hover-bg rounded">
          <span
            class="w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-semibold"
            style={`background:${avatar.color}`}
          >
            {avatar.initial}
          </span>
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
