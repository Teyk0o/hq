import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// States & enums as TS unions; enforced at domain layer.
export const TASK_STATES = [
  'backlog',
  'todo',
  'in_progress',
  'peer_review',
  'review',
  'approved',
  'done',
  'blocked',
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const AGENT_STATUSES = ['idle', 'working', 'blocked', 'archived', 'paused_quota'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const REVIEW_VERDICTS = ['approved', 'changes_requested'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const HEARTBEAT_OUTCOMES = ['ok', 'timeout', 'crash', 'budget'] as const;
export type HeartbeatOutcome = (typeof HEARTBEAT_OUTCOMES)[number];

const now = sql`(unixepoch('now','subsec') * 1000)`;

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    goalId: text('goal_id'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    assignee: text('assignee'),
    createdBy: text('created_by').notNull(),
    status: text('status').notNull().$type<TaskState>(),
    priority: integer('priority').notNull().default(3),
    package: text('package'),
    branch: text('branch'),
    pushed: integer('pushed', { mode: 'boolean' }).notNull().default(false),
    blockedReason: text('blocked_reason'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
    claimedAt: integer('claimed_at'),
    completedAt: integer('completed_at'),
  },
  (t) => ({
    statusIdx: index('tasks_status').on(t.status),
    assigneeIdx: index('tasks_assignee').on(t.assignee),
    goalIdx: index('tasks_goal').on(t.goalId),
  }),
);

export const taskDependencies = sqliteTable(
  'task_dependencies',
  {
    taskId: text('task_id').notNull(),
    dependsOn: text('depends_on').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.taskId, t.dependsOn] }) }),
);

export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  author: text('author').notNull(),
  body: text('body').notNull(),
  mentions: text('mentions').notNull().default('[]'),
  createdAt: integer('created_at').notNull().default(now),
});

export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  reviewer: text('reviewer').notNull(),
  verdict: text('verdict').notNull().$type<ReviewVerdict>(),
  body: text('body').notNull().default(''),
  createdAt: integer('created_at').notNull().default(now),
});

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  assignees: text('assignees').notNull().default('[]'),
  tasksPerWeek: integer('tasks_per_week').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

export const agentState = sqliteTable('agent_state', {
  name: text('name').primaryKey(),
  status: text('status').notNull().$type<AgentStatus>(),
  lastHeartbeat: integer('last_heartbeat'),
  currentTaskId: text('current_task_id'),
  tmuxSession: text('tmux_session'),
  pid: integer('pid'),
  tokensToday: integer('tokens_today').notNull().default(0),
  tokensBudget: integer('tokens_budget').notNull().default(0),
  budgetResetAt: integer('budget_reset_at').notNull(),
  blockedReason: text('blocked_reason'),
});

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    fromAgent: text('from_agent').notNull(),
    toAgent: text('to_agent').notNull(),
    subject: text('subject').notNull().default(''),
    body: text('body').notNull(),
    readAt: integer('read_at'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => ({ toIdx: index('messages_to').on(t.toAgent) }),
);

export const activity = sqliteTable(
  'activity',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    agent: text('agent').notNull(),
    action: text('action').notNull(),
    taskId: text('task_id'),
    details: text('details').notNull().default('{}'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => ({ createdIdx: index('activity_created').on(t.createdAt) }),
);

export const heartbeats = sqliteTable(
  'heartbeats',
  {
    id: text('id').primaryKey(),
    agent: text('agent').notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    outcome: text('outcome').$type<HeartbeatOutcome>(),
    logPath: text('log_path').notNull(),
    tokensUsed: integer('tokens_used').notNull().default(0),
    tasksWorked: text('tasks_worked').notNull().default('[]'),
    error: text('error'),
    retryCount: integer('retry_count').notNull().default(0),
  },
  (t) => ({ agentIdx: index('heartbeats_agent').on(t.agent, t.startedAt) }),
);
