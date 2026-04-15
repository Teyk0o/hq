import {
  activity as activityTable,
  agentState,
  messages as messagesTable,
  newId,
} from '@hq/core';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { McpContext } from '../context';

export async function listTeammates(ctx: McpContext) {
  const rows = ctx.db.select().from(agentState).all();
  return {
    teammates: rows.map((r) => ({
      name: r.name,
      status: r.status,
      last_heartbeat: r.lastHeartbeat,
      current_task_id: r.currentTaskId,
      is_self: r.name === ctx.agentName,
    })),
  };
}

export async function sendMessage(
  ctx: McpContext,
  input: { to: string; subject?: string; body: string },
) {
  const id = newId();
  ctx.db
    .insert(messagesTable)
    .values({
      id,
      fromAgent: ctx.agentName,
      toAgent: input.to,
      subject: input.subject ?? '',
      body: input.body,
    })
    .run();

  ctx.bus.publish({
    type: 'message.sent',
    from: ctx.agentName,
    to: input.to,
    message_id: id,
  });
  return { id };
}

export async function readMessages(
  ctx: McpContext,
  input: { unread_only?: boolean } = {},
) {
  const conditions = [
    or(eq(messagesTable.toAgent, ctx.agentName), eq(messagesTable.toAgent, '*')),
  ];
  if (input.unread_only) conditions.push(isNull(messagesTable.readAt));

  const rows = ctx.db
    .select()
    .from(messagesTable)
    .where(and(...conditions))
    .orderBy(desc(messagesTable.createdAt))
    .limit(50)
    .all();

  const now = Date.now();
  for (const m of rows) {
    if (!m.readAt) {
      ctx.db.update(messagesTable).set({ readAt: now }).where(eq(messagesTable.id, m.id)).run();
    }
  }

  return { messages: rows };
}

export async function logActivity(
  ctx: McpContext,
  input: { action: string; details?: Record<string, unknown> },
) {
  ctx.db
    .insert(activityTable)
    .values({
      agent: ctx.agentName,
      action: input.action,
      details: JSON.stringify(input.details ?? {}),
    })
    .run();
  return { ok: true };
}
