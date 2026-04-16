import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { newId, openProjectDb } from '@hq/core';
import { listProjects, registerProject, unregisterProject } from '../registry';

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
    openProjectDb(join(p.path, '.hq', 'db.sqlite'));
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
  agents?: string;
  tasks?: string;
  interval?: string;
  reset?: boolean;
  noRun?: boolean;
}

const DEFAULT_TASKS = [
  'Create hello.txt with a friendly greeting to the HQ team',
  'Add a README.md describing this test project in one paragraph',
  'Create a haiku.txt file containing an original haiku about autonomous agents',
  'Write notes/ideas.md with three feature ideas for a kanban tool',
  'Add a LICENSE file with the MIT license text',
  'Create scripts/hello.sh that echoes "Hello from HQ" and make it executable',
  'Write CHANGELOG.md with a single entry for v0.1',
  'Create docs/overview.md explaining what the project does in 5 bullets',
];

const SOUL_TEMPLATES: Record<string, (name: string) => string> = {
  worker: (name) => `# ${name} — worker

You work on a small test project. Your job: pick a todo task, do it, commit
the result, submit for review. Use Read, Write, Edit, and Bash (git only).

Heartbeat order (strict):
  1. mcp__hq__start_heartbeat
  2. mcp__hq__list_tasks(status="todo", assignee=null)
  3. mcp__hq__claim_task on the first one you can do
  4. Do the work in the current working directory
  5. git add . && git commit -m "<short message>"
  6. mcp__hq__submit_for_review with a one-line summary
  7. mcp__hq__update_progress (short note on what you did)
  8. mcp__hq__end_heartbeat (ALWAYS last)
`,
  reviewer: (name) => `# ${name} — reviewer

You review other agents' work. You cannot claim tasks yourself. Be honest:
look for missing requirements, sloppy commits, and code that won't work.

Heartbeat order:
  1. mcp__hq__start_heartbeat
  2. mcp__hq__list_tasks(status="peer_review")
  3. For each task where you are NOT the assignee:
     - Read the diff (git log, git show on the agent branch)
     - Call mcp__hq__submit_review with verdict "approved" or
       "changes_requested" (the latter requires a non-empty body)
  4. mcp__hq__update_progress (what you reviewed)
  5. mcp__hq__end_heartbeat (ALWAYS last)
`,
  boss: (name) => `# ${name} — boss

You plan the work. You cannot claim tasks but you can create and promote them.
You are trusted to keep the backlog flowing from the active goals.

Heartbeat order:
  1. mcp__hq__start_heartbeat
  2. Check the "Active goals" section in this prompt for targets under quota
  3. For each goal below target this week: mcp__hq__create_task, then
     mcp__hq__promote_task to move it from backlog to todo
  4. mcp__hq__list_tasks(status="peer_review") and submit_review where you
     are eligible (goals overlap, not the author)
  5. mcp__hq__update_progress
  6. mcp__hq__end_heartbeat (ALWAYS last)
`,
  readonly: (name) => `# ${name} — read-only

You are a read-only auditor. You can list tasks, read them, and comment via
add_comment. You cannot claim, review, or modify files.

Heartbeat order:
  1. mcp__hq__start_heartbeat
  2. mcp__hq__list_tasks + observe
  3. mcp__hq__add_comment on tasks where your observation adds value
  4. mcp__hq__update_progress
  5. mcp__hq__end_heartbeat (ALWAYS last)
`,
};

interface AgentSpec {
  name: string;
  role: string;
  gender?: 'female' | 'male' | 'neutral';
}

function parseAgentsSpec(spec: string): AgentSpec[] {
  // Name-based gender heuristics for the default demo roster so the avatars
  // feel coherent out of the box. Not a real inference layer — only used when
  // the spec doesn't carry an explicit gender.
  const GENDER_HINTS: Record<string, 'female' | 'male' | 'neutral'> = {
    alice: 'female', arya: 'female', daenerys: 'female', sansa: 'female',
    morgane: 'female', claire: 'female', sofia: 'female', inès: 'female', ines: 'female',
    bob: 'male', jon: 'male', tyrion: 'male', varys: 'male', sandor: 'male',
    lucas: 'male', karim: 'male', thomas: 'male',
  };
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry): AgentSpec => {
      const parts = entry.split(':').map((s) => s.trim());
      const [name, role = 'worker', explicitGender] = parts;
      const gender =
        explicitGender && ['female', 'male', 'neutral'].includes(explicitGender)
          ? (explicitGender as 'female' | 'male' | 'neutral')
          : GENDER_HINTS[name!.toLowerCase()];
      return gender ? { name: name!, role, gender } : { name: name!, role };
    });
}

