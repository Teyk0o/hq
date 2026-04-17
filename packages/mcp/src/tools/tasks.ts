import {
  activity as activityTable,
  canActorTransition,
  comments as commentsTable,
  newId,
  reviews as reviewsTable,
  taskDependencies as taskDependenciesTable,
  tasks as tasksTable,
  type TaskState,
} from '@hq/core';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { join } from 'node:path';
import { branchExists, commitsAhead, currentBranch } from '../git';
import { McpError, requireCapability, type McpContext } from '../context';

export interface ListTasksInput {
  status?: TaskState;
  assignee?: string | null;
  goal_id?: string;
  limit?: number;
}

export async function listTasks(ctx: McpContext, input: ListTasksInput = {}) {
  const conditions = [];
  if (input.status) conditions.push(eq(tasksTable.status, input.status));
  if (input.goal_id) conditions.push(eq(tasksTable.goalId, input.goal_id));
  if (input.assignee === null) {
    conditions.push(isNull(tasksTable.assignee));
  } else if (input.assignee) {
    conditions.push(eq(tasksTable.assignee, input.assignee));
  }

  const rows = ctx.db
    .select()
    .from(tasksTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(tasksTable.priority, desc(tasksTable.createdAt))
    .limit(input.limit ?? 100)
    .all();

  return { tasks: rows };
}

export async function getTask(ctx: McpContext, input: { id: string }) {
  const task = ctx.db.select().from(tasksTable).where(eq(tasksTable.id, input.id)).get();
  if (!task) throw new Error(`Task not found: ${input.id}`);

  const comments = ctx.db
    .select()
    .from(commentsTable)
    .where(eq(commentsTable.taskId, input.id))
    .orderBy(commentsTable.createdAt)
    .all();

  const reviews = ctx.db
    .select()
    .from(reviewsTable)
    .where(eq(reviewsTable.taskId, input.id))
    .orderBy(reviewsTable.createdAt)
    .all();

  return { task, comments, reviews };
}

/**
 * Claim a task for the calling agent. This is the hot path for concurrency:
 * several agents can call simultaneously and we MUST guarantee at most one
 * wins. We use SQLite's atomic conditional UPDATE — WHERE clause enforces the
 * precondition (status='todo' and assignee null-or-self) and we inspect
 * `changes` on the result to detect lost races. Wrapping in a transaction
 * isolates the check-then-act from the activity insert.
 */
export async function claimTask(ctx: McpContext, input: { id: string }) {
  requireCapability(ctx, 'can_claim_tasks');

  const preTask = ctx.db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, input.id))
    .get();
  if (!preTask) {
    throw new McpError('task_not_found', `Task not found: ${input.id}`);
  }

  const transition = canActorTransition(
    { kind: 'agent', name: ctx.agentName, capabilities: ctx.capabilities },
    preTask.status,
    'in_progress',
  );
  if (!transition.ok) {
    throw new McpError('invalid_transition', transition.reason);
  }

  // Package scope: if the agent's scope.packages is set (and not "*"), only
  // allow claiming tasks whose package is in that list. Tasks without a
  // package are open to any agent.
  if (
    preTask.package &&
    ctx.scopePackages.length > 0 &&
    !ctx.scopePackages.includes('*') &&
    !scopeMatches(preTask.package, ctx.scopePackages)
  ) {
    throw new McpError(
      'out_of_scope',
      `Task package "${preTask.package}" is not in ${ctx.agentName}'s scope (${ctx.scopePackages.join(', ')})`,
      { task_package: preTask.package, agent_scope: ctx.scopePackages },
    );
  }

  // Task dependencies: every dep must be done before this task is claimable.
  const unmet = ctx.db
    .select()
    .from(taskDependenciesTable)
    .leftJoin(tasksTable, eq(taskDependenciesTable.dependsOn, tasksTable.id))
    .where(eq(taskDependenciesTable.taskId, input.id))
    .all()
    .filter((row) => (row.tasks?.status ?? 'backlog') !== 'done');
  if (unmet.length > 0) {
    throw new McpError(
      'deps_not_met',
      `Task has ${unmet.length} unmet dependency(ies)`,
      { unmet: unmet.map((u) => u.task_dependencies.dependsOn) },
    );
  }

  const now = Date.now();
  // Stamp the expected branch name on the task at claim time. submitForReview
  // will verify the actual git state matches this. branch_prefix is already
  // normalised (defaults to "agent/").
  const expectedBranch = `${ctx.projectConfig.git.branch_prefix}${ctx.agentName}-task-${input.id}`;
  const claimed = ctx.db.transaction((tx) => {
    tx.update(tasksTable)
      .set({
        status: 'in_progress',
        assignee: ctx.agentName,
        branch: expectedBranch,
        claimedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(tasksTable.id, input.id),
          eq(tasksTable.status, 'todo'),
          or(isNull(tasksTable.assignee), eq(tasksTable.assignee, ctx.agentName)),
        ),
      )
      .run();

    // Drizzle's bun-sqlite layer doesn't expose `changes` on .run() uniformly,
    // so we re-read and assert the world looks right. Under the transaction
    // isolation we're guaranteed a consistent view.
    const after = tx.select().from(tasksTable).where(eq(tasksTable.id, input.id)).get();
    if (!after || after.status !== 'in_progress' || after.assignee !== ctx.agentName) {
      return null;
    }

    tx.insert(activityTable)
      .values({ agent: ctx.agentName, action: 'task.claimed', taskId: input.id })
      .run();

    return true;
  });

  if (!claimed) {
    const current = ctx.db.select().from(tasksTable).where(eq(tasksTable.id, input.id)).get();
    throw new McpError(
      'claim_race_lost',
      `Could not claim ${input.id}: now status=${current?.status ?? '?'} assignee=${current?.assignee ?? 'null'}`,
    );
  }

  ctx.tasksWorkedThisHeartbeat.add(input.id);
  ctx.bus.publish({ type: 'task.claimed', task_id: input.id, agent: ctx.agentName });
  ctx.bus.publish({
    type: 'task.status_changed',
    task_id: input.id,
    from: preTask.status,
    to: 'in_progress',
    by: ctx.agentName,
  });
  return { ok: true };
}

