export interface UsageSnapshot {
  session_pct: number;
  session_resets_at: number | null;
  week_all_pct: number;
  week_all_resets_at: number | null;
  week_sonnet_pct: number;
  week_sonnet_resets_at: number | null;
  fetched_at: number;
  source: 'ccusage' | 'stub';
}

export interface UsageCacheFile {
  snapshot: UsageSnapshot;
  ttl_ms: number;
}
