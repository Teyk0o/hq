import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listProjects } from './registry';

/**
 * Resolve the active project path. Prefers walking up from cwd to find a .hq/
 * directory; falls back to the registry if an explicit --project was provided.
 */
export function resolveProjectPath(explicit?: string): string {
  if (explicit) {
    const hit = listProjects().find((p) => p.name === explicit);
    if (!hit) throw new Error(`Unknown project: ${explicit}`);
    return hit.path;
  }
  let dir = resolve(process.cwd());
  while (true) {
    if (existsSync(join(dir, '.hq', 'project.toml'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) {
      throw new Error(
        'No .hq/ found in current directory tree. Run `hq init` or pass --project.',
      );
    }
    dir = parent;
  }
}
