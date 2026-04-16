import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { createLogger } from '@hq/core';
import { Cron } from 'croner';

const log = createLogger('digest');

export interface DigestOptions {
  projects: Array<{ name: string; path: string; discordUrl?: string }>;
  /** Override the daily cron time. Default '0 21 * * *' = 21:00 local. */
  schedule?: string;
}

interface Summary {
  shipped: Array<{ title: string; assignee: string | null }>;
  blocked: Array<{ title: string; reason: string | null }>;
  topAgents: Array<{ name: string; n: number }>;
  tokensToday: number;
  heartbeats: number;
}

/**
 * Post a daily digest to each project's Discord webhook at 21:00 local time.
 * Summarises the day: tasks shipped + blocked, top 3 agents by shipped count,
 * heartbeats + tokens total. Fire-and-forget; a failed POST is logged but
 * never crashes the daemon.
 */
export function installDailyDigest(options: DigestOptions): () => void {
  const schedule = options.schedule ?? '0 21 * * *';
  const enabled = options.projects.filter((p) => p.discordUrl);
  if (enabled.length === 0) {
    log.info('no projects have a discord webhook, skipping digest');
    return () => undefined;
  }
  const cron = new Cron(schedule, { paused: false }, async () => {
    for (const project of enabled) {
      try {
        const summary = summariseDay(project.path);
        await postDigest(project.discordUrl!, project.name, summary);
        log.info('digest posted', {
          project: project.name,
          shipped: summary.shipped.length,
          blocked: summary.blocked.length,
        });
      } catch (err) {
        log.error('digest failed', {
          project: project.name,
          error: (err as Error).message,
        });
      }
    }
  });
  log.info('daily digest scheduled', { schedule, projects: enabled.map((p) => p.name) });
  return () => cron.stop();
}

function summariseDay(projectPath: string): Summary {
  const db = new Database(join(projectPath, '.hq', 'db.sqlite'), { readonly: true });
  try {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const shipped = db
      .query<{ title: string; assignee: string | null }, [number]>(
        `SELECT title, assignee FROM tasks WHERE status = 'done' AND completed_at >= ?`,
      )
      .all(dayAgo);

    const blocked = db
      .query<{ title: string; reason: string | null }, [number]>(
        `SELECT title, blocked_reason AS reason FROM tasks WHERE status = 'blocked' AND updated_at >= ?`,
      )
      .all(dayAgo);

    const topAgents = db
      .query<{ name: string; n: number }, [number]>(
        `SELECT assignee AS name, COUNT(*) AS n FROM tasks
           WHERE status = 'done' AND completed_at >= ? AND assignee IS NOT NULL
           GROUP BY assignee ORDER BY n DESC LIMIT 3`,
      )
      .all(dayAgo);

    const activity = db
      .query<{ n: number; t: number }, [number]>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(tokens_used), 0) AS t FROM heartbeats WHERE started_at >= ?`,
      )
      .get(dayAgo) ?? { n: 0, t: 0 };

    return {
      shipped,
      blocked,
      topAgents,
      tokensToday: activity.t,
      heartbeats: activity.n,
    };
  } finally {
    db.close();
  }
}

async function postDigest(url: string, projectName: string, s: Summary): Promise<void> {
  const lines: string[] = [];
  lines.push(`**Shipped today:** ${s.shipped.length}`);
  for (const t of s.shipped.slice(0, 8)) {
    lines.push(`  • ${t.title}${t.assignee ? ` (${t.assignee})` : ''}`);
  }
  if (s.shipped.length > 8) lines.push(`  … and ${s.shipped.length - 8} more`);
  if (s.blocked.length > 0) {
    lines.push(`**Blocked:** ${s.blocked.length}`);
    for (const t of s.blocked.slice(0, 5)) {
      lines.push(`  ⚠ ${t.title}${t.reason ? ` — ${t.reason}` : ''}`);
    }
  }
  if (s.topAgents.length > 0) {
    lines.push('**Top agents:**');
    for (const a of s.topAgents) lines.push(`  🏅 ${a.name}: ${a.n} shipped`);
  }
  lines.push(`**Activity:** ${s.heartbeats} heartbeats · ${formatTokens(s.tokensToday)} tokens`);

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [
        {
          title: `📊 Daily digest — ${projectName}`,
          description: lines.join('\n'),
          color: 0xcc785c,
          timestamp: new Date().toISOString(),
          footer: { text: 'HQ' },
        },
      ],
    }),
  });
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
