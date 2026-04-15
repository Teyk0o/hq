import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  agentState,
  loadAgentConfig,
  loadProjectConfig,
  openProjectDb,
  type HQDatabase,
} from '@hq/core';
import { Cron } from 'croner';
import { and, eq, ne } from 'drizzle-orm';
import { reapStaleHeartbeats, triggerHeartbeat } from './runner';

export interface ProjectEntry {
  name: string;
  path: string;
}

export interface SchedulerOptions {
  projects: ProjectEntry[];
  /** Called whenever the scheduler decides to skip a project (e.g. quota-paused). */
  isQuotaPaused?: () => boolean;
}

export class Scheduler {
  private readonly timers: Cron[] = [];
  private readonly dbs = new Map<string, HQDatabase>();

  async start(options: SchedulerOptions): Promise<void> {
    for (const project of options.projects) {
      await this.scheduleProject(project, options.isQuotaPaused);
    }
  }

  stop(): void {
    for (const t of this.timers) t.stop();
    this.timers.length = 0;
  }

  private async scheduleProject(
    project: ProjectEntry,
    isQuotaPaused?: () => boolean,
  ): Promise<void> {
    const cfg = await loadProjectConfig(join(project.path, '.hq', 'project.toml'));
    const db = openProjectDb(join(project.path, '.hq', 'db.sqlite'));
    this.dbs.set(project.name, db);

    const intervalMin = cfg.scheduler.interval_minutes;
    const stagger = cfg.scheduler.stagger_seconds;
    const pattern = `*/${intervalMin} * * * *`;

    const tick = new Cron(pattern, { paused: false }, async () => {
      if (isQuotaPaused?.()) return;
      await this.runTick(project, db, cfg.scheduler.max_concurrent_agents, stagger);
    });
    this.timers.push(tick);

    // Separate reaper tick (every minute) for stale heartbeats.
    const reaper = new Cron('* * * * *', { paused: false }, async () => {
      await reapStaleHeartbeats(db, cfg.heartbeat.default_timeout_minutes);
    });
    this.timers.push(reaper);
  }

  private async runTick(
    project: ProjectEntry,
    db: HQDatabase,
    maxConcurrent: number,
    staggerSeconds: number,
  ): Promise<void> {
    const agents = await listAgents(project.path);
    const working = db
      .select()
      .from(agentState)
      .where(and(eq(agentState.status, 'working'), ne(agentState.name, '')))
      .all();
    let slots = Math.max(0, maxConcurrent - working.length);

    for (const agentName of agents) {
      if (slots <= 0) break;
      const state = db.select().from(agentState).where(eq(agentState.name, agentName)).get();
      if (state?.status === 'working' || state?.status === 'archived') continue;
      if (state?.status === 'paused_quota') continue;

      const agentCfg = await loadAgentConfig(
        join(project.path, '.hq', 'agents', `${agentName}.toml`),
      );
      if (!agentCfg.agent.active) continue;

      // Stagger between agents within the same tick.
      if (slots < maxConcurrent) await sleep(staggerSeconds * 1000);
      try {
        await triggerHeartbeat({ projectPath: project.path, agentName, db });
        slots -= 1;
      } catch (err) {
        console.error(`[scheduler] ${project.name}/${agentName} heartbeat failed:`, err);
      }
    }
  }
}

async function listAgents(projectPath: string): Promise<string[]> {
  const dir = join(projectPath, '.hq', 'agents');
  const entries = await readdir(dir).catch(() => []);
  return entries.filter((f) => f.endsWith('.toml')).map((f) => f.slice(0, -'.toml'.length));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
