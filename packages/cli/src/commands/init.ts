import { mkdir, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { registerProject } from '../registry';
import { SCHEMA_DDL } from './schema-ddl';

const DEFAULT_PROJECT_TOML = (name: string) => `[project]
name = "${name}"
root = "."
default_model = "sonnet"
default_branch = "main"

[scheduler]
interval_minutes = 15
stagger_seconds = 60
max_concurrent_agents = 3
daily_token_budget = 0

[git]
branch_prefix = "agent/"
worktree_dir = ".hq/worktrees"

[kanban]
min_reviewers = 1
require_lint_before_review = true
require_typecheck_before_review = true

[heartbeat]
default_timeout_minutes = 15
max_session_hours = 4
retry_max = 2

[webhook]
discord_url = ""
discord_events = []

# Add goals and rules below. See DESIGN.md for examples.
goals = []
rules = []
`;

const DEFAULT_GITIGNORE = `db.sqlite
db.sqlite-journal
db.sqlite-wal
db.sqlite-shm
logs/
progress/
worktrees/
runtime/
`;

export async function initCommand(targetPath = process.cwd()): Promise<void> {
  const absolute = resolve(targetPath);
  const name = basename(absolute);
  const hqDir = `${absolute}/.hq`;

  if (await exists(hqDir)) {
    console.error(`.hq already exists at ${absolute}. Aborting.`);
    process.exit(1);
  }

  await mkdir(hqDir, { recursive: true });
  await mkdir(`${hqDir}/agents`, { recursive: true });
  await mkdir(`${hqDir}/hooks`, { recursive: true });
  await writeFile(`${hqDir}/project.toml`, DEFAULT_PROJECT_TOML(name), 'utf-8');
  await writeFile(`${hqDir}/.gitignore`, DEFAULT_GITIGNORE, 'utf-8');
  await writeFile(`${hqDir}/webhooks.toml`, '# [discord]\n# url = ""\n# events = []\n', 'utf-8');

  // Initialise DB so the schema exists from the start.
  const db = new Database(`${hqDir}/db.sqlite`, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA_DDL);
  db.close();

  registerProject(name, absolute);

  console.log(`✓ HQ initialised at ${hqDir}`);
  console.log(`  Project registered as "${name}" in ~/.hq/registry.sqlite`);
  console.log(`  Next: hq agent new <name> [--role worker]`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