export async function submitForReview(
  ctx: McpContext,
  input: { id: string; summary?: string },
) {
  const task = ctx.db.select().from(tasksTable).where(eq(tasksTable.id, input.id)).get();
  if (!task) throw new McpError('task_not_found', `Task not found: ${input.id}`);
  if (task.assignee !== ctx.agentName) {
    throw new McpError(
      'not_assignee',
      `Only the assignee (${task.assignee}) can submit this task`,
    );
  }
  const transition = canActorTransition(
    { kind: 'agent', name: ctx.agentName, capabilities: ctx.capabilities },
    task.status,
    'peer_review',
  );
  if (!transition.ok) throw new McpError('invalid_transition', transition.reason);

  // Enforce the branch↔task contract before letting the task move forward.
  // The expected branch was stamped at claim time; verify git state matches.
  const worktree = join(
    ctx.projectPath,
    ctx.projectConfig.git.worktree_dir,
    ctx.agentName,
  );
  const expectedBranch =
    task.branch ??
    `${ctx.projectConfig.git.branch_prefix}${ctx.agentName}/task-${input.id}`;
  const active = currentBranch(worktree);
  if (active !== expectedBranch) {
    throw new McpError(
      'branch_mismatch',
      `Expected to be on branch "${expectedBranch}" but the worktree is on "${active ?? '(detached)'}"`,
      { expected: expectedBranch, actual: active },
    );
  }
  if (!branchExists(worktree, expectedBranch)) {
    throw new McpError(
      'branch_missing',
      `Branch "${expectedBranch}" does not exist in the worktree`,
    );
  }
  const defaultBranch = ctx.projectConfig.project.default_branch;
  const ahead = commitsAhead(worktree, expectedBranch, defaultBranch);
  if (ahead < 1) {
    throw new McpError(
      'no_commits',
      `Branch "${expectedBranch}" has no commits ahead of "${defaultBranch}". Commit your changes before submitting.`,
      { branch: expectedBranch, base: defaultBranch },
    );
  }

  ctx.db.transaction((tx) => {
    tx.update(tasksTable)
      .set({ status: 'peer_review', branch: expectedBranch, updatedAt: Date.now() })
      .where(eq(tasksTable.id, input.id))
      .run();
    if (input.summary) {
      tx.insert(commentsTable)
        .values({ id: newId(), taskId: input.id, author: ctx.agentName, body: input.summary })
        .run();
    }
  });

  ctx.bus.publish({
    type: 'task.status_changed',
    task_id: input.id,
    from: task.status,
    to: 'peer_review',
    by: ctx.agentName,
  });
  return { ok: true };
}

