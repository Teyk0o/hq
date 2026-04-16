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
      if (isQuotaPaused?.()) {
        console.log(`[scheduler] ${project.name}: tick skipped (quota paused)`);
        return;
      }
      const t0 = Date.now();
      const fired = await this.runTick(
        project,
        db,
        cfg.scheduler.max_concurrent_agents,
        stagger,
      );
      const elapsed = Date.now() - t0;
      console.log(
        `[scheduler] ${project.name}: tick fired ${fired.length} agent(s) in ${elapsed}ms${fired.length ? ' (' + fired.join(', ') + ')' : ''}`,
      );
    });
    this.timers.push(tick);
    console.log(
      `[scheduler] ${project.name}: every ${intervalMin}min (stagger ${stagger}s, max_concurrent ${cfg.scheduler.max_concurrent_agents})`,
    );

    // Separate reaper tick (every minute) for stale heartbeats.
    const reaper = new Cron('* * * * *', { paused: false }, async () => {
      await reapStaleHeartbeats(
        db,
        cfg.heartbeat.default_timeout_minutes,
        cfg.heartbeat.retry_max,
      );
    });
    this.timers.push(reaper);
  }

  private async runTick(
    project: ProjectEntry,
    db: HQDatabase,
    maxConcurrent: number,
    staggerSeconds: number,
  ): Promise<string[]> {
    const fired: string[] = [];
    const agentNames = await listAgents(project.path);
    const working = db
      .select()
      .from(agentState)
      .where(and(eq(agentState.status, 'working'), ne(agentState.name, '')))
      .all();
    let slots = Math.max(0, maxConcurrent - working.length);

    // Load balancing: pick the "coolest" eligible agent first. Sorting by
    // (tokens_today asc, last_heartbeat asc NULLS first) pushes recently-
    // active / token-hungry agents to the back so quieter ones get a turn
    // before the talkative ones monopolise the slot budget. Agents with a
    // non-idle status are filtered out, not ranked.
    const candidates = [];
    for (const name of agentNames) {
      const state = db.select().from(agentState).where(eq(agentState.name, name)).get();
      if (!state) continue;
      // 'paused' and 'paused_quota' are both skipped — distinct so the UI
      // can show a different badge and the scheduler can log a reason.
      if (state.status !== 'idle') continue;
      candidates.push({ name, tokens: state.tokensToday, last: state.lastHeartbeat ?? 0 });
    }
    candidates.sort((a, b) => a.tokens - b.tokens || a.last - b.last);

    for (const candidate of candidates) {
      if (slots <= 0) break;
      const agentCfg = await loadAgentConfig(
        join(project.path, '.hq', 'agents', `${candidate.name}.toml`),
      );
      if (!agentCfg.agent.active) continue;

      // Stagger between agents within the same tick.
      if (slots < maxConcurrent) await sleep(staggerSeconds * 1000);
      try {
        await triggerHeartbeat({ projectPath: project.path, agentName: candidate.name, db });
        fired.push(candidate.name);
        slots -= 1;
      } catch (err) {
        console.error(
          `[scheduler] ${project.name}/${candidate.name} heartbeat failed:`,
          err,
        );
      }
    }
    return fired;
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
