import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AgentCapabilities,
  AgentConfig,
  AgentRole,
  HQDatabase,
  ProjectConfig,
} from '@hq/core';
import { agentState, goals as goalsTable, tasks as tasksTable } from '@hq/core';
import { and, desc, eq, gte } from 'drizzle-orm';

export interface HeartbeatPromptContext {
  agentName: string;
  agentRole: AgentRole;
  capabilities: AgentCapabilities;
  projectName: string;
  projectPath: string;
  projectConfig: ProjectConfig;
  agentConfig: AgentConfig;
  db: HQDatabase;
  maxTokens: number;
  timeoutMinutes: number;
}

/** Per-agent cache of the SOUL mtime last seen; lets the runner emit a clear
 *  log line when the operator edits the SOUL between heartbeats. */
const soulMtimeCache = new Map<string, number>();

/** Build the heartbeat prompt to inject into the agent's tmux session. */
export async function buildHeartbeatPrompt(ctx: HeartbeatPromptContext): Promise<string> {
  const soulPath = join(ctx.projectPath, '.hq', 'agents', ctx.agentConfig.agent.soul);
  const soul = await tryRead(soulPath, '(no SOUL.md found)');

  // Hot-reload detection: log when the SOUL file changed since the previous
  // heartbeat so the operator can see their edit landed.
  try {
    const st = await stat(soulPath);
    const key = `${ctx.projectPath}:${ctx.agentName}`;
    const previous = soulMtimeCache.get(key);
    const current = st.mtimeMs;
    if (previous !== undefined && current !== previous) {
      console.log(
        `[soul] ${ctx.agentName}: SOUL updated (${new Date(current).toISOString()}), reloaded for this heartbeat`,
      );
    }
    soulMtimeCache.set(key, current);
  } catch {
    // no file, no cache
  }

  const progressPath = join(ctx.projectPath, '.hq', 'progress', `${ctx.agentName}.md`);
  const progress = await tryRead(progressPath, '(no prior progress)');

  const teammates = ctx.db.select().from(agentState).all();
  const teammateLines = teammates
    .filter((t) => t.name !== ctx.agentName)
    .map(
      (t) =>
        `  - ${t.name} (status=${t.status}${t.currentTaskId ? `, on=${t.currentTaskId}` : ''})`,
    )
    .join('\n');

  const goalsSection = ctx.capabilities.can_create_tasks
    ? buildGoalsSection(ctx)
    : '';

  const protocolSteps = buildProtocolSteps(ctx);

  return [
    `=== HQ HEARTBEAT ===`,
    ``,
    `You are ${ctx.agentName}, a ${ctx.agentRole} on project ${ctx.projectName}.`,
    ``,
    `Your SOUL:`,
    soul,
    ``,
    `Your teammates:`,
    teammateLines || '  (none)',
    ``,
    `Your PROGRESS since last heartbeat:`,
    progress,
    ``,
    ...(goalsSection ? [goalsSection, ''] : []),
    `Execute your heartbeat protocol IN THIS ORDER:`,
    ...protocolSteps,
    ``,
    `Constraints:`,
    `  - Token budget this heartbeat: ${ctx.maxTokens}`,
    `  - Timeout: ${ctx.timeoutMinutes} min`,
    `  - You CANNOT modify files outside your worktree.`,
    `  - You CANNOT push branches; commit only.`,
    `  - On unrecoverable problem: report_blocked and stop.`,
  ].join('\n');
}

