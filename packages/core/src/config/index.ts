export * from './project';
export * from './agent';
export * from './global';

import { readFile } from 'node:fs/promises';
import { parse as parseToml } from 'smol-toml';
import { AgentConfigSchema, type AgentConfig } from './agent';
import { GlobalConfigSchema, type GlobalConfig } from './global';
import { ProjectConfigSchema, type ProjectConfig } from './project';

export async function loadProjectConfig(path: string): Promise<ProjectConfig> {
  const raw = await readFile(path, 'utf-8');
  const parsed = parseToml(raw);
  return ProjectConfigSchema.parse(parsed);
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
