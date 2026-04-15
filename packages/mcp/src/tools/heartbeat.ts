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
  } else {
    id = newId();
    const startedAt = Date.now();
    const logDir = join(ctx.projectPath, '.hq', 'logs', ctx.agentName);
    await mkdir(logDir, { recursive: true });
    const logPath = join(
      logDir,
      `${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}.log`,
    );
    ctx.db
      .insert(heartbeatsTable)
      .values({ id, agent: ctx.agentName, startedAt, logPath })
      .run();
  }

  ctx.db
    .update(agentState)
    .set({ status: 'working', lastHeartbeat: Date.now() })
    .where(eq(agentState.name, ctx.agentName))
    .run();

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

  ctx.db
    .update(heartbeatsTable)
    .set({
      endedAt,
      outcome: 'ok',
      tokensUsed,
      tasksWorked: JSON.stringify([...ctx.tasksWorkedThisHeartbeat]),
    })
    .where(eq(heartbeatsTable.id, id))
    .run();

  ctx.db
    .update(agentState)
    .set({ status: 'idle' })
    .where(eq(agentState.name, ctx.agentName))
    .run();

  if (input.summary) {
    const progressDir = join(ctx.projectPath, '.hq', 'progress');
    await mkdir(progressDir, { recursive: true });
    await writeFile(join(progressDir, `${ctx.agentName}.md`), input.summary, 'utf-8');
  }

  ctx.db
    .insert(activityTable)
    .values({
      agent: ctx.agentName,
      action: 'heartbeat.ended',
      details: JSON.stringify({ tokens_used: tokensUsed }),
    })
    .run();

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
