import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  agentState,
  loadAgentConfig,
  openProjectDb,
  resolveCapabilities,
  type HQDatabase,
} from '@hq/core';
import { eq } from 'drizzle-orm';
import type { EventBus } from '@hq/mcp';
import type { HQEvent } from '@hq/core';
import { triggerHeartbeat } from './runner';

/**
 * Event-driven trigger: whenever a task transitions to peer_review (or is
 * unblocked into it), wake up an idle reviewer immediately instead of
 * waiting for the next scheduler tick. This closes the loop between a
 * worker's submit_for_review and the reviewer actually looking at it.
 *
 * The scheduler keeps running in parallel for the "no event" case (idle
 * periods, goal-driven boss ticks, etc.).
 */
export function installEventTriggers(
  bus: EventBus,
  projects: Array<{ name: string; path: string }>,
): () => void {
  // Cache per-project DB handles. triggerHeartbeat opens one on demand
  // through the runner; we just need one for eligibility queries.
  const dbs = new Map<string, HQDatabase>();
  const dbFor = (name: string): HQDatabase | null => {
    const existing = dbs.get(name);
    if (existing) return existing;
    const p = projects.find((pr) => pr.name === name);
    if (!p) return null;
    const db = openProjectDb(join(p.path, '.hq', 'db.sqlite'));
    dbs.set(name, db);
    return db;
  };

  // Re-entrancy guard so back-to-back events don't spawn N heartbeats for the
  // same agent (the agent_state → working flip also guards, but this is cheap).
  const inFlight = new Set<string>();

  const wake = async (
    project: { name: string; path: string },
    agent: string,
    reason: string,
  ) => {
    const db = dbFor(project.name);
    if (!db) return;
    const state = db.select().from(agentState).where(eq(agentState.name, agent)).get();
    if (!state || state.status !== 'idle') return;
    const key = `${project.name}:${agent}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      console.log(`[triggers] ${project.name}: ${reason}, waking ${agent}`);
      await triggerHeartbeat({ projectPath: project.path, agentName: agent, db });
    } catch (err) {
      console.error(`[triggers] ${project.name}/${agent} failed:`, err);
    } finally {
      setTimeout(() => inFlight.delete(key), 30_000);
    }
  };

  const unsubscribe = bus.subscribe((event: HQEvent) => {
    if (event.type === 'task.status_changed' && event.to === 'peer_review') {
      void (async () => {
        for (const project of projects) {
          const db = dbFor(project.name);
          if (!db) continue;
          const reviewer = await pickIdleReviewer(project.path, db, event.by);
          if (!reviewer) continue;
          await wake(project, reviewer, 'task.status_changed → peer_review');
        }
      })();
      return;
    }

    // A direct message (@mention or explicit DM) wakes the recipient if idle.
    // Broadcast '*' is intentionally NOT fanned out to every agent — that
    // would be a thundering-herd every time someone says "hi team".
    if (event.type === 'message.sent' && event.to !== '*' && event.to !== 'human') {
      void (async () => {
        for (const project of projects) {
          await wake(project, event.to, `message.sent from ${event.from}`);
        }
      })();
      return;
    }
  });

  return unsubscribe;
}

async function pickIdleReviewer(
  projectPath: string,
  db: HQDatabase,
  excludeAgent: string,
): Promise<string | null> {
  const dir = join(projectPath, '.hq', 'agents');
  const files = await readdir(dir).catch(() => []);
  const names = files.filter((f) => f.endsWith('.toml')).map((f) => f.slice(0, -'.toml'.length));

  for (const name of names) {
    if (name === excludeAgent) continue; // can't review own work
    const state = db.select().from(agentState).where(eq(agentState.name, name)).get();
    if (!state || state.status !== 'idle') continue;

    let cfg: Awaited<ReturnType<typeof loadAgentConfig>>;
    try {
      cfg = await loadAgentConfig(join(dir, `${name}.toml`));
    } catch {
      continue;
    }
    if (!cfg.agent.active) continue;

    const caps = resolveCapabilities(cfg.agent.role, cfg.capabilities);
    if (!caps.can_review) continue;
    return name;
  }
  return null;
}
