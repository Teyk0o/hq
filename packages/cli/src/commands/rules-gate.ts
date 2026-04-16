import { join } from 'node:path';
import { evaluateRules, loadAgentConfig, loadProjectConfig } from '@hq/core';

/**
 * Claude Code PreToolUse hook for Edit / Write / MultiEdit. Reads the tool
 * call JSON from stdin, evaluates the project's `[[rules]]`, and exits 0
 * (allow) or 2 (deny, with stderr shown back to Claude). Identical wire
 * protocol to `hq bash-gate`.
 */
export async function rulesGateCommand(opts: {
  project: string;
  agent: string;
}): Promise<void> {
  const stdin = await readStdin();
  const payload = safeJsonParse(stdin);
  const toolName = String(payload?.tool_name ?? '');
  const toolInput =
    (payload?.tool_input as Record<string, unknown> | undefined) ??
    (payload?.input as Record<string, unknown> | undefined) ??
    {};

  // Pull the file path out of whichever field this tool uses.
  const filePath =
    (toolInput.file_path as string | undefined) ??
    (toolInput.path as string | undefined) ??
    (toolInput.notebook_path as string | undefined);
  const command = toolInput.command as string | undefined;

  if (!filePath && !command) process.exit(0);

  let cfg;
  try {
    cfg = await loadProjectConfig(join(opts.project, '.hq', 'project.toml'));
  } catch (err) {
    // If the config is broken we'd rather fail closed than let everything through.
    process.stderr.write(
      `HQ rules-gate: project.toml unreadable — ${(err as Error).message}\n`,
    );
    process.exit(2);
  }

  // readonly_strict: refuse all file-editing tool calls regardless of rules.
  // We only enforce this for write-class tools; read-only probes like Read
  // / Grep / Glob never hit this hook in the first place (matcher is scoped
  // to Edit|Write|MultiEdit|NotebookEdit).
  try {
    const agentCfg = await loadAgentConfig(
      join(opts.project, '.hq', 'agents', `${opts.agent}.toml`),
    );
    if (agentCfg.agent.readonly_strict) {
      process.stderr.write(
        `HQ rules-gate: agent "${opts.agent}" is in readonly_strict mode. ` +
          `Writes are not allowed.\n  tool: ${toolName}\n  target: ${filePath ?? '(none)'}\n`,
      );
      process.exit(2);
    }
  } catch {
    // If we can't read the agent config, fall through — the project-level
    // rules still apply, and we'd rather not false-positive on a config
    // glitch for a non-readonly agent.
  }

  const verdict = evaluateRules({
    config: cfg,
    agentName: opts.agent,
    toolName,
    ...(filePath !== undefined ? { filePath } : {}),
    ...(command !== undefined ? { command } : {}),
    projectRoot: opts.project,
  });

  if (verdict.blocked) {
    for (const m of verdict.messages) process.stderr.write(`HQ rules-gate: ${m}\n`);
    process.exit(2);
  }
  // Warn-only messages: pass through but surface them.
  for (const m of verdict.messages) process.stderr.write(`HQ rules-gate (warn): ${m}\n`);
  process.exit(0);
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 500);
  });
}

function safeJsonParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
