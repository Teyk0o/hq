#!/usr/bin/env bun
import { Command } from 'commander';
import {
  agentArchive,
  agentAttach,
  agentList,
  agentNew,
  agentRestore,
  agentRun,
} from './commands/agent';
import { daemonInstallService, daemonStart } from './commands/daemon';
import { initCommand } from './commands/init';
import { mcpCommand } from './commands/mcp';
import { taskAdd, taskList, taskShow, taskUnblock } from './commands/task';
import { usageCommand } from './commands/usage';
import { listProjects, unregisterProject } from './registry';

const program = new Command();
program.name('hq').description('Autonomous agent teams orchestrator').version('0.1.0');

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
  .action(async (name: string, opts: { role?: string }) => agentNew(name, opts));
agent.command('list').description('List agents and their status').action(agentList);
agent.command('archive <name>').description('Soft-delete an agent').action(agentArchive);
agent.command('restore <name>').description('Restore an archived agent').action(agentRestore);
agent
  .command('run <name>')
  .description('Trigger a heartbeat immediately (manual)')
  .action(agentRun);
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

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
