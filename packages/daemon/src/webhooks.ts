import type { HQEvent, ProjectConfig } from '@hq/core';
import type { EventBus } from '@hq/mcp';

export interface DiscordWebhookOptions {
  url: string;
  events: string[];
  projectName: string;
}

/**
 * Subscribe a project-scoped Discord webhook to the shared bus. Posts a
 * compact embed for every event in `events` (exact type match). Network is
 * fire-and-forget — we never block the bus on Discord latency or rate limits.
 */
export function installDiscordWebhook(bus: EventBus, opts: DiscordWebhookOptions): () => void {
  if (!opts.url) return () => undefined;
  const enabled = new Set(opts.events);
  return bus.subscribe((event) => {
    if (!enabled.has(event.type)) return;
    void postDiscord(opts.url, opts.projectName, event);
  });
}

/** Subscribe Discord webhooks for every project that declared one. */
export function installProjectWebhooks(
  bus: EventBus,
  projects: Array<{ name: string; config: ProjectConfig }>,
): Array<() => void> {
  const unsubs: Array<() => void> = [];
  for (const { name, config } of projects) {
    if (!config.webhook.discord_url) continue;
    unsubs.push(
      installDiscordWebhook(bus, {
        url: config.webhook.discord_url,
        events: config.webhook.discord_events,
        projectName: name,
      }),
    );
    console.log(
      `[webhook] ${name}: discord wired for ${config.webhook.discord_events.length} event type(s)`,
    );
  }
  return unsubs;
}

async function postDiscord(url: string, projectName: string, event: HQEvent): Promise<void> {
  try {
    const { title, description, color } = renderEvent(event);
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [
          {
            title,
            description,
            color,
            footer: { text: `HQ · ${projectName}` },
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch (err) {
    console.warn('[webhook] discord post failed:', (err as Error).message);
  }
}

function renderEvent(event: HQEvent): { title: string; description: string; color: number } {
  switch (event.type) {
    case 'task.created':
      return {
        title: '🆕 Task created',
        description: `\`${event.task_id}\` by **${event.by}**`,
        color: 0x2383e2,
      };
    case 'task.claimed':
      return {
        title: '👋 Task claimed',
        description: `\`${event.task_id}\` by **${event.agent}**`,
        color: 0xd9730d,
      };
    case 'task.status_changed':
      return {
        title: '↪ Task moved',
        description: `\`${event.task_id}\` \`${event.from}\` → \`${event.to}\` by **${event.by}**`,
        color: 0x9065b0,
      };
    case 'task.reviewed':
      return {
        title: event.verdict === 'approved' ? '✅ Review approved' : '⚠ Changes requested',
        description: `\`${event.task_id}\` by **${event.reviewer}**`,
        color: event.verdict === 'approved' ? 0x4b7f67 : 0xb84747,
      };
    case 'task.blocked':
      return {
        title: '🚧 Task blocked',
        description: `\`${event.task_id}\` — ${event.reason}`,
        color: 0xb84747,
      };
    case 'task.pushed':
      return {
        title: '📦 Task pushed',
        description: `\`${event.task_id}\` branch \`${event.branch}\``,
        color: 0x4b7f67,
      };
    case 'agent.heartbeat_started':
      return {
        title: '▶ Heartbeat started',
        description: `**${event.agent}**`,
        color: 0x787874,
      };
    case 'agent.heartbeat_ended':
      return {
        title: '⏹ Heartbeat ended',
        description: `**${event.agent}** · outcome \`${event.outcome}\` · ${event.tokens_used} tokens`,
        color: event.outcome === 'ok' ? 0x4b7f67 : 0xb84747,
      };
    case 'daemon.quota_paused':
      return {
        title: '⏸ Daemon paused (quota)',
        description: `Week usage ${event.week_all_pct}%`,
        color: 0xd9730d,
      };
    case 'daemon.quota_resumed':
      return {
        title: '▶ Daemon resumed',
        description: 'Quota reset, agents are running again.',
        color: 0x4b7f67,
      };
    case 'message.sent':
      return {
        title: '✉ Message',
        description: `**${event.from}** → **${event.to}**`,
        color: 0x2383e2,
      };
    default:
      return {
        title: `• ${event.type}`,
        description: '```json\n' + JSON.stringify(event, null, 2).slice(0, 900) + '\n```',
        color: 0x787874,
      };
  }
}
