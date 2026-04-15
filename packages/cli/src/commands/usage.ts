import { fetchUsage } from '@hq/usage';

export async function usageCommand(opts: { refresh?: boolean }): Promise<void> {
  const snap = await fetchUsage({ force: !!opts.refresh });
  const row = (label: string, pct: number, resets: number | null): string => {
    const bar = renderBar(pct);
    const ts = resets ? new Date(resets).toLocaleString() : '-';
    return `  ${label.padEnd(16)} ${bar} ${String(pct).padStart(3)}%   resets ${ts}`;
  };
  console.log(`Fetched at ${new Date(snap.fetched_at).toLocaleString()}  (source: ${snap.source})`);
  console.log(row('Session',       snap.session_pct, snap.session_resets_at));
  console.log(row('Week (all)',    snap.week_all_pct, snap.week_all_resets_at));
  console.log(row('Week (sonnet)', snap.week_sonnet_pct, snap.week_sonnet_resets_at));
}

function renderBar(pct: number, width = 20): string {
  const filled = Math.round((pct / 100) * width);
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`;
}
