export * from './types';
export * from './ccusage';
export * from './cache';
export { probeUsageViaTmux, parseUsageOutput } from './probe';

import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MAX_LIMITS, normalise, runCcusage, type PlanLimits } from './ccusage';
import { isCacheFresh, readCache, writeCache } from './cache';
import { probeUsageViaTmux } from './probe';
import type { UsageSnapshot } from './types';

export const DEFAULT_CACHE_PATH = join(homedir(), '.hq', 'usage-cache.json');

export interface FetchOptions {
  cachePath?: string;
  ttlMs?: number;
  limits?: PlanLimits;
  force?: boolean;
}

/**
 * Fetch a fresh snapshot. Strategy:
 *   1. Honour the on-disk cache unless `force`.
 *   2. Probe Claude Code's `/usage` via an ephemeral tmux session (exact figures).
 *   3. Fall back to ccusage with heuristic limits (less accurate but always works).
 */
export async function fetchUsage(options: FetchOptions = {}): Promise<UsageSnapshot> {
  const {
    cachePath = DEFAULT_CACHE_PATH,
    ttlMs = 10 * 60 * 1000,
    limits = DEFAULT_MAX_LIMITS,
    force = false,
  } = options;

  if (!force) {
    const cached = await readCache(cachePath);
    if (cached && isCacheFresh(cached)) return cached.snapshot;
  }

  let snapshot: UsageSnapshot;
  try {
    snapshot = await probeUsageViaTmux();
  } catch (err) {
    console.warn('[usage] probe failed, falling back to ccusage:', (err as Error).message);
    const raw = await runCcusage();
    snapshot = normalise(raw, limits);
  }

  await writeCache(cachePath, snapshot, ttlMs);
  return snapshot;
}

/** Decide which refresh cadence applies given the latest snapshot. */
export function pickRefreshInterval(
  snapshot: UsageSnapshot,
  normalMin: number,
  acceleratedMin: number,
  acceleratedThresholdPct: number,
): number {
  const topPct = Math.max(
    snapshot.session_pct,
    snapshot.week_all_pct,
    snapshot.week_sonnet_pct,
  );
  return topPct >= acceleratedThresholdPct ? acceleratedMin : normalMin;
}

export const PACKAGE_NAME = '@hq/usage';
