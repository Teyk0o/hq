import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Pre-approve the trust dialog for a path in Claude Code's global config file
 * (`~/.claude.json`). Without this, `claude` stops at the "Is this a project
 * you trust?" prompt on first launch in a new directory, freezing the TUI
 * from our non-interactive daemon's perspective.
 *
 * Idempotent: safe to call every heartbeat. Best-effort: swallows errors so a
 * missing/locked file never blocks an agent tick.
 */
export async function preApproveTrust(path: string): Promise<void> {
  const claudeJsonPath = join(homedir(), '.claude.json');
  try {
    const raw = await readFile(claudeJsonPath, 'utf-8');
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    const projects = ((cfg.projects as Record<string, Record<string, unknown>>) ??= {});
    const project = (projects[path] ??= {});
    if (project.hasTrustDialogAccepted === true) return; // already trusted, nothing to do
    project.hasTrustDialogAccepted = true;
    if (typeof project.projectOnboardingSeenCount !== 'number') {
      project.projectOnboardingSeenCount = 1;
    }
    if (typeof project.hasCompletedProjectOnboarding !== 'boolean') {
      project.hasCompletedProjectOnboarding = true;
    }
    await writeFile(claudeJsonPath, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[trust] could not pre-approve ${path}:`, (err as Error).message);
  }
}
