/**
 * Minimal JSON-RPC client talking to an MCP server over stdio. We don't pull
 * in @modelcontextprotocol/sdk's client (it's nice but adds dependencies to
 * the test bundle); our server only needs initialize + tools/call, so a
 * hand-rolled newline-delimited JSON-RPC driver is plenty and lets us
 * assert error envelopes directly.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface McpClient {
  initialize: () => Promise<unknown>;
  call: (tool: string, args?: Record<string, unknown>) => Promise<ToolResult>;
  close: () => Promise<void>;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; details?: unknown };
  raw: unknown;
}

export async function startMcpClient(
  command: string,
  args: string[],
): Promise<McpClient> {
  const proc = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });
  let nextId = 1;
  const pending = new Map<number, (value: unknown) => void>();
  let buffer = '';

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
          if (typeof msg.id === 'number' && pending.has(msg.id)) {
            pending.get(msg.id)!(msg);
            pending.delete(msg.id);
          }
        } catch {
          // non-JSON log line, ignore
        }
      }
      newline = buffer.indexOf('\n');
    }
  });

  const send = <T,>(method: string, params: unknown): Promise<T> => {
    const id = nextId++;
    return new Promise<T>((resolve) => {
      pending.set(id, resolve as (v: unknown) => void);
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  };

  return {
    initialize: () =>
      send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '0.0.0' },
      }),
    call: async (tool, args = {}) => {
      const response = (await send('tools/call', {
        name: tool,
        arguments: args,
      })) as { result?: { content: Array<{ type: string; text?: string }> }; error?: unknown };
      const textBlock = response.result?.content?.find((c) => c.type === 'text');
      if (!textBlock?.text) {
        return { ok: false, error: { code: 'no_content', message: 'no text' }, raw: response };
      }
      const parsed = JSON.parse(textBlock.text) as ToolResult;
      return { ...parsed, raw: response };
    },
    close: async () => {
      proc.stdin.end();
      proc.kill();
      await new Promise<void>((r) => proc.on('close', () => r()));
    },
  };
}

export { spawn };
export type { ChildProcessWithoutNullStreams };
