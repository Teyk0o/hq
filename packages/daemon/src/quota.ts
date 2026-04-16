import type { GlobalConfig } from '@hq/core';
import { fetchUsage, pickRefreshInterval, type UsageSnapshot } from '@hq/usage';
import { Cron } from 'croner';

export type QuotaListener = (snapshot: UsageSnapshot) => void;
export type PauseListener = (
  change:
    | { kind: 'paused'; reason: 'week' | 'session'; pct: number }
    | { kind: 'resumed' },
) => void;

/**
 * Adaptive poller for Claude Max quota. Normal cadence is driven by
 * `refresh_normal_minutes`; above `accelerated_threshold` percent, it switches
 * to `refresh_accelerated_minutes`.
 *
 * Pause state is derived from the latest snapshot and recomputed on every
 * tick. When it transitions true → false (quota window reset brings the
 * percentage back under threshold), we surface a 'resumed' event so the
 * daemon can log it and the UI can toast the good news. Pause itself is
 * already surfaced by the caller via the usage listener.
 */
export class QuotaPoller {
  private currentInterval = 0;
  private cron: Cron | null = null;
  private lastSnapshot: UsageSnapshot | null = null;
  private wasPaused = false;

  constructor(
    private readonly cfg: GlobalConfig['claude_usage'],
    private readonly listener: QuotaListener,
    private readonly onPauseChange?: PauseListener,
  ) {}

  async start(): Promise<void> {
    await this.tick();
  }

  stop(): void {
    this.cron?.stop();
    this.cron = null;
  }

  isPaused(): boolean {
    if (!this.lastSnapshot) return false;
    return this.pauseReason(this.lastSnapshot) !== null;
  }

  private pauseReason(
    snap: UsageSnapshot,
  ): { reason: 'week' | 'session'; pct: number } | null {
    if (
      this.cfg.auto_pause_threshold_week > 0 &&
      snap.week_all_pct >= this.cfg.auto_pause_threshold_week
    ) {
      return { reason: 'week', pct: snap.week_all_pct };
    }
    if (
      this.cfg.auto_pause_threshold_session > 0 &&
      snap.session_pct >= this.cfg.auto_pause_threshold_session
    ) {
      return { reason: 'session', pct: snap.session_pct };
    }
    return null;
  }

  private async tick(): Promise<void> {
    try {
      const snap = await fetchUsage({ force: true });
      this.lastSnapshot = snap;
      this.listener(snap);

      const reason = this.pauseReason(snap);
      const isPaused = reason !== null;
      if (isPaused && !this.wasPaused) {
        this.onPauseChange?.({ kind: 'paused', ...reason });
      } else if (!isPaused && this.wasPaused && this.cfg.resume_on_reset) {
        this.onPauseChange?.({ kind: 'resumed' });
      }
      this.wasPaused = isPaused;

      const nextMin = pickRefreshInterval(
        snap,
        this.cfg.refresh_normal_minutes,
        this.cfg.refresh_accelerated_minutes,
        this.cfg.accelerated_threshold,
      );
      this.reschedule(nextMin);
    } catch (err) {
      console.error('[quota] fetch failed:', err);
      this.reschedule(this.cfg.refresh_normal_minutes);
    }
  }

  private reschedule(minutes: number): void {
    if (minutes === this.currentInterval && this.cron) return;
    this.currentInterval = minutes;
    this.cron?.stop();
    this.cron = new Cron(`*/${minutes} * * * *`, { paused: false }, () => this.tick());
  }
}
