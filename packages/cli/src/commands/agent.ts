import { mkdir, writeFile, access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { spawn } from 'node:child_process';
import {
  agentState,
  loadProjectConfig,
  openProjectDb,
  tasks as tasksTable,
} from '@hq/core';
import { triggerHeartbeat } from '@hq/daemon';
import { and, eq } from 'drizzle-orm';
import { resolveProjectPath } from '../util';

const DEFAULT_TOML = (name: string, role: string, gender?: string) => `[agent]
name = "${name}"
role = "${role}"
# model = "sonnet"  # uncomment to override project default
soul = "${name}.md"
active = true
readonly = ${role === 'readonly' ? 'true' : 'false'}${gender ? `\ngender = "${gender}"` : ''}

# [capabilities]
# can_review = true

# [tools]
# extra_allowed = []
# extra_denied = []

[scope]
packages = ["*"]

[budget]
max_tokens_per_heartbeat = 200000
max_tokens_per_day = 3000000
`;

const DEFAULT_SOUL = (name: string, role: string) => `# ${name} — ${role}

Describe this agent's mission, personality, tone, and project-specific rules here.
This text is injected verbatim into every heartbeat prompt.
`;

export async function agentNew(
  name: string,
  opts: { role?: string; gender?: string },
): Promise<void> {
  const projectPath = resolveProjectPath();
  const agentsDir = join(projectPath, '.hq', 'agents');
  await mkdir(agentsDir, { recursive: true });

  const role = opts.role ?? 'worker';
  const gender = opts.gender && ['female', 'male', 'neutral'].includes(opts.gender)
    ? opts.gender
    : undefined;
  const tomlPath = join(agentsDir, `${name}.toml`);
  const mdPath = join(agentsDir, `${name}.md`);
  if (await exists(tomlPath)) {
    console.error(`Agent "${name}" already exists.`);
    process.exit(1);
  }

  await writeFile(tomlPath, DEFAULT_TOML(name, role, gender), 'utf-8');
  await writeFile(mdPath, DEFAULT_SOUL(name, role), 'utf-8');

  // Register in agent_state so daemon sees it on next tick.
  const db = new Database(join(projectPath, '.hq', 'db.sqlite'));
  db.prepare(
    `INSERT OR IGNORE INTO agent_state (name, status, budget_reset_at) VALUES (?, 'paused', ?)`,
  ).run(name, tomorrowMidnight());
  db.close();

  console.log(`✓ Agent "${name}" created as ${role}`);
  console.log(`  Edit ${mdPath} to define its mission.`);
}

export async function agentList(): Promise<void> {
  const projectPath = resolveProjectPath();
  const dir = join(projectPath, '.hq', 'agents');
  const files = await readdir(dir).catch(() => []);
  const tomls = files.filter((f) => f.endsWith('.toml'));
  if (tomls.length === 0) {
    console.log('(no agents)');
    return;
  }
  const db = new Database(join(projectPath, '.hq', 'db.sqlite'));
  for (const f of tomls) {
    const name = f.slice(0, -'.toml'.length);
    const state = db
      .prepare(`SELECT status, last_heartbeat FROM agent_state WHERE name = ?`)
      .get(name) as { status: string; last_heartbeat: number | null } | undefined;
    const status = state?.status ?? 'unknown';
    const last = state?.last_heartbeat
      ? new Date(state.last_heartbeat).toISOString()
      : 'never';
    console.log(`  ${name.padEnd(20)} status=${status.padEnd(10)} last=${last}`);
  }
  db.close();
}

export async function agentArchive(name: string): Promise<void> {
  const projectPath = resolveProjectPath();
  const db = new Database(join(projectPath, '.hq', 'db.sqlite'));
  db.prepare(`UPDATE agent_state SET status = 'archived' WHERE name = ?`).run(name);
  db.close();
  console.log(`✓ Agent "${name}" archived (config preserved).`);
}

export async function agentRestore(name: string): Promise<void> {
  const projectPath = resolveProjectPath();
  const db = new Database(join(projectPath, '.hq', 'db.sqlite'));
  db.prepare(`UPDATE agent_state SET status = 'idle' WHERE name = ?`).run(name);
  db.close();
  console.log(`✓ Agent "${name}" restored.`);
}

/**
 * Pause an agent. Mirrors the UI endpoint in packages/ui/src/server.tsx:
 * accepts any state except `archived` and flips to `paused`. The scheduler
 * skips paused agents on every tick until resumed. If the agent is currently
 * `working`, the MCP's end_heartbeat will land on `paused` instead of `idle`
 * (runner.ts respects the existing status).
 */
export async function agentPause(name: string): Promise<void> {
  const projectPath = resolveProjectPath();
  const db = new Database(join(projectPath, '.hq', 'db.sqlite'));
  const row = db
    .prepare('SELECT status FROM agent_state WHERE name = ?')
    .get(name) as { status: string } | undefined;
  if (!row) {
    console.error(`Agent "${name}" not found.`);
    db.close();
    process.exit(1);
  }
  if (row.status === 'archived') {
    console.error(`Cannot pause "${name}": agent is archived. Use \`hq agent restore\` first.`);
    db.close();
    process.exit(1);
  }
  if (row.status === 'paused') {
    console.log(`Agent "${name}" is already paused.`);
    db.close();
    return;
  }
  db.prepare(`UPDATE agent_state SET status = 'paused' WHERE name = ?`).run(name);
  db.close();
  console.log(`✓ Agent "${name}" paused. The scheduler will skip it until resumed.`);
}

/**
 * Resume a paused agent. Allowed from `paused`, `paused_quota`, or `blocked`
 * (the UI endpoint supports the same transitions). Clears `blocked_reason`
 * on the way so a previously blocked agent doesn't get re-flagged stale.
 */
export async function agentResume(name: string): Promise<void> {
  const projectPath = resolveProjectPath();
  const db = new Database(join(projectPath, '.hq', 'db.sqlite'));
  const row = db
    .prepare('SELECT status FROM agent_state WHERE name = ?')
    .get(name) as { status: string } | undefined;
  if (!row) {
    console.error(`Agent "${name}" not found.`);
    db.close();
    process.exit(1);
  }
  if (row.status !== 'paused' && row.status !== 'paused_quota' && row.status !== 'blocked') {
    console.error(`Cannot resume "${name}": current status is "${row.status}", not paused.`);
    db.close();
    process.exit(1);
  }
  db.prepare(`UPDATE agent_state SET status = 'idle', blocked_reason = NULL WHERE name = ?`).run(
    name,
  );
  db.close();
  console.log(`✓ Agent "${name}" resumed → idle.`);
}

/**
 * Forcefully stop an agent: kill its tmux session, unclaim its in-progress
 * task, mark it idle. Useful when an agent is stuck and you want to restart
 * cleanly without waiting for the reaper. Respects the pause contract: if the
 * agent was paused or archived, we don't touch its status — we just kill the
 * tmux session.
 */
export async function agentStop(name: string): Promise<void> {
  const projectPath = resolveProjectPath();
  const project = await loadProjectConfig(join(projectPath, '.hq', 'project.toml'));
  const slug = project.project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const session = `hq-${slug}-${name}`;

  // Kill tmux first so no in-flight MCP call writes to DB after we clean up.
  await new Promise<void>((resolve) => {
    const proc = spawn('tmux', ['kill-session', '-t', session], { stdio: 'ignore' });
    proc.on('close', () => resolve());
    proc.on('error', () => resolve());
  });

  const db = openProjectDb(join(projectPath, '.hq', 'db.sqlite'));
  const state = db.select().from(agentState).where(eq(agentState.name, name)).get();
  if (!state) {
    console.error(`Agent "${name}" not found.`);
    process.exit(1);
  }

  db.transaction((tx) => {
    tx.update(tasksTable)
      .set({ status: 'todo', assignee: null, updatedAt: Date.now() })
      .where(and(eq(tasksTable.assignee, name), eq(tasksTable.status, 'in_progress')))
      .run();
    // Preserve paused/archived intent; only flip to idle from working.
    if (state.status === 'working') {
      tx.update(agentState)
        .set({ status: 'idle', tmuxSession: null, currentTaskId: null })
        .where(eq(agentState.name, name))
        .run();
    } else {
      tx.update(agentState)
        .set({ tmuxSession: null })
        .where(eq(agentState.name, name))
        .run();
    }
  });

  console.log(`✓ Agent "${name}" stopped. tmux session killed, task unclaimed.`);
}

export async function agentRun(name: string): Promise<void> {
  const projectPath = resolveProjectPath();
  const db = openProjectDb(join(projectPath, '.hq', 'db.sqlite'));
  console.log(`[hq] triggering heartbeat for ${name}...`);
  await triggerHeartbeat({ projectPath, agentName: name, db });
  console.log(`✓ Heartbeat dispatched. Attach with: hq agent attach ${name}`);
}

export async function agentAttach(name: string): Promise<void> {
  const projectPath = resolveProjectPath();
  const db = new Database(join(projectPath, '.hq', 'db.sqlite'));
  const row = db
    .prepare(`SELECT tmux_session FROM agent_state WHERE name = ?`)
    .get(name) as { tmux_session: string | null } | undefined;
  db.close();
  if (!row?.tmux_session) {
    console.error(`Agent "${name}" has no active tmux session.`);
    process.exit(1);
  }
  console.log(`Run: tmux attach -t ${row.tmux_session}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function tomorrowMidnight(): number {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}
