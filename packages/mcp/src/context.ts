import type { AgentCapabilities, AgentRole, HQDatabase, ProjectConfig } from '@hq/core';
import type { EventBus } from './bus';

export interface McpContext {
  readonly projectPath: string;
  readonly projectName: string;
  readonly projectConfig: ProjectConfig;
  readonly agentName: string;
  readonly agentRole: AgentRole;
  readonly capabilities: AgentCapabilities;
  readonly db: HQDatabase;
  readonly bus: EventBus;
  /** Current heartbeat id for this MCP session, set by start_heartbeat. */
  currentHeartbeatId: string | null;
  /** Tasks claimed during this heartbeat — used by end_heartbeat for accounting. */
  tasksWorkedThisHeartbeat: Set<string>;
}

/**
 * Structured error raised by MCP tool handlers. The server converts these into
 * a JSON payload (with `code` + `message`) that agents can parse and react to,
 * rather than surfacing an opaque exception.
 */
export class McpError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.details = details;
  }
}

export class CapabilityError extends McpError {
  constructor(capability: keyof AgentCapabilities, agent: string) {
    super('missing_capability', `Agent "${agent}" lacks capability: ${capability}`, {
      capability,
      agent,
    });
  }
}

export function requireCapability(ctx: McpContext, cap: keyof AgentCapabilities): void {
  if (!ctx.capabilities[cap]) {
    throw new CapabilityError(cap, ctx.agentName);
  }
}
