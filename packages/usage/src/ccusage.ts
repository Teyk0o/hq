import type { UsageSnapshot } from './types';

/**
 * Invokes `bunx ccusage blocks --json` and normalises the payload to our shape.
 *
 * ccusage output shape (per its README): `{ blocks: [{ startTime, endTime, isActive, totalTokens, ... }] }`
 * It does not publish Max-plan limits, so percentage derivation is best-effort and
 * parameterised. For now we take the active 5h block's utilisation ratio as a proxy
 * for `session_pct`. Weekly percentages come from summing the last 7 days and
 * comparing to a configurable weekly budget.
 *
 * TODO: align exact numbers with what `/usage` displays once we can cross-check on a real run.
 */
export async function runCcusage(): Promise<CcusageRaw> {
  const proc = Bun.spawn(['bunx', '--bun', 'ccusage', 'blocks', '--json'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`ccusage exited with code ${code}: ${stderr}`);
  }
  return JSON.parse(stdout) as CcusageRaw;
}

export interface CcusageRaw {
  blocks: Array<{
    id: string;
    startTime: string;
    endTime: string;
    isActive: boolean;
    totalTokens: number;
    costUSD?: number;
    models?: string[];
  }>;
}

export interface PlanLimits {
  /** Tokens allowed per 5h session block. 0 = unknown. */
  session_tokens: number;
  /** Tokens allowed per week, all models. 0 = unknown. */
  week_all_tokens: number;
  /** Tokens allowed per week on Sonnet specifically. 0 = unknown. */
  week_sonnet_tokens: number;
}

/** Sensible defaults for a Claude Max (20x) plan; override via global config when tuned. */
export const DEFAULT_MAX_LIMITS: PlanLimits = {
  session_tokens: 880_000,
  week_all_tokens: 5_500_000,
  week_sonnet_tokens: 44_000_000,
};

export function normalise(raw: CcusageRaw, limits: PlanLimits): UsageSnapshot {
  const now = Date.now();
  const active = raw.blocks.find((b) => b.isActive);
  const session_pct =
    active && limits.session_tokens > 0
      ? clampPct(active.totalTokens / limits.session_tokens)
      : 0;
  const session_resets_at = active ? Date.parse(active.endTime) : null;

  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const weekBlocks = raw.blocks.filter((b) => Date.parse(b.startTime) >= oneWeekAgo);
  const weekAllTokens = weekBlocks.reduce((sum, b) => sum + b.totalTokens, 0);
  const weekSonnetTokens = weekBlocks
    .filter((b) => b.models?.some((m) => m.toLowerCase().includes('sonnet')))
    .reduce((sum, b) => sum + b.totalTokens, 0);

  return {
    session_pct,
    session_resets_at,
    week_all_pct:
      limits.week_all_tokens > 0 ? clampPct(weekAllTokens / limits.week_all_tokens) : 0,
    week_all_resets_at: null,
    week_sonnet_pct:
      limits.week_sonnet_tokens > 0 ? clampPct(weekSonnetTokens / limits.week_sonnet_tokens) : 0,
    week_sonnet_resets_at: null,
    fetched_at: now,
    source: 'ccusage',
  };
}

function clampPct(ratio: number): number {
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}
