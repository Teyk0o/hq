import { EventEmitter } from 'node:events';
import type { HQEvent } from '@hq/core';

/**
 * Event bus used by MCP tool handlers. Behaves as a simple in-process EventEmitter
 * when hosted inside the daemon, and additionally forwards each event as an HTTP
 * POST when HQ_EVENT_SINK_URL is set (the MCP server typically runs in a separate
 * subprocess spawned by Claude, so it must bridge events back to the daemon).
 */
export class EventBus {
  private readonly emitter = new EventEmitter({ captureRejections: true });
  private readonly sinkUrl: string | null;

  constructor() {
    // Node's EventEmitter warns at 10 listeners by default. SSE clients + UI
    // subscribers + Discord forwarder + the UI bus re-publisher can comfortably
    // exceed that even in single-user local mode. Raising to 200 keeps us
    // out of warning territory with plenty of headroom; a legitimate leak
    // would still scream long before we hit the new ceiling.
    this.emitter.setMaxListeners(200);
    this.sinkUrl = process.env.HQ_EVENT_SINK_URL ?? null;
  }

  publish(event: HQEvent): void {
    if (this.sinkUrl) {
      // Fire-and-forget; MCP tool flow must never block on a failing sink.
      fetch(this.sinkUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }).catch(() => undefined);
    }
    this.emitter.emit('event', event);
    this.emitter.emit(event.type, event);
  }

  subscribe(listener: (event: HQEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}

let sharedBus: EventBus | null = null;
export function getSharedBus(): EventBus {
  sharedBus ??= new EventBus();
  return sharedBus;
}
