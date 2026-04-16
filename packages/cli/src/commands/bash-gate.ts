import { join } from 'node:path';
import { loadProjectConfig, openProjectDb, activity as activityTable } from '@hq/core';

/**
 * Claude Code PreToolUse hook: reads the tool call payload from stdin and
 * decides whether the Bash invocation is allowed by the project whitelist.
 *
 * This runs as a subprocess of Claude, which itself runs inside the
 * bubblewrap sandbox — so the hook inherits the sandbox's namespaces and
 * file-system constraints. It's protected by the same isolation layer as
 * the agent it gates; an agent that somehow crashed the hook would still
 * be confined to its worktree + read-only host FS.
 *
 * Exit 0 = allow (and an audit row gets written to activity), exit 2 =
 * block with stderr shown to Claude.
 */
export async function bashGateCommand(opts: { project: string; agent: string }): Promise<void> {
  const stdin = await readStdin();
  const payload = safeJsonParse(stdin);
  const command: string | null = payload?.tool_input?.command ?? payload?.input?.command ?? null;

  if (!command) {
    // Not a Bash tool call (or missing payload) — allow so non-Bash tools pass through.
    process.exit(0);
  }

  const cfg = await loadProjectConfig(join(opts.project, '.hq', 'project.toml'));

  for (const pattern of cfg.bash.deny_patterns) {
    if (new RegExp(pattern).test(command)) {
      logAudit(opts.project, opts.agent, command, 'denied', `pattern:${pattern}`);
      process.stderr.write(`HQ bash-gate: denied by pattern /${pattern}/\n  command: ${command}\n`);
      process.exit(2);
    }
  }

  const allowed = cfg.bash.allow_prefixes.some((prefix) => command.startsWith(prefix));
  if (!allowed) {
    logAudit(opts.project, opts.agent, command, 'denied', 'not_whitelisted');
    process.stderr.write(
      `HQ bash-gate: command not in allow_prefixes\n  command: ${command}\n` +
        `  add the prefix to project.toml [bash] allow_prefixes if legitimate.\n`,
    );
    process.exit(2);
  }

  logAudit(opts.project, opts.agent, command, 'allowed');
  process.exit(0);
}

/**
 * Write a one-line audit row for every bash invocation the gate evaluates.
 * Allowed commands let us reconstruct what an agent actually ran; denials
 * are useful to catch policies that are too tight or a rogue agent probing
 * the surface. Best-effort: a broken DB must never break the gate itself.
 */
function logAudit(
  projectPath: string,
  agent: string,
  command: string,
  outcome: 'allowed' | 'denied',
  reason?: string,
): void {
  try {
    const db = openProjectDb(join(projectPath, '.hq', 'db.sqlite'));
    db.insert(activityTable)
      .values({
        agent,
        action: outcome === 'denied' ? 'bash.denied' : 'bash.allowed',
        details: JSON.stringify({
          command: command.length > 400 ? `${command.slice(0, 400)}…` : command,
          ...(reason ? { reason } : {}),
        }),
      })
      .run();
  } catch {
    // never fail the gate on a logging glitch
  }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    // Handle the rare case where stdin is a TTY with no input piped.
    setTimeout(() => resolve(data), 500);
  });
}

function safeJsonParse(raw: string): { tool_input?: { command?: string }; input?: { command?: string } } | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
