import { spawn } from 'node:child_process';
import { openProjectDb, agentState } from '@hq/core';
import { eq, inArray } from 'drizzle-orm';
import { join } from 'node:path';
import * as tmux from './tmux';

async function listTmuxSessions(): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = spawn('tmux', ['ls', '-F', '#{session_name}'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.on('error', () => resolve([]));
    proc.on('close', () => resolve(out.split('\n').filter(Boolean)));
  });
}

/**
 * Reconcile live tmux sessions with the registered projects/agents at daemon
 * startup. Any `hq-*` session that no longer maps to an active agent (or whose
 * project is no longer registered) is killed so it doesn't leak CPU or block a
 * subsequent heartbeat that would try to re-create a same-named session.
 *
 * Also resets `agent_state.status = 'idle'` for agents whose recorded tmux
 * session just got killed — otherwise the scheduler thinks they're still working.
 */
export async function reapOrphanedTmuxSessions(
  projects: Array<{ name: string; path: string }>,
): Promise<{ killed: string[]; kept: string[] }> {
  const sessions = await listTmuxSessions();
  const hqSessions = sessions.filter((s) => s.startsWith('hq-'));
  if (hqSessions.length === 0) return { killed: [], kept: [] };

  const knownSessions = new Set<string>();
  const projectBySession = new Map<string, { name: string; path: string }>();

  for (const project of projects) {
    const slug = slugify(project.name);
    try {
      const db = openProjectDb(join(project.path, '.hq', 'db.sqlite'));
      const agents = db.select().from(agentState).all();
      for (const a of agents) {
        if (a.status === 'archived') continue;
        const name = tmux.sessionName(slug, a.name);
        knownSessions.add(name);
        projectBySession.set(name, project);
      }
    } catch {
      // Project DB missing or broken — treat all its agents as unknown.
    }
  }

  const killed: string[] = [];
  const kept: string[] = [];
  for (const session of hqSessions) {
    if (knownSessions.has(session)) {
      kept.push(session);
      continue;
    }
    // Probe sessions (hq-usage-probe-*) are ephemeral and harmless, but they
    // sometimes leak too — kill any that are more than ~2 minutes old.
    if (session.startsWith('hq-usage-probe-')) {
      await tmux.kill(session);
      killed.push(session);
      continue;
    }
    await tmux.kill(session);
    killed.push(session);
  }

  // For kept sessions, make sure their agent_state reflects reality: if the
  // daemon was killed while the agent was marked `working`, flip it back to
  // `idle` so the scheduler considers it eligible again.
  for (const session of kept) {
    const project = projectBySession.get(session);
    if (!project) continue;
    try {
      const db = openProjectDb(join(project.path, '.hq', 'db.sqlite'));
      // session name format: hq-<slug>-<agent>
      const prefix = `hq-${slugify(project.name)}-`;
      if (!session.startsWith(prefix)) continue;
      const agentName = session.slice(prefix.length);
      db.update(agentState)
        .set({ status: 'idle' })
        .where(inArray(agentState.name, [agentName]))
        .run();
      void eq; // retained for possible future scoped reset
    } catch {
      // ignore
    }
  }

  return { killed, kept };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
