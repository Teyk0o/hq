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
