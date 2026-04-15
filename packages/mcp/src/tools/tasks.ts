import {
  activity as activityTable,
  canActorTransition,
  comments as commentsTable,
  newId,
  reviews as reviewsTable,
  tasks as tasksTable,
  type TaskState,
} from '@hq/core';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { requireCapability, type McpContext } from '../context';

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

export async function claimTask(ctx: McpContext, input: { id: string }) {
  requireCapability(ctx, 'can_claim_tasks');

  const task = ctx.db.select().from(tasksTable).where(eq(tasksTable.id, input.id)).get();
  if (!task) throw new Error(`Task not found: ${input.id}`);
  if (task.assignee && task.assignee !== ctx.agentName) {
    throw new Error(`Task already assigned to ${task.assignee}`);
  }

  const transition = canActorTransition(
    { kind: 'agent', name: ctx.agentName, capabilities: ctx.capabilities },
    task.status,
    'in_progress',
  );
  if (!transition.ok) throw new Error(transition.reason);

  const now = Date.now();
  ctx.db
    .update(tasksTable)
    .set({
      status: 'in_progress',
      assignee: ctx.agentName,
      claimedAt: now,
      updatedAt: now,
    })
    .where(eq(tasksTable.id, input.id))
    .run();

  ctx.db
    .insert(activityTable)
    .values({ agent: ctx.agentName, action: 'task.claimed', taskId: input.id })
    .run();

  ctx.tasksWorkedThisHeartbeat.add(input.id);
  ctx.bus.publish({ type: 'task.claimed', task_id: input.id, agent: ctx.agentName });
  ctx.bus.publish({
    type: 'task.status_changed',
    task_id: input.id,
    from: task.status,
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
  if (!task) throw new Error(`Task not found: ${input.id}`);
  if (task.assignee !== ctx.agentName) {
    throw new Error(`Only the assignee (${task.assignee}) can submit this task`);
  }
  const transition = canActorTransition(
    { kind: 'agent', name: ctx.agentName, capabilities: ctx.capabilities },
    task.status,
    'peer_review',
  );
  if (!transition.ok) throw new Error(transition.reason);

  ctx.db
    .update(tasksTable)
    .set({ status: 'peer_review', updatedAt: Date.now() })
    .where(eq(tasksTable.id, input.id))
    .run();

  if (input.summary) {
    ctx.db
      .insert(commentsTable)
      .values({ id: newId(), taskId: input.id, author: ctx.agentName, body: input.summary })
      .run();
  }

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