function buildProtocolSteps(ctx: HeartbeatPromptContext): string[] {
  const steps: string[] = [`  1. Call mcp__hq__start_heartbeat.`];
  let n = 2;
  if (ctx.capabilities.can_review) {
    steps.push(
      `  ${n++}. REVIEW PHASE: list_tasks(status="peer_review"), review eligible ones via submit_review`,
      `       (verdict="approved" or "changes_requested"). changes_requested resets the task to todo`,
      `       so any worker can address the feedback. Alternatively, use request_rework for finer`,
      `       control when you want to keep the task but redirect its scope.`,
    );
  }
  if (ctx.capabilities.can_claim_tasks) {
    steps.push(
      `  ${n++}. UNBLOCK PHASE: recheck blocked tasks if you have any.`,
      `  ${n++}. WORK PHASE: claim_task on a suitable todo, do the work, commit to branch`,
      `       agent/${ctx.agentName}-task-<id>, then submit_for_review.`,
    );
  }
  if (ctx.capabilities.can_create_tasks) {
    steps.push(
      `  ${n++}. TRIAGE PHASE: call list_tasks(status="backlog"). For every task`,
      `       already in backlog (including ones created by the operator), call`,
      `       promote_task to move it to todo so workers can claim it.`,
      `  ${n++}. REWORK PHASE: scan list_tasks for tasks that need changes rather`,
      `       than a new parallel task. If existing work needs iteration, call`,
      `       request_rework(id, reason) — it adds your comment and resets the task`,
      `       to todo so a worker can address the feedback. Do NOT create a new task`,
      `       for the same intent.`,
      `  ${n++}. PLAN PHASE: for each active goal below, check how many tasks were`,
      `       created this week vs its target. If under target AND no existing open`,
      `       task already covers the same intent, call create_task then promote_task.`,
      `       IMPORTANT: ALL statuses below mean the work is NOT done yet — do NOT`,
      `       create a duplicate for ANY of these:`,
      `         [todo]        — waiting to be claimed`,
      `         [in_progress] — agent is working on it`,
      `         [peer_review] — submitted, agents reviewing`,
      `         [review]      — PEER-APPROVED, waiting for human sign-off (YOU). Do NOT recreate.`,
      `         [approved]    — human approved, pending merge`,
      `         [blocked]     — blocked, will be retried`,
      `       Only [done] means the work is truly finished.`,
    );
  }
  steps.push(`  ${n++}. update_progress with a short summary.`);
  steps.push(`  ${n}. end_heartbeat. THIS MUST BE YOUR LAST TOOL CALL.`);
  return steps;
}

function buildGoalsSection(ctx: HeartbeatPromptContext): string {
  const activeGoals = ctx.db
    .select()
    .from(goalsTable)
    .where(eq(goalsTable.active, true))
    .all();
  if (activeGoals.length === 0) return '';

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const blocks: string[] = ['Active goals (you can create tasks for these):'];
  for (const g of activeGoals) {
    let assignees: string[] = [];
    try {
      assignees = JSON.parse(g.assignees) as string[];
    } catch {
      /* ignore */
    }
    // Only propose goals where this agent is an assignee (or no assignee set).
    if (assignees.length > 0 && !assignees.includes(ctx.agentName)) continue;

    const allGoalTasks = ctx.db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.goalId, g.id))
      .orderBy(desc(tasksTable.createdAt))
      .all();

    const recentCount = allGoalTasks.filter((t) => t.createdAt >= weekAgo).length;
    const openTasks = allGoalTasks.filter((t) => t.status !== 'done');

    blocks.push(
      `  • ${g.id} — ${g.title}`,
      `      target: ${g.tasksPerWeek} tasks/week, created this week: ${recentCount}`,
    );
    if (g.description) blocks.push(`      ${g.description.trim()}`);
    if (openTasks.length > 0) {
      blocks.push('      open tasks — DO NOT RECREATE ANY OF THESE:');
      for (const t of openTasks) {
        const label =
          t.status === 'review'
            ? 'review — PEER-APPROVED, awaiting human'
            : t.status === 'approved'
              ? 'approved — awaiting merge'
              : t.status;
        blocks.push(`        - [${label}] ${t.id}: ${t.title}`);
      }
    }
  }
  return blocks.length > 1 ? blocks.join('\n') : '';
}

async function tryRead(path: string, fallback: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return fallback;
  }
}
