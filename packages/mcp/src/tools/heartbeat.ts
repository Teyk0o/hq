import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  agentState,
  heartbeats as heartbeatsTable,
  activity as activityTable,
  newId,
} from '@hq/core';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { McpContext } from '../context';

export async function startHeartbeat(ctx: McpContext): Promise<{ heartbeat_id: string }> {
  if (ctx.currentHeartbeatId) {
    return { heartbeat_id: ctx.currentHeartbeatId };
  }

  // Prefer re-using the row the daemon pre-created when it triggered us. This
  // avoids a duplicate row per heartbeat and keeps the log_path consistent.
  const openRow = ctx.db
    .select()
    .from(heartbeatsTable)
    .where(and(eq(heartbeatsTable.agent, ctx.agentName), isNull(heartbeatsTable.endedAt)))
    .orderBy(desc(heartbeatsTable.startedAt))
    .limit(1)
    .get();

  let id: string;
  if (openRow) {
    id = openRow.id;
    ctx.db
      .update(agentState)
      .set({ status: 'working', lastHeartbeat: Date.now() })
      .where(eq(agentState.name, ctx.agentName))
      .run();
  } else {
    id = newId();
    const startedAt = Date.now();
    const logDir = join(ctx.projectPath, '.hq', 'logs', ctx.agentName);
    await mkdir(logDir, { recursive: true });
    const logPath = join(
      logDir,
      `${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}.log`,
    );
    // New heartbeat row + agent state flip are written atomically so the
    // scheduler never sees a half-baked state where the row exists but the
    // agent is still "idle".
    ctx.db.transaction((tx) => {
      tx.insert(heartbeatsTable)
        .values({ id, agent: ctx.agentName, startedAt, logPath })
        .run();
      tx.update(agentState)
        .set({ status: 'working', lastHeartbeat: Date.now() })
        .where(eq(agentState.name, ctx.agentName))
        .run();
    });
  }

  ctx.currentHeartbeatId = id;
  ctx.tasksWorkedThisHeartbeat.clear();

  ctx.bus.publish({ type: 'agent.heartbeat_started', agent: ctx.agentName, heartbeat_id: id });
  ctx.bus.publish({ type: 'agent.status_changed', agent: ctx.agentName, status: 'working' });
  return { heartbeat_id: id };
}

export async function endHeartbeat(
  ctx: McpContext,
  input: { summary?: string; tokens_used?: number },
): Promise<{ ok: true }> {
  const id = ctx.currentHeartbeatId;
  if (!id) {
    // Tolerate double-call — return ok rather than throw, since this is the "safe landing" tool.
    return { ok: true };
  }
  const endedAt = Date.now();
  const tokensUsed = input.tokens_used ?? 0;

  // Filesystem write lives outside the transaction — it's not reversible and
  // the db writes themselves must be atomic with each other, not with IO.
  if (input.summary) {
    const progressDir = join(ctx.projectPath, '.hq', 'progress');
    await mkdir(progressDir, { recursive: true });
    await writeFile(join(progressDir, `${ctx.agentName}.md`), input.summary, 'utf-8');
  }

  ctx.db.transaction((tx) => {
    tx.update(heartbeatsTable)
      .set({
        endedAt,
        outcome: 'ok',
        tokensUsed,
        tasksWorked: JSON.stringify([...ctx.tasksWorkedThisHeartbeat]),
      })
      .where(eq(heartbeatsTable.id, id))
      .run();
    // Only transition to idle from working. If the operator paused or
    // archived the agent mid-heartbeat, preserve that intent — otherwise
    // the scheduler's next tick would pick the agent straight back up.
    tx.update(agentState)
      .set({ status: 'idle' })
      .where(and(eq(agentState.name, ctx.agentName), eq(agentState.status, 'working')))
      .run();
    tx.insert(activityTable)
      .values({
        agent: ctx.agentName,
        action: 'heartbeat.ended',
        details: JSON.stringify({ tokens_used: tokensUsed }),
      })
      .run();
  });

  ctx.bus.publish({
    type: 'agent.heartbeat_ended',
    agent: ctx.agentName,
    heartbeat_id: id,
    outcome: 'ok',
    tokens_used: tokensUsed,
  });
  ctx.bus.publish({ type: 'agent.status_changed', agent: ctx.agentName, status: 'idle' });

  ctx.currentHeartbeatId = null;
  return { ok: true };
}

export async function updateProgress(
  ctx: McpContext,
  input: { body: string },
): Promise<{ ok: true }> {
  const progressDir = join(ctx.projectPath, '.hq', 'progress');
  await mkdir(progressDir, { recursive: true });
  await writeFile(join(progressDir, `${ctx.agentName}.md`), input.body, 'utf-8');
  return { ok: true };
}
