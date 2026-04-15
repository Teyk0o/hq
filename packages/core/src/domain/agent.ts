import type { AgentCapabilities } from './task';

export const AGENT_ROLES = ['boss', 'worker', 'reviewer', 'readonly'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const ROLE_CAPABILITIES: Record<AgentRole, AgentCapabilities> = {
  boss: {
    can_claim_tasks: false,
    can_review: true,
    can_promote_tasks: true,
    can_create_tasks: true,
    can_write_files: false,
    can_commit: false,
  },
  worker: {
    can_claim_tasks: true,
    can_review: true,
    can_promote_tasks: false,
    can_create_tasks: false,
    can_write_files: true,
    can_commit: true,
  },
  reviewer: {
    can_claim_tasks: false,
    can_review: true,
    can_promote_tasks: false,
    can_create_tasks: false,
    can_write_files: false,
    can_commit: false,
  },
  readonly: {
    can_claim_tasks: false,
    can_review: false,
    can_promote_tasks: false,
    can_create_tasks: false,
    can_write_files: false,
    can_commit: false,
  },
};

export const DEFAULT_TOOLS_PER_ROLE: Record<AgentRole, string[]> = {
  boss: ['Read', 'Grep', 'Glob', 'Bash(safe)'],
  worker: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
  reviewer: ['Read', 'Grep', 'Glob'],
  readonly: ['Read', 'Grep', 'Glob'],
};

export function resolveCapabilities(
  role: AgentRole,
  overrides?: { [K in keyof AgentCapabilities]?: boolean | undefined },
): AgentCapabilities {
  const base = ROLE_CAPABILITIES[role];
  if (!overrides) return { ...base };
  const merged: AgentCapabilities = { ...base };
  for (const [key, val] of Object.entries(overrides) as [keyof AgentCapabilities, boolean | undefined][]) {
    if (val !== undefined) merged[key] = val;
  }
  return merged;
}
