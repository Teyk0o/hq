import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { newId } from '@hq/core';
import { listProjects, registerProject, unregisterProject } from '../registry';
import { SCHEMA_DDL } from './schema-ddl';

function sh(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: 'ignore', cwd: opts.cwd });
    proc.on('close', (code) => resolve(code ?? 0));
    proc.on('error', () => resolve(-1));
  });
}

function log(line: string): void {
  console.log(`  ${line}`);
}

export interface DebugResetOpts {
  all?: boolean;
  keepRegistry?: boolean;
}

export async function debugReset(opts: DebugResetOpts): Promise<void> {
  console.log('▸ Resetting HQ state...');

  // 1. Kill all hq-* tmux sessions.
  const sessions = await listTmuxSessions();
  for (const s of sessions.filter((n) => n.startsWith('hq-'))) {
    await sh('tmux', ['kill-session', '-t', s]);
    log(`killed tmux session ${s}`);
  }

  // 2. For each registered project, prune worktrees/branches, clear logs + runtime + db, unregister.
  const projects = listProjects();
  for (const p of projects) {
    log(`project ${p.name} @ ${p.path}`);
    // Remove git worktrees and agent branches.
    const worktreesDir = join(p.path, '.hq', 'worktrees');
    const isGitRepo = await sh('git', ['rev-parse', '--git-dir'], { cwd: p.path }).then((c) => c === 0);
    if (isGitRepo) {
      // List worktrees we registered and remove each.
      await sh('bash', ['-c', `git -C '${p.path}' worktree list --porcelain | awk '/^worktree/{print $2}' | grep -F '${worktreesDir}' | xargs -r -I{} git -C '${p.path}' worktree remove --force {}`]);
      await sh('git', ['-C', p.path, 'worktree', 'prune']);
      // Remove agent/* branches.
      await sh('bash', ['-c', `git -C '${p.path}' for-each-ref --format='%(refname:short)' refs/heads/agent/ | xargs -r git -C '${p.path}' branch -D`]);
    }
    // Wipe runtime dirs + reinitialise DB.
    await rm(join(p.path, '.hq', 'worktrees'), { recursive: true, force: true });
    await rm(join(p.path, '.hq', 'logs'), { recursive: true, force: true });
    await rm(join(p.path, '.hq', 'progress'), { recursive: true, force: true });
    await rm(join(p.path, '.hq', 'runtime'), { recursive: true, force: true });
    await rm(join(p.path, '.hq', 'db.sqlite'), { force: true });
    await rm(join(p.path, '.hq', 'db.sqlite-journal'), { force: true });
    await rm(join(p.path, '.hq', 'db.sqlite-wal'), { force: true });
    await rm(join(p.path, '.hq', 'db.sqlite-shm'), { force: true });
    // Rebuild a fresh DB with the schema so CLI commands keep working.
    const db = new Database(join(p.path, '.hq', 'db.sqlite'), { create: true });
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(SCHEMA_DDL);
    db.close();
    log(`  cleaned runtime + reinitialised DB`);

    if (opts.all) {
      unregisterProject(p.name);
      log(`  unregistered`);
    }
  }

  // 3. When --all is passed and --keep-registry is not, also wipe the usage cache.
  if (opts.all && !opts.keepRegistry) {
    await rm(join(homedir(), '.hq', 'usage-cache.json'), { force: true });
    log('wiped ~/.hq/usage-cache.json');
  }

  console.log('✓ Reset done.');
}

export interface DebugTestOpts {
  path?: string;
  agent?: string;
  role?: string;
  task?: string;
  soul?: string;
  noRun?: boolean;
}

export async function debugTest(opts: DebugTestOpts): Promise<void> {
  const path = opts.path ?? `/tmp/hq-test-${newId().slice(0, 6)}`;
  const agent = opts.agent ?? 'alice';
  const role = opts.role ?? 'worker';
  const task = opts.task ?? 'Create hello.txt with a friendly greeting';
  const soul =
    opts.soul ??
    `# ${agent} — ${role}

You work on a small test project. Your job: pick a todo task, do it, commit
the result, submit for review. Use Read, Write, Edit, and Bash (git only).

IMPORTANT order per heartbeat:
  1. mcp__hq__start_heartbeat
  2. mcp__hq__list_tasks(status="todo")
  3. mcp__hq__claim_task
  4. Do the work + git commit on your agent branch
  5. mcp__hq__submit_for_review
  6. mcp__hq__update_progress
  7. mcp__hq__end_heartbeat (LAST)
`;

  console.log(`▸ Creating fresh project at ${path}`);
  await mkdir(path, { recursive: true });
  await sh('git', ['init', '-q'], { cwd: path });
  await sh('git', ['commit', '--allow-empty', '-m', 'init', '-q'], { cwd: path });

  // Inline init (avoid shelling out to `hq init` when we can reuse the logic).
  const { initCommand } = await import('./init');
  process.chdir(path);
  try {
    await initCommand(path);
  } catch (err) {
    // If .hq already exists from a previous partial run, rewrite config to be consistent.
    console.warn(`[debug:test] init said: ${(err as Error).message}`);
  }

  const { agentNew } = await import('./agent');
  await agentNew(agent, { role });
  await writeFile(join(path, '.hq', 'agents', `${agent}.md`), soul, 'utf-8');

  const { taskAdd } = await import('./task');
  await taskAdd(task, {});

  console.log('');
  console.log(`  path:    ${path}`);
  console.log(`  agent:   ${agent} (${role})`);
  console.log(`  task:    "${task}"`);
  console.log('');

  // Ensure the project is registered (init does it, but harmless to re-run).
  const name = path.split('/').pop()!;
  registerProject(name, path);

  if (opts.noRun) {
    console.log(`✓ Project ready. Trigger with: hq agent run ${agent}`);
    return;
  }

  const { agentRun } = await import('./agent');
  await agentRun(agent);
  console.log('');
  console.log(`  Attach live: tmux attach -t hq-${slugify(name)}-${agent}`);
  console.log(`  Dashboard:   http://127.0.0.1:7433  (start via: hq daemon start)`);
}

async function listTmuxSessions(): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = spawn('tmux', ['ls', '-F', '#{session_name}'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout?.on('data', (d) => (out += d.toString()));
    proc.on('error', () => resolve([]));
    proc.on('close', () => resolve(out.split('\n').filter(Boolean)));
  });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
