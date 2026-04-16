# HQ

> Orchestrator for autonomous teams of Claude Code agents.

HQ runs a team of Claude Code agents on one or more local projects, like
a real team: workers that claim tasks, reviewers that check before merge,
a boss that plans from goals, and you approving the output. Agents message
each other, peer-review each other, and everything moves live in a local
web dashboard.

## Install

One command. Installs Bun, tmux, bubblewrap, clones the repo, compiles the
binary into `~/.local/bin/hq`:

```bash
curl -fsSL https://raw.githubusercontent.com/Teyk0o/hq/main/install.sh | bash
```

You still need the [Claude Code CLI](https://claude.com/claude-code) on
your PATH — HQ spawns it for every heartbeat.

## Try it

```bash
hq debug test --reset --agents alice:worker,bob:reviewer --tasks 5
hq daemon start
# open http://127.0.0.1:7433
```

Alice claims a task, Bob reviews it, the task goes to `review` and waits
for your approval in the UI. Click **Approve** then **Push** and it's out.

## Real project

```bash
cd ~/src/myproject
hq init                                      # scaffold .hq/
hq agent new alice --role worker
hq agent new bob   --role reviewer
hq task add "Refactor /users endpoint" --priority 2
hq daemon start
```

## Architecture

Six TypeScript / Bun packages:

| Package | Role |
|---|---|
| `@hq/core` | SQLite schema (Drizzle), task state machine, TOML parsers, rules engine |
| `@hq/mcp` | MCP server exposed to agents (16 tools) |
| `@hq/daemon` | Scheduler, tmux wrapper, bubblewrap sandbox, event triggers, webhooks, digest, backups |
| `@hq/usage` | Claude Max quota probe |
| `@hq/cli` | `hq` CLI for scaffolding and daemon lifecycle |
| `@hq/ui` | Web dashboard (Hono + HTMX + SSE + Tailwind) |

Each agent runs in a **persistent tmux session** with
`claude --dangerously-skip-permissions` inside a **bubblewrap** sandbox
constraining filesystem access. Claude Code consumes the `hq` MCP server
via `.mcp.json`, which writes directly to the project's SQLite DB. The
daemon listens on the event bus and wakes reviewers event-driven.

## Documentation

- **[docs/GUIDE.md](./docs/GUIDE.md)** — full human guide: concepts,
  CLI, configuration, roles, rules, daemon, integrations, admin, SOUL
  templates, troubleshooting, example 9-agent startup team
- **[docs/CLAUDE.md](./docs/CLAUDE.md)** — reference for Claude agents
  asked to set up HQ on a project (tool reference, protocol, recipes,
  team template)

## Dev

```bash
pnpm install
pnpm -r typecheck
pnpm test             # 104+ unit + e2e tests
pnpm build
pnpm build:bin        # compile a single binary to dist/hq
```

CI runs the same pipeline on every PR.