export async function reportBlocked(ctx: McpContext, input: { id: string; reason: string }) {
  const task = ctx.db.select().from(tasksTable).where(eq(tasksTable.id, input.id)).get();
  if (!task) throw new Error(`Task not found: ${input.id}`);
  const transition = canActorTransition(
    { kind: 'agent', name: ctx.agentName, capabilities: ctx.capabilities },
    task.status,
    'blocked',
  );
  if (!transition.ok) throw new Error(transition.reason);

  ctx.db
    .update(tasksTable)
    .set({ status: 'blocked', blockedReason: input.reason, updatedAt: Date.now() })
    .where(eq(tasksTable.id, input.id))
    .run();

  ctx.bus.publish({ type: 'task.blocked', task_id: input.id, reason: input.reason });
  ctx.bus.publish({
    type: 'task.status_changed',
    task_id: input.id,
    from: task.status,
    to: 'blocked',
    by: ctx.agentName,
  });
  return { ok: true };
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  goal_id?: string;
  assignee?: string;
  priority?: number;
  package?: string;
}

export async function createTask(ctx: McpContext, input: CreateTaskInput) {
  requireCapability(ctx, 'can_create_tasks');
  const id = newId();
  ctx.db
    .insert(tasksTable)
    .values({
      id,
      title: input.title,
      description: input.description ?? '',
      goalId: input.goal_id ?? null,
      assignee: input.assignee ?? null,
      createdBy: ctx.agentName,
      status: 'backlog',
      priority: input.priority ?? 3,
      package: input.package ?? null,
    })
    .run();

  ctx.bus.publish({ type: 'task.created', task_id: id, by: ctx.agentName });
  return { id };
}

export async function promoteTask(ctx: McpContext, input: { id: string }) {
  requireCapability(ctx, 'can_promote_tasks');
  const task = ctx.db.select().from(tasksTable).where(eq(tasksTable.id, input.id)).get();
  if (!task) throw new Error(`Task not found: ${input.id}`);
  const transition = canActorTransition(
    { kind: 'agent', name: ctx.agentName, capabilities: ctx.capabilities },
    task.status,
    'todo',
  );
  if (!transition.ok) throw new Error(transition.reason);

  ctx.db
    .update(tasksTable)
    .set({ status: 'todo', updatedAt: Date.now() })
    .where(eq(tasksTable.id, input.id))
    .run();

  ctx.bus.publish({
    type: 'task.status_changed',
    task_id: input.id,
    from: task.status,
    to: 'todo',
    by: ctx.agentName,
  });
  return { ok: true };
}

/**
 * Check whether a task's package label falls within an agent's scope list.
 * Exact match is tried first; then we strip common file extensions (.rs, .ts,
 * .py, .js, .go, etc.) and retry, so a task tagged "planet.rs" matches a
 * scope entry "planet". Multi-file labels like "coarse.rs + chunk.rs" are
 * split on whitespace/commas and each token is checked.
 */
function scopeMatches(taskPackage: string, scopePackages: string[]): boolean {
  if (scopePackages.includes(taskPackage)) return true;
  const pkg = taskPackage.toLowerCase();
  const scopes = scopePackages.map((s) => s.toLowerCase());
  // Raw substring: "src/systems/streamer/config.rs" contains "streamer" → match.
  if (scopes.some((s) => pkg.includes(s))) return true;
  // Token-level: split on separators, then check every path component after
  // stripping file extension so "streamer_config.rs" → ["streamer_config"] → match "streamer".
  const stripExt = (t: string) => t.replace(/\.[a-z]{1,4}$/, '');
  const tokens = taskPackage
    .split(/[\s,+/]+/)
    .flatMap((t) => [t, stripExt(t)])
    .map((t) => t.toLowerCase())
    .filter(Boolean);
  return tokens.some((t) => scopes.some((s) => s === t || t.includes(s) || s.includes(t)));
}

