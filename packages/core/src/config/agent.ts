import { z } from 'zod';
import { AGENT_ROLES } from '../domain/agent';

export const AgentConfigSchema = z.object({
  agent: z.object({
    name: z.string().regex(/^[a-z][a-z0-9_-]*$/, 'lowercase slug required'),
    role: z.enum(AGENT_ROLES),
    model: z.enum(['opus', 'sonnet', 'haiku']).optional(),
    soul: z.string().default(''),
    active: z.boolean().default(true),
    readonly: z.boolean().default(false),
    /**
     * When true, rules-gate refuses every Edit/Write/MultiEdit/NotebookEdit
     * call regardless of project [[rules]]. Stronger than role='readonly'
     * because it enforces at the hook level, not just the MCP capability
     * layer, so an agent that bypasses capability checks (e.g. via Bash)
     * still cannot write to files.
     */
    readonly_strict: z.boolean().default(false),
    /** Optional presentation-only hint used to bias the avatar seed. */
    gender: z.enum(['female', 'male', 'neutral']).optional(),
  }),
  capabilities: z
    .object({
      can_claim_tasks: z.boolean().optional(),
      can_review: z.boolean().optional(),
      can_promote_tasks: z.boolean().optional(),
      can_create_tasks: z.boolean().optional(),
      can_write_files: z.boolean().optional(),
      can_commit: z.boolean().optional(),
    })
    .optional(),
  tools: z
    .object({
      extra_allowed: z.array(z.string()).default([]),
      extra_denied: z.array(z.string()).default([]),
    })
    .optional(),
  scope: z
    .object({
      packages: z.array(z.string()).default([]),
    })
    .optional(),
  budget: z
    .object({
      max_tokens_per_heartbeat: z.number().int().positive().optional(),
      max_tokens_per_day: z.number().int().positive().optional(),
    })
    .optional(),
  timeout: z
    .object({
      heartbeat_minutes: z.number().int().positive().optional(),
    })
    .optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
