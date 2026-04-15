import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfig, AgentRole, HQDatabase } from '@hq/core';
import { agentState } from '@hq/core';

export interface HeartbeatPromptContext {
  agentName: string;
  agentRole: AgentRole;
  projectName: string;
  projectPath: string;
  agentConfig: AgentConfig;
  db: HQDatabase;
  maxTokens: number;
  timeoutMinutes: number;
}

/** Build the heartbeat prompt to inject into the agent's tmux session. */
export async function buildHeartbeatPrompt(ctx: HeartbeatPromptContext): Promise<string> {
  const soulPath = join(ctx.projectPath, '.hq', 'agents', ctx.agentConfig.agent.soul);
  const soul = await tryRead(soulPath, '(no SOUL.md found)');

  const progressPath = join(ctx.projectPath, '.hq', 'progress', `${ctx.agentName}.md`);
  const progress = await tryRead(progressPath, '(no prior progress)');

  const teammates = ctx.db.select().from(agentState).all();
  const teammateLines = teammates
    .filter((t) => t.name !== ctx.agentName)
    .map((t) => `  - ${t.name} (status=${t.status}${t.currentTaskId ? `, on=${t.currentTaskId}` : ''})`)
    .join('\n');

  return [
    `=== HQ HEARTBEAT ===`,
    ``,
    `You are ${ctx.agentName}, a ${ctx.agentRole} on project ${ctx.projectName}.`,
    ``,
    `Your SOUL:`,
    soul,
    ``,
    `Your teammates:`,
    teammateLines || '  (none)',
    ``,
    `Your PROGRESS since last heartbeat:`,
    progress,
    ``,
    `Execute your heartbeat protocol IN THIS ORDER:`,
    `  1. Call mcp__hq__start_heartbeat.`,
    `  2. REVIEW PHASE: list_tasks(status="peer_review"), review eligible ones via submit_review.`,
    `  3. UNBLOCK PHASE: recheck blocked tasks if you have any.`,
    `  4. WORK PHASE: claim_task on a suitable todo, do the work, commit to branch`,
    `     agent/${ctx.agentName}/task-<id>, then submit_for_review.`,
    `  5. update_progress with a short summary.`,
    `  6. end_heartbeat. THIS MUST BE YOUR LAST TOOL CALL.`,
    ``,
    `Constraints:`,
    `  - Token budget this heartbeat: ${ctx.maxTokens}`,
    `  - Timeout: ${ctx.timeoutMinutes} min`,
    `  - You CANNOT modify files outside your worktree.`,
    `  - You CANNOT push branches; commit only.`,
    `  - On unrecoverable problem: report_blocked and stop.`,
  ].join('\n');
}

async function tryRead(path: string, fallback: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return fallback;
  }
}
