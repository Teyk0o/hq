export * from './project';
export * from './agent';
export * from './global';

import { readFile } from 'node:fs/promises';
import { parse as parseToml } from 'smol-toml';
import { AgentConfigSchema, type AgentConfig } from './agent';
import { GlobalConfigSchema, type GlobalConfig } from './global';
import { BASH_DEFAULT_ALLOW_PREFIXES, ProjectConfigSchema, type ProjectConfig } from './project';

export async function loadProjectConfig(path: string): Promise<ProjectConfig> {
  const raw = await readFile(path, 'utf-8');
  const parsed = parseToml(raw) as Record<string, unknown>;
  const config = ProjectConfigSchema.parse(parsed);
  // If the project explicitly sets allow_prefixes, merge with built-in defaults
  // so project-specific entries (e.g. "cargo ") extend rather than replace them.
  const rawBash = parsed.bash as Record<string, unknown> | undefined;
  if (rawBash && Array.isArray(rawBash.allow_prefixes)) {
    config.bash.allow_prefixes = [
      ...new Set([...BASH_DEFAULT_ALLOW_PREFIXES, ...(rawBash.allow_prefixes as string[])]),
    ];
  }
  return config;
}

export async function loadAgentConfig(path: string): Promise<AgentConfig> {
  const raw = await readFile(path, 'utf-8');
  const parsed = parseToml(raw);
  return AgentConfigSchema.parse(parsed);
}

export async function loadGlobalConfig(path: string): Promise<GlobalConfig> {
  try {
    const raw = await readFile(path, 'utf-8');
    return GlobalConfigSchema.parse(parseToml(raw));
  } catch {
    return GlobalConfigSchema.parse({});
  }
}
