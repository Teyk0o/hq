#!/usr/bin/env bun
import { Command } from 'commander';
import {
  agentArchive,
  agentAttach,
  agentList,
  agentNew,
  agentRestore,
  agentRun,
  agentStop,
} from './commands/agent';
import { bashGateCommand } from './commands/bash-gate';
import { rulesGateCommand } from './commands/rules-gate';
import { debugReset, debugTest } from './commands/debug';
import { daemonInstallService, daemonStart, daemonStatus } from './commands/daemon';
import { initCommand } from './commands/init';
import { mcpCommand } from './commands/mcp';
import { taskAdd, taskList, taskShow, taskUnblock } from './commands/task';
import { usageCommand } from './commands/usage';
import { listProjects, unregisterProject } from './registry';

const program = new Command();
program
  .name('hq')
  .description('HeadQuarter — a local command center for autonomous Claude Code teams')
  .version('0.1.0');

program
  .command('init [path]')
  .description('Initialise HQ in a project directory')
  .action(async (path?: string) => initCommand(path));

program.command('list').description('List registered projects').action(() => {
  const projects = listProjects();
  if (projects.length === 0) {
    console.log('(no projects registered)');
    return;
  }
  for (const p of projects) console.log(`  ${p.name.padEnd(20)} ${p.path}`);
});

program
  .command('unregister <name>')
  .description('Remove a project from the registry (files untouched)')
  .action((name: string) => {
    unregisterProject(name);
    console.log(`✓ Unregistered ${name}`);
  });

// Agent subcommands
const agent = program.command('agent').description('Manage agents for the current project');
agent
  .command('new <name>')
  .description('Scaffold a new agent (TOML + SOUL.md)')
  .option('-r, --role <role>', 'role (boss|worker|reviewer|readonly)', 'worker')
  .option('-g, --gender <gender>', 'presentation hint for avatar (female|male|neutral)')
  .action(async (name: string, opts: { role?: string; gender?: string }) => agentNew(name, opts));
agent.command('list').description('List agents and their status').action(agentList);
agent.command('archive <name>').description('Soft-delete an agent').action(agentArchive);
agent.command('restore <name>').description('Restore an archived agent').action(agentRestore);
agent
  .command('run <name>')
  .description('Trigger a heartbeat immediately (manual)')
  .action(agentRun);
agent
  .command('stop <name>')
  .description('Kill the agent tmux session and unclaim its in-progress task')
  .action(agentStop);
agent
  .command('attach <name>')
  .description('Print the tmux attach command for this agent')
  .action(agentAttach);

// Task subcommands
const task = program.command('task').description('Manage tasks');
task
  .command('add <title>')
  .description('Add a task')
  .option('-g, --goal <id>')
  .option('-a, --assignee <name>')
  .option('-p, --priority <n>')
  .option('--package <name>')
  .option('--status <s>', 'initial status (default: todo)')
  .action(async (title: string, opts) => taskAdd(title, opts));
task
  .command('list')
  .description('List tasks')
  .option('-s, --status <s>')
  .option('-a, --assignee <name>')
  .action(async (opts) => taskList(opts));
task.command('show <id>').description('Show a task in detail').action(taskShow);
task
  .command('unblock <id>')
  .description('Unblock a task')
  .option('--to <state>', 'target state (default: todo)')
  .action(async (id: string, opts) => taskUnblock(id, opts));

// Daemon subcommands
const daemon = program.command('daemon').description('Manage the HQ daemon');
daemon.command('start').description('Run the scheduler in foreground').action(daemonStart);
daemon
  .command('install-service')
  .description('Write a systemd user unit for the daemon')
  .action(daemonInstallService);
daemon
  .command('status')
  .description('Show systemd --user status for the hq service')
  .action(daemonStatus);

// Usage
program
  .command('usage')
  .description('Show Claude Max quota usage')
  .option('--refresh', 'force refresh the cache')
  .action(async (opts) => usageCommand(opts));

// MCP (internal, invoked by agents via .mcp.json)
program
  .command('mcp')
  .description('Start the HQ MCP server (used by agents)')
  .requiredOption('--project <path>')
  .requiredOption('--agent <name>')
  .action(async (opts: { project: string; agent: string }) => mcpCommand(opts));

// Debug helpers
const debug = program.command('debug').description('Debug helpers for development');
debug
  .command('reset')
  .description('Kill tmux sessions, prune worktrees/branches, wipe runtime state')
  .option('--all', 'also unregister projects and wipe usage cache')
  .action(async (opts: { all?: boolean }) => debugReset(opts));
debug
  .command('test')
  .description('Scaffold a fresh project with a whole team of agents and several tasks, then fire a first heartbeat')
  .option('--path <path>', 'override project path (default: /tmp/hq-test-<rand>)')
  .option(
    '--agents <spec>',
    'comma-separated agents, each "name:role" (default: alice:worker,bob:reviewer). Roles: worker|reviewer|boss|readonly',
  )
  .option('--tasks <n>', 'number of tasks to seed (default: 3)')
  .option('--interval <minutes>', 'override scheduler.interval_minutes in project.toml (useful: 1 or 2 for smoke tests)')
  .option('--reset', 'run `hq debug reset --all` before scaffolding')
  .option('--no-run', 'scaffold without triggering a heartbeat')
  .action(async (opts) => debugTest(opts));

// Bash gate (internal, invoked by Claude Code PreToolUse hook)
program
  .command('bash-gate')
  .description('Validate a Bash tool call against the project whitelist (hook usage)')
  .requiredOption('--project <path>')
  .requiredOption('--agent <name>')
  .action(async (opts: { project: string; agent: string }) => bashGateCommand(opts));

// Rules gate (internal, invoked by Claude Code PreToolUse hook on Edit/Write/MultiEdit)
program
  .command('rules-gate')
  .description('Evaluate project [[rules]] against a file-editing tool call (hook usage)')
  .requiredOption('--project <path>')
  .requiredOption('--agent <name>')
  .action(async (opts: { project: string; agent: string }) => rulesGateCommand(opts));

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
