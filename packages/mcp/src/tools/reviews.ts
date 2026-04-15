import {
  activity as activityTable,
  comments as commentsTable,
  newId,
  reviews as reviewsTable,
  tasks as tasksTable,
  type ReviewVerdict,
} from '@hq/core';
import { eq } from 'drizzle-orm';
import { requireCapability, type McpContext } from '../context';

export interface SubmitReviewInput {
  id: string;
  verdict: ReviewVerdict;
  body: string;
}

export async function submitReview(ctx: McpContext, input: SubmitReviewInput) {
  requireCapability(ctx, 'can_review');

  const task = ctx.db.select().from(tasksTable).where(eq(tasksTable.id, input.id)).get();
  if (!task) throw new Error(`Task not found: ${input.id}`);
  if (task.status !== 'peer_review') {
    throw new Error(`Task is not in peer_review (current: ${task.status})`);
  }
  if (task.assignee === ctx.agentName) {
    throw new Error('Cannot review your own task');
  }
  if (input.verdict === 'changes_requested' && !input.body.trim()) {
    throw new Error('changes_requested requires a non-empty body');
  }

  ctx.db
    .insert(reviewsTable)
    .values({
      id: newId(),
      taskId: input.id,
      reviewer: ctx.agentName,
      verdict: input.verdict,
      body: input.body,
    })
    .run();

  ctx.db
    .insert(activityTable)
    .values({
      agent: ctx.agentName,
      action: 'review.submitted',
      taskId: input.id,
      details: JSON.stringify({ verdict: input.verdict }),
    })
    .run();

  ctx.bus.publish({
    type: 'task.reviewed',
    task_id: input.id,
    reviewer: ctx.agentName,
    verdict: input.verdict,
  });

  return { ok: true };
}

export async function addComment(
  ctx: McpContext,
  input: { task_id: string; body: string; mentions?: string[] },
) {
  const id = newId();
  ctx.db
    .insert(commentsTable)
    .values({
      id,
      taskId: input.task_id,
      author: ctx.agentName,
      body: input.body,
      mentions: JSON.stringify(input.mentions ?? []),
    })
    .run();

  ctx.bus.publish({
    type: 'task.commented',
    task_id: input.task_id,
    author: ctx.agentName,
    comment_id: id,
  });
  return { id };
}
