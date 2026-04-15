import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import type { ProjectConfig } from '@hq/core';

export async function isBwrapAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('which', ['bwrap'], { stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

/**
 * Build a single shell command string that launches Claude Code inside a
 * bubblewrap sandbox with `--dangerously-skip-permissions`.
 *
 * Isolation:
 *   - Whole FS read-only, except ~/.claude (credentials) and the agent worktree
 *   - Separate namespaces for IPC/PID/UTS/cgroup (but shared net for git/pnpm)
 *   - Dies with the parent tmux pane
 *
 * This returns a string because it is fed to `tmux send-keys` — i.e. the shell
 * inside the tmux pane executes it.
 */
export function buildClaudeLaunchCommand(
  worktree: string,
  cfg: ProjectConfig['sandbox'],
  bwrapAvailable: boolean,
): string {
  if (!cfg.enabled || !bwrapAvailable) {
    return `claude --dangerously-skip-permissions`;
  }
  const home = homedir();
  const parts: string[] = [
    'bwrap',
    '--unshare-user',
    '--unshare-ipc',
    '--unshare-pid',
    '--unshare-uts',
    '--unshare-cgroup',
    cfg.share_net ? '--share-net' : '--unshare-net',
    '--ro-bind', '/', '/',
    '--bind', worktree, worktree,
    '--bind', `${home}/.claude`, `${home}/.claude`,
    '--tmpfs', '/tmp',
    '--dev-bind', '/dev', '/dev',
    '--proc', '/proc',
    '--die-with-parent',
    '--chdir', worktree,
    '--setenv', 'HOME', home,
    '--setenv', 'TERM', 'xterm-256color',
  ];
  for (const p of cfg.extra_binds) {
    parts.push('--bind', p, p);
  }
  for (const p of cfg.extra_ro_binds) {
    parts.push('--ro-bind', p, p);
  }
  parts.push('--', 'claude', '--dangerously-skip-permissions');
  return parts.map(shellQuote).join(' ');
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-./:=@]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
