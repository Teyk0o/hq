import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  agentState,
  loadAgentConfig,
  loadProjectConfig,
  type HQDatabase,
  newId,
  heartbeats as heartbeatsTable,
  tasks as tasksTable,
} from '@hq/core';
import { and, eq, isNull } from 'drizzle-orm';
import { buildHeartbeatPrompt } from './heartbeat';
import { buildClaudeLaunchCommand, isBwrapAvailable } from './sandbox';
import * as tmux from './tmux';
import { preApproveTrust } from './trust';
import { ensureWorktree } from './worktree';

export interface RunHeartbeatOptions {
  projectPath: string;
  agentName: string;
  db: HQDatabase;
}

/**
 * Triggers one heartbeat for a given agent. Ensures the tmux session exists,
 * pipe-pane is wired, and the prompt is sent. Returns once the prompt has been
 * dispatched — the daemon tracks completion via the MCP `end_heartbeat` event.
 */
export async function triggerHeartbeat(options: RunHeartbeatOptions): Promise<void> {
  const project = await loadProjectConfig(join(options.projectPath, '.hq', 'project.toml'));
  const agent = await loadAgentConfig(
    join(options.projectPath, '.hq', 'agents', `${options.agentName}.toml`),
  );

  const slug = slugify(project.project.name);
  const session = tmux.sessionName(slug, options.agentName);
  const worktreeDir = join(options.projectPath, project.git.worktree_dir, options.agentName);
  await ensureWorktree({
    projectPath: options.projectPath,
    worktreePath: worktreeDir,
    agentName: options.agentName,
    branchPrefix: project.git.branch_prefix,
  });
  // Claude Code prompts a trust dialog on first access to a new directory.
  // Pre-accept it so the TUI doesn't hang waiting for input from our headless daemon.
  await preApproveTrust(worktreeDir);

  const logDir = join(options.projectPath, '.hq', 'logs', options.agentName);
  await mkdir(logDir, { recursive: true });
  const startedAt = Date.now();
  const logPath = join(logDir, `${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}.log`);

  const sessionExisted = await tmux.exists(session);
  if (!sessionExisted) {
    const bwrapOk = await isBwrapAvailable();
    if (project.sandbox.enabled && !bwrapOk) {
      console.warn(
        '[runner] bwrap not found on PATH — falling back to non-sandboxed claude. ' +
          'Install bubblewrap (apt install bubblewrap) for proper isolation.',
      );
    }
    const launchCmd = buildClaudeLaunchCommand(worktreeDir, project.sandbox, bwrapOk);
    // Launch claude as the tmux pane's root command (not inside a shell) so that
    // send-keys to this pane goes directly to claude instead of being mangled by
    // the user's interactive shell autosuggest/highlighting.
    await tmux.create(session, worktreeDir, launchCmd);
    await tmux.pipePane(session, logPath);
    // Let claude's TUI initialise.
    await sleep(3500);
  } else {
    // Re-wire pipe-pane to a fresh log file for this heartbeat.
    await tmux.pipePane(session, logPath);
  }

  // Hybrid session mode: if the agent has no active task, /clear first.
  const hasActiveTask =
    options.db
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.assignee, options.agentName), eq(tasksTable.status, 'in_progress')))
      .limit(1)
      .all().length > 0;
  if (!hasActiveTask) {
    await tmux.sendKeys(session, '/clear', { enter: true });
    await sleep(500);
  }

  const timeoutMinutes =
    agent.timeout?.heartbeat_minutes ?? project.heartbeat.default_timeout_minutes;
  const maxTokens = agent.budget?.max_tokens_per_heartbeat ?? 200_000;

  const prompt = await buildHeartbeatPrompt({
    agentName: options.agentName,
    agentRole: agent.agent.role,
    projectName: project.project.name,
    projectPath: options.projectPath,
    agentConfig: agent,
    db: options.db,
    maxTokens,
    timeoutMinutes,
  });

  await tmux.sendPrompt(session, prompt);

  // Pre-create a heartbeat row so that timeouts and crashes can be detected.
  const hbId = newId();
  options.db
    .insert(heartbeatsTable)
    .values({
      id: hbId,
      agent: options.agentName,
      startedAt,
      logPath,
    })
    .run();

  options.db
    .update(agentState)
    .set({ status: 'working', lastHeartbeat: startedAt, tmuxSession: session })
    .where(eq(agentState.name, options.agentName))
    .run();
}

/**
 * Scan for agents whose heartbeat has exceeded their timeout and finalise them.
 * Called on a regular cadence by the daemon.
 */
export async function reapStaleHeartbeats(
  db: HQDatabase,
  defaultTimeoutMinutes: number,
): Promise<void> {
  const threshold = Date.now() - defaultTimeoutMinutes * 60_000;
  const stale = db
    .select()
    .from(heartbeatsTable)
    .where(and(isNull(heartbeatsTable.endedAt)))
    .all()
    .filter((h) => h.startedAt < threshold);

  for (const h of stale) {
    db.update(heartbeatsTable)
      .set({ endedAt: Date.now(), outcome: 'timeout' })
      .where(eq(heartbeatsTable.id, h.id))
      .run();
    db.update(agentState)
      .set({ status: 'idle' })
      .where(eq(agentState.name, h.agent))
      .run();
    // Unclaim any in_progress task held by this agent.
    db.update(tasksTable)
      .set({ status: 'todo', assignee: null, updatedAt: Date.now() })
      .where(and(eq(tasksTable.assignee, h.agent), eq(tasksTable.status, 'in_progress')))
      .run();
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
