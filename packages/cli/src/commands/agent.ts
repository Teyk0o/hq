import { mkdir, writeFile, access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { openProjectDb } from '@hq/core';
import { triggerHeartbeat } from '@hq/daemon';
import { resolveProjectPath } from '../util';

const DEFAULT_TOML = (name: string, role: string) => `[agent]
name = "${name}"
role = "${role}"
# model = "sonnet"  # uncomment to override project default
soul = "${name}.md"
active = true
readonly = ${role === 'readonly' ? 'true' : 'false'}

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

export async function agentNew(name: string, opts: { role?: string }): Promise<void> {
  const projectPath = resolveProjectPath();
  const agentsDir = join(projectPath, '.hq', 'agents');
  await mkdir(agentsDir, { recursive: true });

  const role = opts.role ?? 'worker';
  const tomlPath = join(agentsDir, `${name}.toml`);
  const mdPath = join(agentsDir, `${name}.md`);
  if (await exists(tomlPath)) {
    console.error(`Agent "${name}" already exists.`);
    process.exit(1);
  }

  await writeFile(tomlPath, DEFAULT_TOML(name, role), 'utf-8');
  await writeFile(mdPath, DEFAULT_SOUL(name, role), 'utf-8');

  // Register in agent_state so daemon sees it on next tick.
  const db = new Database(join(projectPath, '.hq', 'db.sqlite'));
  db.prepare(
    `INSERT OR IGNORE INTO agent_state (name, status, budget_reset_at) VALUES (?, 'idle', ?)`,
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
