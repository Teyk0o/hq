import type { HeartbeatOutcome, TaskState } from '../db/schema';
import type { ReviewVerdict } from '../db/schema';

export type HQEvent =
  | { type: 'task.created'; task_id: string; by: string }
  | { type: 'task.claimed'; task_id: string; agent: string }
  | { type: 'task.status_changed'; task_id: string; from: TaskState; to: TaskState; by: string }
  | { type: 'task.commented'; task_id: string; author: string; comment_id: string }
  | { type: 'task.reviewed'; task_id: string; reviewer: string; verdict: ReviewVerdict }
  | { type: 'task.blocked'; task_id: string; reason: string }
  | { type: 'task.unblocked'; task_id: string }
  | { type: 'task.pushed'; task_id: string; branch: string }
  | { type: 'agent.heartbeat_started'; agent: string; heartbeat_id: string }
  | {
      type: 'agent.heartbeat_ended';
      agent: string;
      heartbeat_id: string;
      outcome: HeartbeatOutcome;
      tokens_used: number;
    }
  | { type: 'agent.status_changed'; agent: string; status: string }
  | { type: 'agent.token_usage'; agent: string; tokens_today: number; budget: number }
  | { type: 'agent.archived'; agent: string }
  | { type: 'goal.created'; goal_id: string }
  | { type: 'goal.updated'; goal_id: string }
  | { type: 'goal.task_generated'; goal_id: string; task_id: string; by: string }
  | { type: 'message.sent'; from: string; to: string; message_id: string }
  | { type: 'webhook.fired'; url: string; event_type: string }
  | { type: 'webhook.failed'; url: string; error: string }
  | { type: 'daemon.quota_paused'; week_all_pct: number }
  | { type: 'daemon.quota_resumed' }
  | {
      type: 'claude.usage_updated';
      session_pct: number;
      week_all_pct: number;
      week_sonnet_pct: number;
    };

export type HQEventType = HQEvent['type'];
