import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Pre-approve the trust dialog AND enable our .mcp.json servers for a given
 * worktree in Claude Code's global config file (`~/.claude.json`).
 *
 * Without trust pre-approval, `claude` stalls on "Is this a project you trust?"
 * Without enabling the .mcp.json servers, Claude Code ignores the project's
 * `.mcp.json` entirely and the agent never sees `mcp__hq__*` tools.
 *
 * Idempotent; best-effort (swallows errors so a locked file never blocks a tick).
 */
export async function preApproveTrust(
  path: string,
  mcpServerNames: string[] = ['hq'],
): Promise<void> {
  const claudeJsonPath = join(homedir(), '.claude.json');
  try {
    const raw = await readFile(claudeJsonPath, 'utf-8');
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    const projects = ((cfg.projects as Record<string, Record<string, unknown>>) ??= {});
    const project = (projects[path] ??= {});

    let changed = false;
    if (project.hasTrustDialogAccepted !== true) {
      project.hasTrustDialogAccepted = true;
      changed = true;
    }
    if (typeof project.projectOnboardingSeenCount !== 'number') {
      project.projectOnboardingSeenCount = 1;
      changed = true;
    }
    if (typeof project.hasCompletedProjectOnboarding !== 'boolean') {
      project.hasCompletedProjectOnboarding = true;
      changed = true;
    }

    const enabled = ((project.enabledMcpjsonServers as string[] | undefined) ?? []).slice();
    for (const name of mcpServerNames) {
      if (!enabled.includes(name)) {
        enabled.push(name);
        changed = true;
      }
    }
    project.enabledMcpjsonServers = enabled;

    // Make sure none of our servers are in the deny list.
    const disabled = ((project.disabledMcpjsonServers as string[] | undefined) ?? []).filter(
      (n) => !mcpServerNames.includes(n),
    );
    if ((project.disabledMcpjsonServers as string[] | undefined)?.length !== disabled.length) {
      project.disabledMcpjsonServers = disabled;
      changed = true;
    }

    if (changed) {
      await writeFile(claudeJsonPath, JSON.stringify(cfg, null, 2), 'utf-8');
    }
  } catch (err) {
    console.warn(`[trust] could not pre-approve ${path}:`, (err as Error).message);
  }
}
