#!/usr/bin/env bun
/**
 * Standalone entry point for the MCP server that the E2E tests spawn. Mirrors
 * what `hq mcp --project X --agent Y` does but skips the commander plumbing
 * so the binary boots faster and has no extra deps.
 */
import { startMcpServer } from './server';

const args = process.argv.slice(2);
const project = valueOf('--project');
const agent = valueOf('--agent');
if (!project || !agent) {
  process.stderr.write('usage: cli-entry.ts --project <path> --agent <name>\n');
  process.exit(2);
}
await startMcpServer({ projectPath: project, agentName: agent });

function valueOf(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0 || idx === args.length - 1) return undefined;
  return args[idx + 1];
}