export async function debugTest(opts: DebugTestOpts): Promise<void> {
  if (opts.reset) {
    await debugReset({ all: true });
    console.log('');
  }

  const path = opts.path ?? `/tmp/hq-test-${newId().slice(0, 6)}`;
  const agentSpecs = parseAgentsSpec(opts.agents ?? 'alice:worker,bob:reviewer');
  const taskCount = opts.tasks ? Math.max(1, Number.parseInt(opts.tasks, 10)) : 3;
  const interval = opts.interval ? Number.parseInt(opts.interval, 10) : undefined;

  console.log(`▸ Creating fresh project at ${path}`);
  await mkdir(path, { recursive: true });
  await sh('git', ['init', '-q'], { cwd: path });
  await sh('git', ['config', 'user.email', 'hq-agents@local'], { cwd: path });
  await sh('git', ['config', 'user.name', 'HQ Agents'], { cwd: path });
  await sh('git', ['commit', '--allow-empty', '-m', 'init', '-q'], { cwd: path });

  const { initCommand } = await import('./init');
  process.chdir(path);
  try {
    await initCommand(path);
  } catch (err) {
    console.warn(`[debug:test] init said: ${(err as Error).message}`);
  }

  // Optionally tune the scheduler interval so we see ticks sooner during testing.
  if (interval && interval > 0) {
    const tomlPath = join(path, '.hq', 'project.toml');
    const raw = await (await import('node:fs/promises')).readFile(tomlPath, 'utf-8');
    const patched = raw.replace(
      /^interval_minutes\s*=.*$/m,
      `interval_minutes = ${interval}`,
    );
    await (await import('node:fs/promises')).writeFile(tomlPath, patched, 'utf-8');
  }

  const { agentNew } = await import('./agent');
  for (const spec of agentSpecs) {
    await agentNew(spec.name, spec.gender ? { role: spec.role, gender: spec.gender } : { role: spec.role });
    const soulBuilder = SOUL_TEMPLATES[spec.role] ?? SOUL_TEMPLATES.worker!;
    await writeFile(
      join(path, '.hq', 'agents', `${spec.name}.md`),
      soulBuilder(spec.name),
      'utf-8',
    );
  }

  const { taskAdd } = await import('./task');
  const chosenTasks = DEFAULT_TASKS.slice(0, Math.min(taskCount, DEFAULT_TASKS.length));
  // If the user asked for more than the pool, cycle through with a suffix.
  while (chosenTasks.length < taskCount) {
    const base = DEFAULT_TASKS[chosenTasks.length % DEFAULT_TASKS.length]!;
    chosenTasks.push(`${base} (variant ${Math.ceil(chosenTasks.length / DEFAULT_TASKS.length) + 1})`);
  }
  const priorities = [1, 2, 3, 3, 4];
  for (let i = 0; i < chosenTasks.length; i += 1) {
    await taskAdd(chosenTasks[i]!, {
      priority: String(priorities[i % priorities.length]),
    });
  }

  const name = path.split('/').pop()!;
  registerProject(name, path);

  console.log('');
  console.log(`  path:     ${path}`);
  console.log(`  agents:   ${agentSpecs.map((a) => `${a.name}(${a.role})`).join(', ')}`);
  console.log(`  tasks:    ${chosenTasks.length}`);
  if (interval) console.log(`  interval: ${interval} min`);
  console.log('');

  if (opts.noRun) {
    console.log(`✓ Project ready.`);
    console.log(`  Next: hq daemon start     # autonomous`);
    console.log(`  Or:   hq agent run <name> # manual trigger`);
    return;
  }

  // Kick things off by triggering the first worker manually so the user gets
  // an immediate signal; the scheduler will take over on subsequent ticks.
  const firstWorker = agentSpecs.find((a) => a.role === 'worker');
  if (firstWorker) {
    const { agentRun } = await import('./agent');
    await agentRun(firstWorker.name);
    console.log('');
    console.log(`  Attach:    tmux attach -t hq-${slugify(name)}-${firstWorker.name}`);
  }
  console.log(`  Dashboard: http://127.0.0.1:7433  (start via: hq daemon start)`);
  console.log(`  Autonomy:  hq daemon start  (scheduler will fire every ${interval ?? 15} min)`);
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
