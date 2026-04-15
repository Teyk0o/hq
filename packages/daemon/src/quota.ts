import type { GlobalConfig } from '@hq/core';
import { fetchUsage, pickRefreshInterval, type UsageSnapshot } from '@hq/usage';
import { Cron } from 'croner';

export type QuotaListener = (snapshot: UsageSnapshot) => void;

/**
 * Adaptive poller for Claude Max quota. Normal cadence is driven by
 * `refresh_normal_minutes`; above `accelerated_threshold` percent, it switches
 * to `refresh_accelerated_minutes`.
 */
export class QuotaPoller {
  private currentInterval = 0;
  private cron: Cron | null = null;
  private lastSnapshot: UsageSnapshot | null = null;

  constructor(
    private readonly cfg: GlobalConfig['claude_usage'],
    private readonly listener: QuotaListener,
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
    if (
      this.cfg.auto_pause_threshold_week > 0 &&
      this.lastSnapshot.week_all_pct >= this.cfg.auto_pause_threshold_week
    ) return true;
    if (
      this.cfg.auto_pause_threshold_session > 0 &&
      this.lastSnapshot.session_pct >= this.cfg.auto_pause_threshold_session
    ) return true;
    return false;
  }

  private async tick(): Promise<void> {
    try {
      const snap = await fetchUsage({ force: true });
      this.lastSnapshot = snap;
      this.listener(snap);
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
