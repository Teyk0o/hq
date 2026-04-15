import { writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadGlobalConfig } from '@hq/core';
import {
  QuotaPoller,
  Scheduler,
  installEventTriggers,
  reapOrphanedTmuxSessions,
} from '@hq/daemon';
import { getSharedBus } from '@hq/mcp';
import { startUi } from '@hq/ui';
import { listProjects } from '../registry';

export async function daemonStart(): Promise<void> {
  const projects = listProjects().map((p) => ({ name: p.name, path: p.path }));
  if (projects.length === 0) {
    console.error('No projects registered. Run `hq init` in a project directory first.');
    process.exit(1);
  }

  const global = await loadGlobalConfig(join(homedir(), '.hq', 'config.toml'));
  const bus = getSharedBus();

  // Clean up any tmux sessions orphaned by a previous daemon run before we
  // start scheduling new ticks.
  try {
    const reap = await reapOrphanedTmuxSessions(projects);
    if (reap.killed.length > 0) {
      console.log(`[reaper] killed ${reap.killed.length} orphaned tmux session(s): ${reap.killed.join(', ')}`);
    }
    if (reap.kept.length > 0) {
      console.log(`[reaper] kept ${reap.kept.length} session(s): ${reap.kept.join(', ')}`);
    }
  } catch (err) {
    console.warn('[reaper] failed:', (err as Error).message);
  }

  const scheduler = new Scheduler();
  const quotaPoller = new QuotaPoller(global.claude_usage, (snap) => {
    console.log(
      `[quota] session=${snap.session_pct}% week=${snap.week_all_pct}% sonnet=${snap.week_sonnet_pct}%`,
    );
    bus.publish({
      type: 'claude.usage_updated',
      session_pct: snap.session_pct,
      week_all_pct: snap.week_all_pct,
      week_sonnet_pct: snap.week_sonnet_pct,
    });
  });

  await quotaPoller.start();
  await scheduler.start({
    projects,
    isQuotaPaused: () => quotaPoller.isPaused(),
  });

  // Event-driven: wake an idle reviewer the moment a task hits peer_review,
  // instead of waiting for the next scheduler tick.
  installEventTriggers(bus, projects);

  const projectMap = Object.fromEntries(projects.map((p) => [p.name, p.path]));
  await startUi({
    host: global.daemon.ui_host,
    port: global.daemon.ui_port,
    projects: projectMap,
    defaultProject: projects[0]!.name,
  });

  console.log(`[daemon] started with ${projects.length} project(s)`);

  const shutdown = () => {
    console.log('\n[daemon] shutting down...');
    scheduler.stop();
    quotaPoller.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export async function daemonInstallService(): Promise<void> {
  const unitPath = join(homedir(), '.config', 'systemd', 'user', 'hq.service');
  const bin = join(homedir(), '.local', 'bin', 'hq');
  const unit = `[Unit]
Description=HQ agent orchestration daemon
After=network.target

[Service]
Type=simple
ExecStart=${bin} daemon start
Restart=on-failure
RestartSec=5
StandardOutput=append:%h/.hq/daemon.log
StandardError=append:%h/.hq/daemon.log
Environment=TERM=xterm-256color

[Install]
WantedBy=default.target
`;
  await mkdir(join(homedir(), '.config', 'systemd', 'user'), { recursive: true });
  await writeFile(unitPath, unit, 'utf-8');
  console.log(`✓ systemd unit written to ${unitPath}`);
  console.log(`  Activate with:`);
  console.log(`    systemctl --user daemon-reload`);
  console.log(`    systemctl --user enable --now hq`);
}
