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

  // Two gates on PreToolUse:
  //  - bash-gate: whitelists Bash commands
  //  - rules-gate: evaluates [[rules]] against Edit/Write/MultiEdit/NotebookEdit
  const qp = shellQuote(projectPath);
  const qa = shellQuote(agentName);
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            {
              type: 'command',
              command: `hq bash-gate --project ${qp} --agent ${qa}`,
            },
          ],
        },
        {
          matcher: 'Edit|Write|MultiEdit|NotebookEdit',
          hooks: [
            {
              type: 'command',
              command: `hq rules-gate --project ${qp} --agent ${qa}`,
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
