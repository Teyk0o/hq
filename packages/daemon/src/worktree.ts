import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

async function run(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a working directory for the agent exists. Prefers a proper git worktree
 * on branch `agent/<name>`; falls back to a plain directory if the project is not
 * a git repo or has no commits yet. Also writes the `.mcp.json` so Claude Code
 * inside tmux can reach the HQ MCP server.
 */
export async function ensureWorktree(args: {
  projectPath: string;
  worktreePath: string;
  agentName: string;
  branchPrefix: string;
}): Promise<{ isGitWorktree: boolean }> {
  const { projectPath, worktreePath, agentName, branchPrefix } = args;
  await mkdir(worktreePath, { recursive: true });

  let isGitWorktree = false;
  const isGitRepo = await pathExists(join(projectPath, '.git'));
  const alreadyHasGit = await pathExists(join(worktreePath, '.git'));

  if (isGitRepo && !alreadyHasGit) {
    const branch = `${branchPrefix}${agentName}`;
    // Check if branch exists; if not create, else reuse.
    const branchExists = (await run('git', ['rev-parse', '--verify', branch], projectPath)).code === 0;
    const worktreeArgs = branchExists
      ? ['worktree', 'add', worktreePath, branch]
      : ['worktree', 'add', '-b', branch, worktreePath];
    const result = await run('git', worktreeArgs, projectPath);
    if (result.code === 0) {
      isGitWorktree = true;
    } else {
      // Common failure: repo has no commits yet. Fall back silently.
      console.warn(`[worktree] git worktree add failed for ${agentName}: ${result.stderr.trim()}`);
    }
  } else if (alreadyHasGit) {
    isGitWorktree = true;
  }

  await writeMcpConfig(worktreePath, projectPath, agentName);
  return { isGitWorktree };
}

async function writeMcpConfig(
  worktreePath: string,
  projectPath: string,
  agentName: string,
): Promise<void> {
  const mcpConfig = {
    mcpServers: {
      hq: {
        command: 'hq',
        args: ['mcp', '--project', projectPath, '--agent', agentName],
      },
    },
  };
  await writeFile(join(worktreePath, '.mcp.json'), JSON.stringify(mcpConfig, null, 2), 'utf-8');
}
