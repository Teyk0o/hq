import type { AgentCapabilities, AgentRole, HQDatabase } from '@hq/core';
import type { EventBus } from './bus';

export interface McpContext {
  readonly projectPath: string;
  readonly projectName: string;
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

export class CapabilityError extends Error {
  constructor(capability: keyof AgentCapabilities, agent: string) {
    super(`Agent "${agent}" lacks capability: ${capability}`);
    this.name = 'CapabilityError';
  }
}

export function requireCapability(ctx: McpContext, cap: keyof AgentCapabilities): void {
  if (!ctx.capabilities[cap]) {
    throw new CapabilityError(cap, ctx.agentName);
  }
}
