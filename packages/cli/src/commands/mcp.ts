import { startMcpServer } from '@hq/mcp';

export async function mcpCommand(opts: { project: string; agent: string }): Promise<void> {
  await startMcpServer({ projectPath: opts.project, agentName: opts.agent });
}
