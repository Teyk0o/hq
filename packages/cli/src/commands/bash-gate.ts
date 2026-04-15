import { join } from 'node:path';
import { loadProjectConfig } from '@hq/core';

/**
 * Claude Code PreToolUse hook: reads the tool call payload from stdin and
 * decides whether the Bash invocation is allowed by the project whitelist.
 *
 * Exit code 0 = allow, exit code 2 = block (stderr becomes feedback shown to Claude).
 * Any other failure mode also exits 2 with an error message.
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
      process.stderr.write(`HQ bash-gate: denied by pattern /${pattern}/\n  command: ${command}\n`);
      process.exit(2);
    }
  }

  const allowed = cfg.bash.allow_prefixes.some((prefix) => command.startsWith(prefix));
  if (!allowed) {
    process.stderr.write(
      `HQ bash-gate: command not in allow_prefixes\n  command: ${command}\n` +
        `  add the prefix to project.toml [bash] allow_prefixes if legitimate.\n`,
    );
    process.exit(2);
  }

  process.exit(0);
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
