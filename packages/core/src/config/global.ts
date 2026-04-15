import { z } from 'zod';

export const GlobalConfigSchema = z.object({
  defaults: z
    .object({
      model: z.enum(['opus', 'sonnet', 'haiku']).default('sonnet'),
    })
    .default({}),
  daemon: z
    .object({
      ui_port: z.number().int().positive().default(7433),
      ui_host: z.string().default('127.0.0.1'),
    })
    .default({}),
  claude_usage: z
    .object({
      auto_pause_threshold_week: z.number().int().min(0).max(100).default(85),
      auto_pause_threshold_session: z.number().int().min(0).max(100).default(0),
      resume_on_reset: z.boolean().default(true),
      refresh_normal_minutes: z.number().int().positive().default(10),
      refresh_accelerated_minutes: z.number().int().positive().default(2),
      accelerated_threshold: z.number().int().min(0).max(100).default(80),
    })
    .default({}),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
