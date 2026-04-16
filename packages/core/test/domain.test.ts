import { describe, expect, test } from 'bun:test';
import {
  canActorTransition,
  isValidTransition,
  resolveCapabilities,
  type AgentCapabilities,
} from '../src/domain';

const agent = (name = 'alice', caps?: Partial<AgentCapabilities>) =>
  ({
    kind: 'agent' as const,
    name,
    capabilities: resolveCapabilities('worker', caps),
  });

const human = { kind: 'human' as const };
const daemon = { kind: 'daemon' as const };

describe('task state machine', () => {
  test('forward path backlog → done is reachable', () => {
    expect(isValidTransition('backlog', 'todo')).toBe(true);
    expect(isValidTransition('todo', 'in_progress')).toBe(true);
    expect(isValidTransition('in_progress', 'peer_review')).toBe(true);
    expect(isValidTransition('peer_review', 'review')).toBe(true);
    expect(isValidTransition('review', 'approved')).toBe(true);
    expect(isValidTransition('approved', 'done')).toBe(true);
  });

  test('illegal jumps are rejected', () => {
    expect(isValidTransition('backlog', 'in_progress')).toBe(false);
    expect(isValidTransition('todo', 'review')).toBe(false);
    expect(isValidTransition('done', 'todo')).toBe(false);
    expect(isValidTransition('peer_review', 'done')).toBe(false);
  });

  test('identity transition is always invalid', () => {
    expect(isValidTransition('todo', 'todo')).toBe(false);
  });
});

describe('transition authorisation', () => {
  test('worker can claim a todo', () => {
    const v = canActorTransition(agent(), 'todo', 'in_progress');
    expect(v.ok).toBe(true);
  });

  test('worker cannot promote backlog → todo (that is boss territory)', () => {
    const v = canActorTransition(agent(), 'backlog', 'todo');
    expect(v.ok).toBe(false);
  });

  test('human can promote backlog → todo', () => {
    const v = canActorTransition(human, 'backlog', 'todo');
    expect(v.ok).toBe(true);
  });

  test('only human approves a review', () => {
    expect(canActorTransition(human, 'review', 'approved').ok).toBe(true);
    expect(canActorTransition(agent(), 'review', 'approved').ok).toBe(false);
    expect(canActorTransition(daemon, 'review', 'approved').ok).toBe(false);
  });

  test('peer_review → review is daemon-only (fired by submit_review gate)', () => {
    expect(canActorTransition(daemon, 'peer_review', 'review').ok).toBe(true);
    expect(canActorTransition(agent(), 'peer_review', 'review').ok).toBe(false);
    expect(canActorTransition(human, 'peer_review', 'review').ok).toBe(false);
  });

  test('boss agent (can_promote_tasks) may promote backlog → todo', () => {
    const boss = {
      kind: 'agent' as const,
      name: 'jon',
      capabilities: resolveCapabilities('boss'),
    };
    expect(canActorTransition(boss, 'backlog', 'todo').ok).toBe(true);
  });
});

describe('resolveCapabilities', () => {
  test('worker has write + claim by default', () => {
    const c = resolveCapabilities('worker');
    expect(c.can_claim_tasks).toBe(true);
    expect(c.can_write_files).toBe(true);
    expect(c.can_promote_tasks).toBe(false);
  });

  test('reviewer cannot claim', () => {
    const c = resolveCapabilities('reviewer');
    expect(c.can_claim_tasks).toBe(false);
    expect(c.can_review).toBe(true);
  });

  test('readonly overrides are respected', () => {
    const c = resolveCapabilities('readonly', { can_review: true });
    expect(c.can_review).toBe(true);
    expect(c.can_write_files).toBe(false);
  });

  test('undefined values in overrides do not clobber base', () => {
    const c = resolveCapabilities('worker', { can_claim_tasks: undefined });
    expect(c.can_claim_tasks).toBe(true);
  });
});
