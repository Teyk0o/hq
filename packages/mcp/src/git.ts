/**
 * Tiny git-CLI wrapper used by MCP tools to verify the worktree state when
 * an agent claims/submits a task. Relies on Bun.spawnSync for synchronous
 * execution — MCP handlers are already async-boundary wrapped, we don't want
 * to add another layer of Promise juggling per git invocation.
 */
export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function git(cwd: string, ...args: string[]): GitResult {
  const proc = Bun.spawnSync(['git', '-C', cwd, ...args]);
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    code: proc.exitCode ?? 0,
  };
}

/** Returns the current branch name, or null when detached / not a git repo. */
export function currentBranch(cwd: string): string | null {
  const r = git(cwd, 'symbolic-ref', '--short', 'HEAD');
  if (r.code !== 0) return null;
  return r.stdout.trim() || null;
}

/** True if `branch` exists locally. */
export function branchExists(cwd: string, branch: string): boolean {
  return git(cwd, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).code === 0;
}

/** Number of commits `branch` has ahead of `base`. Returns 0 if either ref is missing. */
export function commitsAhead(cwd: string, branch: string, base: string): number {
  const r = git(cwd, 'rev-list', '--count', `${base}..${branch}`);
  if (r.code !== 0) return 0;
  const n = Number.parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Best-effort remote URL for a remote. */
export function remoteUrl(cwd: string, remote = 'origin'): string | null {
  const r = git(cwd, 'remote', 'get-url', remote);
  return r.code === 0 ? r.stdout.trim() : null;
}
