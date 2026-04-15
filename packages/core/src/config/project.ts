import { z } from 'zod';

export const ProjectConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    root: z.string().default('.'),
    default_model: z.enum(['opus', 'sonnet', 'haiku']).default('sonnet'),
    default_branch: z.string().default('main'),
  }),
  scheduler: z
    .object({
      interval_minutes: z.number().int().positive().default(15),
      stagger_seconds: z.number().int().nonnegative().default(60),
      max_concurrent_agents: z.number().int().positive().default(3),
      daily_token_budget: z.number().int().nonnegative().default(0),
    })
    .default({}),
  git: z
    .object({
      branch_prefix: z.string().default('agent/'),
      worktree_dir: z.string().default('.hq/worktrees'),
    })
    .default({}),
  kanban: z
    .object({
      min_reviewers: z.number().int().nonnegative().default(1),
      require_lint_before_review: z.boolean().default(true),
      require_typecheck_before_review: z.boolean().default(true),
    })
    .default({}),
  heartbeat: z
    .object({
      default_timeout_minutes: z.number().int().positive().default(15),
      max_session_hours: z.number().int().positive().default(4),
      retry_max: z.number().int().nonnegative().default(2),
    })
    .default({}),
  webhook: z
    .object({
      discord_url: z.string().url().or(z.literal('')).default(''),
      discord_events: z.array(z.string()).default([]),
    })
    .default({}),
  goals: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().default(''),
        assignees: z.array(z.string()).default([]),
        tasks_per_week: z.number().int().nonnegative().default(0),
        active: z.boolean().default(true),
      }),
    )
    .default([]),
  rules: z.array(z.record(z.unknown())).default([]),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
