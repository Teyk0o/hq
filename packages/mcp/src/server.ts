import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  loadAgentConfig,
  loadProjectConfig,
  openProjectDb,
  resolveCapabilities,
} from '@hq/core';
import { z } from 'zod';
import { getSharedBus } from './bus';
import type { McpContext } from './context';
import * as heartbeat from './tools/heartbeat';
import * as reviews from './tools/reviews';
import * as taskTools from './tools/tasks';
import * as team from './tools/team';

export interface StartServerOptions {
  projectPath: string;
  agentName: string;
}

type ToolHandler = (ctx: McpContext, input: unknown) => Promise<unknown>;

interface ToolSpec {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: ToolHandler;
}

const tools: ToolSpec[] = [
  {
    name: 'start_heartbeat',
    description: 'Mark yourself as working. Must be the first call of a heartbeat.',
    schema: z.object({}),
    handler: (ctx) => heartbeat.startHeartbeat(ctx),
  },
  {
    name: 'end_heartbeat',
    description:
      'Mark yourself idle and persist a short progress summary. MUST be the last tool call of a heartbeat.',
    schema: z.object({ summary: z.string().optional(), tokens_used: z.number().optional() }),
    handler: (ctx, input) =>
      heartbeat.endHeartbeat(ctx, input as { summary?: string; tokens_used?: number }),
  },
  {
    name: 'update_progress',
    description: 'Replace the PROGRESS.md content for this agent.',
    schema: z.object({ body: z.string() }),
    handler: (ctx, input) => heartbeat.updateProgress(ctx, input as { body: string }),
  },
  {
    name: 'list_tasks',
    description: 'List tasks with optional filters (status, assignee, goal_id).',
    schema: z.object({
      status: z.string().optional(),
      assignee: z.string().nullable().optional(),
      goal_id: z.string().optional(),
      limit: z.number().optional(),
    }),
    handler: (ctx, input) => taskTools.listTasks(ctx, input as taskTools.ListTasksInput),
  },
  {
    name: 'get_task',
    description: 'Fetch a task with its comments and reviews.',
    schema: z.object({ id: z.string() }),
    handler: (ctx, input) => taskTools.getTask(ctx, input as { id: string }),
  },
  {
    name: 'claim_task',
    description: 'Assign yourself a task and move it to in_progress.',
    schema: z.object({ id: z.string() }),
    handler: (ctx, input) => taskTools.claimTask(ctx, input as { id: string }),
  },
  {
    name: 'submit_for_review',
    description: 'Move your task from in_progress to peer_review.',
    schema: z.object({ id: z.string(), summary: z.string().optional() }),
    handler: (ctx, input) =>
      taskTools.submitForReview(ctx, input as { id: string; summary?: string }),
  },
  {
    name: 'report_blocked',
    description: 'Flag a task as blocked with a reason.',
    schema: z.object({ id: z.string(), reason: z.string() }),
    handler: (ctx, input) => taskTools.reportBlocked(ctx, input as { id: string; reason: string }),
  },
  {
    name: 'create_task',
    description: 'Create a new task in backlog (requires can_create_tasks).',
    schema: z.object({
      title: z.string(),
      description: z.string().optional(),
      goal_id: z.string().optional(),
      assignee: z.string().optional(),
      priority: z.number().optional(),
      package: z.string().optional(),
    }),
    handler: (ctx, input) => taskTools.createTask(ctx, input as taskTools.CreateTaskInput),
  },
  {
    name: 'promote_task',
    description: 'Move a task from backlog to todo (requires can_promote_tasks).',
    schema: z.object({ id: z.string() }),
    handler: (ctx, input) => taskTools.promoteTask(ctx, input as { id: string }),
  },
  {
    name: 'submit_review',
    description: 'Submit a peer review with verdict approved or changes_requested.',
    schema: z.object({
      id: z.string(),
      verdict: z.enum(['approved', 'changes_requested']),
      body: z.string(),
    }),
    handler: (ctx, input) => reviews.submitReview(ctx, input as reviews.SubmitReviewInput),
  },
  {
    name: 'add_comment',
    description: 'Add a comment to a task, optionally with @mentions.',
    schema: z.object({
      task_id: z.string(),
      body: z.string(),
      mentions: z.array(z.string()).optional(),
    }),
    handler: (ctx, input) =>
      reviews.addComment(
        ctx,
        input as { task_id: string; body: string; mentions?: string[] },
      ),
  },
  {
    name: 'list_teammates',
    description: 'List all teammates with their current status.',
    schema: z.object({}),
    handler: (ctx) => team.listTeammates(ctx),
  },
  {
    name: 'send_message',
    description: 'Send a direct message to a teammate (or "*" to broadcast).',
    schema: z.object({
      to: z.string(),
      subject: z.string().optional(),
      body: z.string(),
    }),
    handler: (ctx, input) =>
      team.sendMessage(ctx, input as { to: string; subject?: string; body: string }),
  },
  {
    name: 'read_messages',
    description: 'Read your inbox. Messages are auto-marked as read.',
    schema: z.object({ unread_only: z.boolean().optional() }),
    handler: (ctx, input) => team.readMessages(ctx, input as { unread_only?: boolean }),
  },
  {
    name: 'log_activity',
    description: 'Emit a free-form activity log entry.',
    schema: z.object({
      action: z.string(),
      details: z.record(z.unknown()).optional(),
    }),
    handler: (ctx, input) =>
      team.logActivity(ctx, input as { action: string; details?: Record<string, unknown> }),
  },
];

const toolByName = new Map(tools.map((t) => [t.name, t] as const));

export async function startMcpServer(options: StartServerOptions): Promise<void> {
  const hqDir = join(options.projectPath, '.hq');
  const project = await loadProjectConfig(join(hqDir, 'project.toml'));
  const agent = await loadAgentConfig(join(hqDir, 'agents', `${options.agentName}.toml`));
  const db = openProjectDb(join(hqDir, 'db.sqlite'));

  const ctx: McpContext = {
    projectPath: options.projectPath,
    projectName: project.project.name,
    agentName: agent.agent.name,
    agentRole: agent.agent.role,
    capabilities: resolveCapabilities(agent.agent.role, agent.capabilities),
    db,
    bus: getSharedBus(),
    currentHeartbeatId: null,
    tasksWorkedThisHeartbeat: new Set(),
  };

  const server = new Server(
    { name: 'hq', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolByName.get(request.params.name);
    if (!tool) throw new Error(`Unknown tool: ${request.params.name}`);
    const parsed = tool.schema.parse(request.params.arguments ?? {});
    const result = await tool.handler(ctx, parsed);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Minimal Zod → JSON Schema for MCP tool descriptors. Enough for what we expose.
 * We avoid pulling in zod-to-json-schema to keep deps small; the MCP SDK only
 * needs a best-effort schema for tool discovery.
 */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, val] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(val);
      if (!val.isOptional()) required.push(key);
    }
    return {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
    };
  }
  if (schema instanceof z.ZodString) return { type: 'string' };
  if (schema instanceof z.ZodNumber) return { type: 'number' };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: zodToJsonSchema(schema.element) };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: schema.options };
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return zodToJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodRecord) return { type: 'object' };
  return {};
}
