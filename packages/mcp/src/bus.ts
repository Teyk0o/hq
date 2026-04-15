import { EventEmitter } from 'node:events';
import type { HQEvent } from '@hq/core';

/**
 * Process-local event bus. The UI server subscribes to this to fan events out
 * over SSE. MCP tool handlers publish here after every mutation.
 */
export class EventBus {
  private readonly emitter = new EventEmitter({ captureRejections: true });

  publish(event: HQEvent): void {
    this.emitter.emit('event', event);
    this.emitter.emit(event.type, event);
  }

  subscribe(listener: (event: HQEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}

/** Lazily shared instance so daemon + UI + MCP server share a single bus within one process. */
let sharedBus: EventBus | null = null;
export function getSharedBus(): EventBus {
  sharedBus ??= new EventBus();
  return sharedBus;
}
