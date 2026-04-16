# HQ

> Orchestrator for autonomous teams of Claude Code agents.

HQ runs a team of Claude Code agents on one or more local projects, like
a real team: workers that claim tasks, reviewers that check before merge,
a boss that plans from goals, and you approving the output. Agents message
each other, peer-review each other, and everything moves live in a local
web dashboard.

## Two-minute demo

```bash
# Prereqs: tmux, bubblewrap, bun ≥ 1.1, claude
sudo apt install -y tmux bubblewrap
curl -fsSL https://bun.sh/install | bash

# Ubuntu 24+ only: allow user namespaces for bwrap
echo "kernel.apparmor_restrict_unprivileged_userns = 0" \
  | sudo tee /etc/sysctl.d/60-userns.conf
sudo sysctl --system

# Install HQ from source
git clone <this-repo> && cd HQ && bun install
cd packages/cli && bun link

# Seed a demo project and launch the daemon
hq debug test --reset --agents alice:worker,bob:reviewer --tasks 5
hq daemon start
# Open http://127.0.0.1:7433
```

Alice claims a task, Bob reviews it, the task goes to `review` and waits
for your approval in the UI. You click **Approve** then **Push** and it's
out.

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

- **[docs/GUIDE.md](./docs/GUIDE.md)** — full human guide: install,
  concepts, CLI, configuration, roles, rules, daemon, integrations,
  admin, SOUL templates, troubleshooting
- **[docs/CLAUDE.md](./docs/CLAUDE.md)** — reference for Claude agents
  asked to set up HQ on a project (tool reference, protocol, recipes)
- **[ROADMAP.md](./ROADMAP.md)** — sprint status, MVP → v1

## Dev

```bash
pnpm install
pnpm -r typecheck
pnpm test             # 104+ unit + e2e tests
pnpm build
pnpm build:bin        # compile a single binary to dist/hq
```

CI runs the same pipeline on every PR.
