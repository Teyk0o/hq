import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import {
  openProjectDb,
  agentState,
  heartbeats as heartbeatsTable,
  tasks as tasksTable,
} from '@hq/core';
import { eq } from 'drizzle-orm';
import { reapStaleHeartbeats } from '../src/runner';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'hq-reaper-test-'));
  const db = openProjectDb(join(dir, 'db.sqlite'));
  return { db, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('reapStaleHeartbeats', () => {
  test('no-op when no open heartbeats', async () => {
    const { db, cleanup } = freshDb();
    try {
      const r = await reapStaleHeartbeats(db, 15);
      expect(r.reaped).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  test('leaves fresh heartbeats alone', async () => {
    const { db, cleanup } = freshDb();
    try {
      db.insert(agentState)
        .values({ name: 'alice', status: 'working', budgetResetAt: Date.now() + 86_400_000 })
        .run();
      db.insert(heartbeatsTable)
        .values({
          id: 'hb1',
          agent: 'alice',
          startedAt: Date.now() - 60_000, // 1 min old
          logPath: '/tmp/x',
        })
        .run();
      const r = await reapStaleHeartbeats(db, 15);
      expect(r.reaped).toHaveLength(0);
      const state = db.select().from(agentState).where(eq(agentState.name, 'alice')).get();
      expect(state?.status).toBe('working');
    } finally {
      cleanup();
    }
  });

  test('reaps a stale heartbeat, increments retry, unclaims the task', async () => {
    const { db, cleanup } = freshDb();
    try {
      db.insert(agentState)
        .values({ name: 'alice', status: 'working', budgetResetAt: Date.now() + 86_400_000 })
        .run();
      db.insert(tasksTable)
        .values({
          id: 't1',
          title: 'do something',
          createdBy: 'human',
          status: 'in_progress',
          assignee: 'alice',
        })
        .run();
      db.insert(heartbeatsTable)
        .values({
          id: 'hb1',
          agent: 'alice',
          startedAt: Date.now() - 20 * 60_000, // 20 min old, threshold is 15
          logPath: '/tmp/x',
        })
        .run();
      const r = await reapStaleHeartbeats(db, 15, 2);
      expect(r.reaped).toHaveLength(1);
      expect(r.reaped[0]?.agent).toBe('alice');
      expect(r.reaped[0]?.giveUp).toBe(false);

      const task = db.select().from(tasksTable).where(eq(tasksTable.id, 't1')).get();
      expect(task?.status).toBe('todo');
      expect(task?.assignee).toBeNull();

      const state = db.select().from(agentState).where(eq(agentState.name, 'alice')).get();
      expect(state?.status).toBe('idle');

      const hb = db.select().from(heartbeatsTable).where(eq(heartbeatsTable.id, 'hb1')).get();
      expect(hb?.outcome).toBe('timeout');
      expect(hb?.retryCount).toBe(1);
    } finally {
      cleanup();
    }
  });

  test('flips agent to blocked once retry budget is exhausted', async () => {
    const { db, cleanup } = freshDb();
    try {
      db.insert(agentState)
        .values({ name: 'bob', status: 'working', budgetResetAt: Date.now() + 86_400_000 })
        .run();
      db.insert(heartbeatsTable)
        .values({
          id: 'hb2',
          agent: 'bob',
          startedAt: Date.now() - 30 * 60_000,
          logPath: '/tmp/x',
          retryCount: 2, // already at retry_max, next reap gives up
        })
        .run();
      const r = await reapStaleHeartbeats(db, 15, 2);
      expect(r.reaped[0]?.giveUp).toBe(true);
      const state = db.select().from(agentState).where(eq(agentState.name, 'bob')).get();
      expect(state?.status).toBe('blocked');
      expect(state?.blockedReason).toContain('timeout');
    } finally {
      cleanup();
    }
  });
});
