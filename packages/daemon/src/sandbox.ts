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
 *   - Whole FS read-only, except ~/.claude (credentials), ~/.claude.json,
 *     the project root (for .hq/project.toml + db.sqlite + agent configs,
 *     which the MCP server reads/writes), and the agent worktree inside it.
 *   - Separate namespaces for IPC/PID/UTS/cgroup (but shared net for git/pnpm)
 *   - Dies with the parent tmux pane
 *
 * Returns a shell command string because it is dispatched to tmux as the
 * pane's root command.
 */
export function buildClaudeLaunchCommand(
  worktree: string,
  cfg: ProjectConfig['sandbox'],
  bwrapAvailable: boolean,
  projectRoot: string,
): string {
  if (!cfg.enabled || !bwrapAvailable) {
    return `claude --dangerously-skip-permissions`;
  }
  const home = homedir();
  // Mount order matters: --tmpfs wipes whatever was mounted there before.
  // We declare the top-level layout first (ro-bind / /, tmpfs /tmp) then overlay
  // writable binds on top. bwrap creates the intermediate directories on the
  // tmpfs when a bind destination points inside it.
  const parts: string[] = [
    'bwrap',
    '--unshare-user',
    '--unshare-ipc',
    '--unshare-pid',
    '--unshare-uts',
    '--unshare-cgroup',
    cfg.share_net ? '--share-net' : '--unshare-net',
    '--ro-bind', '/', '/',
    '--tmpfs', '/tmp',
    '--dev-bind', '/dev', '/dev',
    '--proc', '/proc',
    // Bind the project root (includes .hq/project.toml, .hq/db.sqlite, .hq/agents/)
    // so the MCP server can read config and mutate the kanban from inside the sandbox.
    // The worktree is a subdir of projectRoot so a single bind covers both.
    '--bind', projectRoot, projectRoot,
    '--bind', `${home}/.claude`, `${home}/.claude`,
    // ~/.claude.json is a sibling file (not inside ~/.claude/). Claude Code writes
    // to it to persist trust/onboarding state; without a writable bind, the TUI
    // hangs silently on its first write attempt.
    '--bind-try', `${home}/.claude.json`, `${home}/.claude.json`,
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
