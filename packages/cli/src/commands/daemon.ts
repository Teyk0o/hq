import { writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadGlobalConfig, loadProjectConfig } from '@hq/core';
import {
  QuotaPoller,
  Scheduler,
  installDailyBackup,
  installDailyDigest,
  installEventTriggers,
  installProjectWebhooks,
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

  // Track quota pause state changes so we emit daemon.quota_paused and
  // daemon.quota_resumed only on actual transitions (not on every tick that
  // happens to be above threshold).

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
  const quotaPoller = new QuotaPoller(
    global.claude_usage,
    (snap) => {
      console.log(
        `[quota] session=${snap.session_pct}% week=${snap.week_all_pct}% sonnet=${snap.week_sonnet_pct}%`,
      );
      bus.publish({
        type: 'claude.usage_updated',
        session_pct: snap.session_pct,
        week_all_pct: snap.week_all_pct,
        week_sonnet_pct: snap.week_sonnet_pct,
      });
    },
    (change) => {
      if (change.kind === 'paused') {
        console.warn(
          `[quota] pausing agents: ${change.reason} usage at ${change.pct}%`,
        );
        bus.publish({ type: 'daemon.quota_paused', week_all_pct: change.pct });
      } else {
        console.log('[quota] resuming agents: quota back below threshold');
        bus.publish({ type: 'daemon.quota_resumed' });
      }
    },
  );

  await quotaPoller.start();
  await scheduler.start({
    projects,
    isQuotaPaused: () => quotaPoller.isPaused(),
  });

  // Event-driven: wake an idle reviewer the moment a task hits peer_review,
  // instead of waiting for the next scheduler tick.
  installEventTriggers(bus, projects);

  // Discord webhooks: post an embed on every configured event type per project.
  const webhookConfigs: Array<{ name: string; config: Awaited<ReturnType<typeof loadProjectConfig>> }> = [];
  for (const p of projects) {
    try {
      const cfg = await loadProjectConfig(join(p.path, '.hq', 'project.toml'));
      webhookConfigs.push({ name: p.name, config: cfg });
    } catch {
      // skip — project already logged elsewhere if broken
    }
  }
  installProjectWebhooks(bus, webhookConfigs);

  // 21:00 local: summarise each project's day in a Discord embed.
  installDailyDigest({
    projects: webhookConfigs.map(({ name, config }) => {
      const p = projects.find((x) => x.name === name)!;
      return { name, path: p.path, discordUrl: config.webhook.discord_url };
    }),
  });

  // Daily SQLite snapshots of registry + every project DB under ~/.hq/backups.
  installDailyBackup({ projects });

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
  // Resolve the hq binary path from the current PATH so the unit points at
  // wherever bun link (or an eventual compiled binary) landed it, instead of
  // hard-coding ~/.local/bin/hq which is only one of several plausible spots.
  const { spawn } = await import('node:child_process');
  const which = await new Promise<string>((resolve) => {
    const proc = spawn('which', ['hq'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.on('close', () => resolve(out.trim()));
    proc.on('error', () => resolve(''));
  });
  const bin = which || join(homedir(), '.local', 'bin', 'hq');

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
  await mkdir(join(homedir(), '.hq'), { recursive: true });
  await writeFile(unitPath, unit, 'utf-8');
  console.log(`✓ systemd unit written to ${unitPath}`);
  console.log(`  ExecStart = ${bin} daemon start`);
  console.log(`  Logs → ~/.hq/daemon.log`);
  console.log('');
  console.log('  Activate with:');
  console.log('    systemctl --user daemon-reload');
  console.log('    systemctl --user enable --now hq');
  console.log('');
  console.log('  Then check with:   hq daemon status');
}

export async function daemonStatus(): Promise<void> {
  const { spawn } = await import('node:child_process');
  const run = (args: string[]) =>
    new Promise<{ code: number; out: string }>((resolve) => {
      const proc = spawn('systemctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      proc.stdout.on('data', (d) => (out += d.toString()));
      proc.stderr.on('data', (d) => (out += d.toString()));
      proc.on('close', (code) => resolve({ code: code ?? 0, out }));
      proc.on('error', () => resolve({ code: -1, out: 'systemctl not available' }));
    });

  const active = await run(['--user', 'is-active', 'hq']);
  const enabled = await run(['--user', 'is-enabled', 'hq']);
  const status = await run(['--user', '--no-pager', 'status', 'hq']);
  console.log(`active:  ${active.out.trim()}`);
  console.log(`enabled: ${enabled.out.trim()}`);
  console.log('');
  console.log(status.out);
  if (active.code !== 0) {
    console.log('  If not installed yet, run:   hq daemon install-service');
  }
}
