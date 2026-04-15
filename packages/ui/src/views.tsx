/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { TaskState } from '@hq/core';
import type { UsageSnapshot } from '@hq/usage';

const COLUMNS: TaskState[] = [
  'backlog',
  'todo',
  'in_progress',
  'peer_review',
  'review',
  'approved',
  'done',
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
  <div class="p-4 grid gap-3 overflow-x-auto" style="grid-template-columns:repeat(7,minmax(220px,1fr))">
    {COLUMNS.map((state) => (
      <section class="bg-zinc-900/60 rounded-lg p-2 min-h-[60vh]">
        <header class="flex items-center justify-between px-1 py-1 text-xs uppercase tracking-wider text-zinc-500">
          <span>{state.replace('_', ' ')}</span>
          <span class="text-zinc-600">{tasks.filter((t) => t.status === state).length}</span>
        </header>
        <div id={`col-${state}`} class="flex flex-col gap-2 mt-2">
          {tasks
            .filter((t) => t.status === state)
            .map((t) => (
              <TaskCard task={t} project={project} />
            ))}
        </div>
      </section>
    ))}
  </div>
);

export const TaskCard: FC<{ task: KanbanTask; project: string }> = ({ task, project }) => (
  <div
    id={`task-${task.id}`}
    class="task-card bg-zinc-800 hover:bg-zinc-700 rounded p-2 text-sm cursor-pointer"
    style={`--tn:t-${task.id}`}
    hx-get={`/task/${task.id}?project=${project}`}
    hx-target="#drawer"
    hx-swap="innerHTML"
    sse-swap={`task-${task.id}-updated`}
  >
    <div class="font-medium">{task.title}</div>
    <div class="mt-1 flex items-center gap-2 text-xs text-zinc-400">
      <span>p{task.priority}</span>
      {task.assignee && <span class="text-emerald-400">@{task.assignee}</span>}
      {task.package && <span class="text-indigo-400">{task.package}</span>}
    </div>
  </div>
);

export const UsageWidget: FC<{ snap: UsageSnapshot | null }> = ({ snap }) => {
  if (!snap) return <span class="text-zinc-500">usage: loading…</span>;
  const pill = (label: string, pct: number) => (
    <span class={pillClass(pct)}>
      {label} {pct}%
    </span>
  );
  return (
    <>
      {pill('Session', snap.session_pct)}
      {pill('Week', snap.week_all_pct)}
      {pill('Sonnet', snap.week_sonnet_pct)}
    </>
  );
};

function pillClass(pct: number): string {
  const base = 'px-2 py-0.5 rounded font-medium ';
  if (pct >= 80) return `${base} bg-red-600/40 text-red-200`;
  if (pct >= 60) return `${base} bg-amber-600/40 text-amber-200`;
  return `${base} bg-emerald-600/30 text-emerald-200`;
}

export const TaskDrawer: FC<{ task: KanbanTask; comments: unknown[]; reviews: unknown[] }> = ({
  task,
  comments,
  reviews,
}) => (
  <aside class="fixed right-0 top-0 h-full w-[420px] bg-zinc-900 border-l border-zinc-800 p-4 overflow-y-auto shadow-2xl">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-bold">{task.title}</h2>
      <button
        class="text-zinc-500 hover:text-white"
        hx-get="/drawer/empty"
        hx-target="#drawer"
      >
        ✕
      </button>
    </div>
    <div class="text-xs text-zinc-400 mt-1">
      {task.status} · p{task.priority} · {task.assignee ?? 'unassigned'}
    </div>
    {task.status === 'review' && (
      <div class="mt-3 flex gap-2">
        <button
          class="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm"
          hx-post={`/api/tasks/${task.id}/approve`}
          hx-swap="none"
        >
          Approve
        </button>
        <button
          class="px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-sm"
          hx-post={`/api/tasks/${task.id}/reject`}
          hx-swap="none"
        >
          Reject
        </button>
      </div>
    )}
    {task.status === 'approved' && (
      <button
        class="mt-3 px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
        hx-post={`/api/tasks/${task.id}/push`}
        hx-swap="none"
      >
        Push & mark done
      </button>
    )}
    <section class="mt-6">
      <h3 class="text-xs uppercase tracking-wider text-zinc-500 mb-2">Comments</h3>
      {comments.length === 0 ? (
        <p class="text-zinc-600 text-xs">No comments yet.</p>
      ) : (
        <ul class="space-y-2 text-sm">
          {comments.map((c: any) => (
            <li class="bg-zinc-800 rounded p-2">
              <div class="text-xs text-zinc-400">{c.author}</div>
              <div class="whitespace-pre-wrap">{c.body}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
    <section class="mt-6">
      <h3 class="text-xs uppercase tracking-wider text-zinc-500 mb-2">Reviews</h3>
      {reviews.length === 0 ? (
        <p class="text-zinc-600 text-xs">No reviews.</p>
      ) : (
        <ul class="space-y-2 text-sm">
          {reviews.map((r: any) => (
            <li class="bg-zinc-800 rounded p-2">
              <div class="text-xs text-zinc-400">
                {r.reviewer} · {r.verdict}
              </div>
              <div class="whitespace-pre-wrap">{r.body}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  </aside>
);

export const ActivityFeed: FC<{ items: Array<{ agent: string; action: string; created_at: number; details: string }> }> = ({ items }) => (
  <ul class="divide-y divide-zinc-800">
    {items.map((i) => (
      <li class="p-2 text-sm flex items-center gap-3">
        <span class="text-xs text-zinc-500 w-36">
          {new Date(i.created_at).toLocaleString()}
        </span>
        <span class="text-emerald-400 w-24">{i.agent}</span>
        <span class="text-zinc-300">{i.action}</span>
      </li>
    ))}
  </ul>
);

export const AgentsList: FC<{
  agents: Array<{ name: string; status: string; last_heartbeat: number | null }>;
}> = ({ agents }) => (
  <ul class="divide-y divide-zinc-800">
    {agents.map((a) => (
      <li class="p-3 flex items-center gap-4">
        <span
          class={
            'w-2 h-2 rounded-full ' +
            (a.status === 'working'
              ? 'bg-amber-400 animate-pulse'
              : a.status === 'blocked'
                ? 'bg-red-500'
                : a.status === 'archived'
                  ? 'bg-zinc-600'
                  : 'bg-emerald-500')
          }
        />
        <span class="font-medium">{a.name}</span>
        <span class="text-xs text-zinc-500">{a.status}</span>
        <span class="ml-auto text-xs text-zinc-500">
          {a.last_heartbeat ? new Date(a.last_heartbeat).toLocaleString() : 'never'}
        </span>
      </li>
    ))}
  </ul>
);
