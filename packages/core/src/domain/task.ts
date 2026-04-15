import type { TaskState } from '../db/schema';

export type Actor =
  | { kind: 'human' }
  | { kind: 'agent'; name: string; capabilities: AgentCapabilities }
  | { kind: 'daemon' };

export interface AgentCapabilities {
  can_claim_tasks: boolean;
  can_review: boolean;
  can_promote_tasks: boolean;
  can_create_tasks: boolean;
  can_write_files: boolean;
  can_commit: boolean;
}

/** Structural validation of a state transition. Authorisation is checked separately. */
export function isValidTransition(from: TaskState, to: TaskState): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

const ALLOWED_TRANSITIONS: Record<TaskState, TaskState[]> = {
  backlog: ['todo'],
  todo: ['in_progress', 'backlog'],
  in_progress: ['peer_review', 'blocked', 'todo'],
  peer_review: ['review', 'in_progress', 'blocked'],
  review: ['approved', 'in_progress', 'blocked'],
  approved: ['done', 'in_progress'],
  done: [],
  blocked: ['todo', 'in_progress', 'peer_review', 'review'],
};

/** Who is allowed to drive a given transition. */
export function canActorTransition(
  actor: Actor,
  from: TaskState,
  to: TaskState,
): { ok: true } | { ok: false; reason: string } {
  if (!isValidTransition(from, to)) {
    return { ok: false, reason: `invalid transition ${from} → ${to}` };
  }

  const rule = TRANSITION_AUTH[`${from}→${to}`];
  if (!rule) return { ok: false, reason: 'no authorisation rule' };
  return rule(actor);
}

type AuthRule = (actor: Actor) => { ok: true } | { ok: false; reason: string };

const human: AuthRule = (a) =>
  a.kind === 'human' ? { ok: true } : { ok: false, reason: 'human only' };
const daemon: AuthRule = (a) =>
  a.kind === 'daemon' ? { ok: true } : { ok: false, reason: 'daemon only' };
const agentWith =
  (cap: keyof AgentCapabilities): AuthRule =>
  (a) => {
    if (a.kind !== 'agent') return { ok: false, reason: 'agent only' };
    return a.capabilities[cap]
      ? { ok: true }
      : { ok: false, reason: `agent lacks ${cap}` };
  };
const anyOf =
  (...rules: AuthRule[]): AuthRule =>
  (a) => {
    for (const r of rules) if (r(a).ok) return { ok: true };
    return { ok: false, reason: 'none of the rules matched' };
  };

const TRANSITION_AUTH: Record<string, AuthRule> = {
  'backlog→todo': anyOf(human, agentWith('can_promote_tasks')),
  'todo→in_progress': agentWith('can_claim_tasks'),
  'todo→backlog': human,
  'in_progress→peer_review': agentWith('can_claim_tasks'),
  'in_progress→blocked': anyOf(agentWith('can_claim_tasks'), daemon),
  'in_progress→todo': anyOf(human, daemon),
  'peer_review→review': daemon,
  'peer_review→in_progress': daemon,
  'peer_review→blocked': daemon,
  'review→approved': human,
  'review→in_progress': human,
  'review→blocked': daemon,
  'approved→done': human,
  'approved→in_progress': human,
  'blocked→todo': human,
  'blocked→in_progress': human,
  'blocked→peer_review': human,
  'blocked→review': human,
};
