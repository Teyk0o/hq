import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Write `.claude/settings.local.json` inside the agent's worktree.
 * Configures a PreToolUse hook that delegates Bash validation to `hq bash-gate`,
 * which enforces the project's allow_prefixes / deny_patterns whitelist.
 *
 * Even though the daemon launches Claude with --dangerously-skip-permissions
 * (so Claude's built-in permission layer is off), Claude Code still runs hooks.
 * This is our mechanism to keep bash calls safe.
 */
export async function writeClaudeSettings(
  worktreePath: string,
  projectPath: string,
  agentName: string,
): Promise<void> {
  const settingsDir = join(worktreePath, '.claude');
  await mkdir(settingsDir, { recursive: true });

  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            {
              type: 'command',
              command: `hq bash-gate --project ${shellQuote(projectPath)} --agent ${shellQuote(agentName)}`,
            },
          ],
        },
      ],
    },
  };

  await writeFile(
    join(settingsDir, 'settings.local.json'),
    JSON.stringify(settings, null, 2),
    'utf-8',
  );
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-./:=@]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
