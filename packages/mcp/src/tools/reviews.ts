import {
  activity as activityTable,
  comments as commentsTable,
  messages as messagesTable,
  newId,
  reviews as reviewsTable,
  tasks as tasksTable,
  type ReviewVerdict,
} from '@hq/core';
import { and, eq } from 'drizzle-orm';
import { McpError, requireCapability, type McpContext } from '../context';

export interface SubmitReviewInput {
  id: string;
  verdict: ReviewVerdict;
  body: string;
}

/**
 * Submit a peer review. Atomic with the state-transition check:
 *  - if any reviewer requests changes → task.status goes to `in_progress` so
 *    the author can address feedback
 *  - else, if the number of distinct `approved` reviews reaches the project's
 *    `min_reviewers` threshold → task.status goes to `review` (waiting for
 *    human sign-off)
 *
 * We run all writes in one transaction so the transition is always consistent
 * with the reviews table, even if two reviewers submit at the same time.
 */
export async function submitReview(ctx: McpContext, input: SubmitReviewInput) {
  requireCapability(ctx, 'can_review');

  const task = ctx.db.select().from(tasksTable).where(eq(tasksTable.id, input.id)).get();
  if (!task) throw new McpError('task_not_found', `Task not found: ${input.id}`);
  if (task.status !== 'peer_review') {
    throw new McpError(
      'invalid_state',
      `Task is not in peer_review (current: ${task.status})`,
      { current_status: task.status },
    );
  }
  if (task.assignee === ctx.agentName) {
    throw new McpError('self_review', 'Cannot review your own task');
  }
  if (input.verdict === 'changes_requested' && !input.body.trim()) {
    throw new McpError(
      'missing_body',
      'changes_requested requires a non-empty body',
    );
  }

  const minReviewers = ctx.projectConfig.kanban.min_reviewers;
  const outcome = ctx.db.transaction((tx) => {
    tx.insert(reviewsTable)
      .values({
        id: newId(),
        taskId: input.id,
        reviewer: ctx.agentName,
        verdict: input.verdict,
        body: input.body,
      })
      .run();

    tx.insert(activityTable)
      .values({
        agent: ctx.agentName,
        action: 'review.submitted',
        taskId: input.id,
        details: JSON.stringify({ verdict: input.verdict }),
      })
      .run();

    // Re-read all reviews for this task to decide the next state.
    const all = tx
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.taskId, input.id))
      .all();

    const hasChangesRequested = all.some((r) => r.verdict === 'changes_requested');
    const approvals = new Set(
      all.filter((r) => r.verdict === 'approved').map((r) => r.reviewer),
    );

    let transitionTo: 'todo' | 'review' | null = null;
    if (hasChangesRequested) transitionTo = 'todo';
    else if (approvals.size >= minReviewers) transitionTo = 'review';

    if (transitionTo) {
      if (transitionTo === 'todo') {
        tx.update(tasksTable)
          .set({ status: transitionTo, assignee: null, updatedAt: Date.now() })
          .where(and(eq(tasksTable.id, input.id), eq(tasksTable.status, 'peer_review')))
          .run();
      } else {
        tx.update(tasksTable)
          .set({ status: transitionTo, updatedAt: Date.now() })
          .where(and(eq(tasksTable.id, input.id), eq(tasksTable.status, 'peer_review')))
          .run();
      }
      const after = tx.select().from(tasksTable).where(eq(tasksTable.id, input.id)).get();
      if (after?.status === transitionTo) {
        return { transitionTo };
      }
    }
    return { transitionTo: null as 'todo' | 'review' | null };
  });

  ctx.bus.publish({
    type: 'task.reviewed',
    task_id: input.id,
    reviewer: ctx.agentName,
    verdict: input.verdict,
  });

  if (outcome.transitionTo) {
    ctx.bus.publish({
      type: 'task.status_changed',
      task_id: input.id,
      from: 'peer_review',
      to: outcome.transitionTo,
      by: 'daemon',
    });
  }

  return { ok: true, next_status: outcome.transitionTo ?? 'peer_review' };
}

/**
 * Request rework on any open task: adds a comment and resets it to `todo`
 * (unassigned) so any worker can pick it up. Usable by boss and reviewer.
 * This is the preferred tool when a task needs changes instead of creating
 * a near-duplicate task.
 */
export async function requestRework(
  ctx: McpContext,
  input: { id: string; reason: string },
) {
  requireCapability(ctx, 'can_review');
  const task = ctx.db.select().from(tasksTable).where(eq(tasksTable.id, input.id)).get();
  if (!task) throw new McpError('task_not_found', `Task not found: ${input.id}`);
  if (task.status === 'done') {
    throw new McpError('invalid_state', 'Cannot request rework on a done task');
  }

  const commentId = newId();
  const prevStatus = task.status;
  ctx.db.transaction((tx) => {
    tx.insert(commentsTable)
      .values({
        id: commentId,
        taskId: input.id,
        author: ctx.agentName,
        body: `**Rework requested:** ${input.reason}`,
      })
      .run();
    tx.update(tasksTable)
      .set({ status: 'todo', assignee: null, updatedAt: Date.now() })
      .where(eq(tasksTable.id, input.id))
      .run();
  });

  ctx.bus.publish({ type: 'task.commented', task_id: input.id, author: ctx.agentName, comment_id: commentId });
  ctx.bus.publish({ type: 'task.status_changed', task_id: input.id, from: prevStatus, to: 'todo', by: ctx.agentName });
  return { ok: true, comment_id: commentId };
}

export async function addComment(
  ctx: McpContext,
  input: { task_id: string; body: string; mentions?: string[] },
) {
  const id = newId();
  // Extract mentions from the body if the caller didn't pass them explicitly —
  // agents often write @names inline without remembering to fill the array.
  const explicit = input.mentions ?? [];
  const inlineMatches = [...input.body.matchAll(/@([a-z][a-z0-9_-]*)/gi)].map((m) =>
    m[1]!.toLowerCase(),
  );
  const mentions = [...new Set([...explicit, ...inlineMatches])].filter(
    (m) => m !== ctx.agentName,
  );

  const task = ctx.db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, input.task_id))
    .get();

  const fanout: Array<{ to: string; id: string }> = [];
  ctx.db.transaction((tx) => {
    tx.insert(commentsTable)
      .values({
        id,
        taskId: input.task_id,
        author: ctx.agentName,
        body: input.body,
        mentions: JSON.stringify(mentions),
      })
      .run();
    for (const mention of mentions) {
      const msgId = newId();
      tx.insert(messagesTable)
        .values({
          id: msgId,
          fromAgent: ctx.agentName,
          toAgent: mention,
          subject: task ? `Mention on: ${task.title}` : 'You were mentioned',
          body: input.body,
        })
        .run();
      fanout.push({ to: mention, id: msgId });
    }
  });

  ctx.bus.publish({
    type: 'task.commented',
    task_id: input.task_id,
    author: ctx.agentName,
    comment_id: id,
  });
  for (const f of fanout) {
    ctx.bus.publish({
      type: 'message.sent',
      from: ctx.agentName,
      to: f.to,
      message_id: f.id,
    });
  }
  return { id, fanout: fanout.length };
}
