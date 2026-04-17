<div align="center">

```
██╗  ██╗███████╗ █████╗ ██████╗  ██████╗ ██╗   ██╗ █████╗ ██████╗ ████████╗███████╗██████╗
██║  ██║██╔════╝██╔══██╗██╔══██╗██╔═══██╗██║   ██║██╔══██╗██╔══██╗╚══██╔══╝██╔════╝██╔══██╗
███████║█████╗  ███████║██║  ██║██║   ██║██║   ██║███████║██████╔╝   ██║   █████╗  ██████╔╝
██╔══██║██╔══╝  ██╔══██║██║  ██║██║▄▄ ██║██║   ██║██╔══██║██╔══██╗   ██║   ██╔══╝  ██╔══██╗
██║  ██║███████╗██║  ██║██████╔╝╚██████╔╝╚██████╔╝██║  ██║██║  ██║   ██║   ███████╗██║  ██║
╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═════╝  ╚══▀▀═╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝
```

**A local command center for autonomous Claude Code teams.**

[![CI](https://img.shields.io/github/actions/workflow/status/Teyk0o/hq/ci.yml?style=for-the-badge&logo=github-actions&logoColor=white&label=CI)](https://github.com/Teyk0o/hq/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/Teyk0o/hq?style=for-the-badge&logo=github&color=cc785c&logoColor=white)](https://github.com/Teyk0o/hq/stargazers)
[![Tests](https://img.shields.io/badge/tests-104%20passing-4b7f67?style=for-the-badge&logo=bun&logoColor=white)](./packages)

[![Claude](https://img.shields.io/badge/Claude-D97757?style=for-the-badge&logo=claude&logoColor=white)](https://claude.com/claude-code)
[![Bun](https://img.shields.io/badge/bun-282a36?style=for-the-badge&logo=bun&logoColor=fbf0df)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Hono](https://img.shields.io/badge/hono-E36002?style=for-the-badge&logo=hono&logoColor=white)](https://hono.dev)
[![SQLite](https://img.shields.io/badge/Sqlite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org)
[![Drizzle](https://img.shields.io/badge/drizzle-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black)](https://orm.drizzle.team)

[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![htmx](https://img.shields.io/badge/%3C/%3E%20htmx-3D72D7?style=for-the-badge&logo=mysl&logoColor=white)](https://htmx.org)
[![Zod](https://img.shields.io/badge/Zod-000000?style=for-the-badge&logo=zod&logoColor=3068B7)](https://zod.dev)
[![tmux](https://img.shields.io/badge/tmux-1BB91F?style=for-the-badge&logo=tmux&logoColor=white)](https://github.com/tmux/tmux)
[![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://www.kernel.org)

</div>

---

HeadQuarter (`hq`) runs a team of Claude Code agents on your local projects,
like a real team: **workers** claim tasks, **reviewers** check before merge,
a **boss** plans from goals, and you approve the output. Agents message
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

## Let Claude set it up for you

Open Claude Code in your project root and paste this prompt. Claude reads
the reference doc, asks the right questions about your team and repo,
then scaffolds `.hq/`, creates agents with real SOUL.md files, and
suggests `[[rules]]` tailored to your folder layout.

````markdown
I just installed HQ (HeadQuarter — https://github.com/Teyk0o/hq).
Set it up in this repo as my autonomous agent team.

First, read this reference end-to-end:
https://raw.githubusercontent.com/Teyk0o/hq/main/docs/CLAUDE.md

It has the 16-tool MCP reference, the heartbeat protocol, the do/don't
list, and a full 9-agent team template you can adapt.

Before running any command, ask me:
1. What shape of team fits my project (solo, pair, full, or custom — and
   which disciplines: backend, frontend, mobile, platform, design,
   marketing, QA, security, …).
2. Which folders each agent should own (`scope.packages`), mapped to the
   actual packages in this repo — don't invent any.
3. What goals I want to hit this week, so the boss (if any) has
   something to plan against.
4. Any paths that must be off-limits (lock files, .env, CI, secrets).

Then:
- Run `hq init` in the repo root.
- Create each agent with `hq agent new <name> --role <role>`.
- Write a real SOUL.md for every agent based on my answers — not the
  default placeholder. Use the templates in docs/GUIDE.md as a starting
  point and adapt voice, stack, and non-negotiables to my project.
- Edit `.hq/project.toml` to add `[[goals]]` and `[[rules]]` (ownership
  per package, protected paths, bash allow/deny lists).
- Print a short summary of what you set up, then tell me to start the
  daemon with `hq daemon start`.

Don't push any code. Don't start the daemon yourself. Just set it up.
````

If Claude doesn't have internet access in your setup, point it at the
local copy instead: `~/.local/share/hq/docs/CLAUDE.md` (installed by
`install.sh`).

## Or set it up by hand

```bash
cd ~/src/myproject
hq init                                      # scaffold .hq/
hq agent new boss  --role boss               # Opus: plans from goals
hq agent new alice --role worker             # Sonnet: claims & implements tasks
hq agent new bob   --role reviewer           # Sonnet: peer-reviews before merge
hq task add "Refactor /users endpoint" --priority 2
hq daemon start
# Agents start paused — click "Start agents" in the UI (http://127.0.0.1:7433)
```

Agents are created **paused** by default so you can review your setup before
the first heartbeat fires. Hit **Start agents** in the dashboard or run
`hq agent resume <name>` from the CLI.

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

Task branches follow the pattern `agent/<name>-task-<id>` (dash, not slash)
so they don't collide with the base worktree branch `agent/<name>`.

**Recommended models:** Opus for the boss (heavy planning), Sonnet for workers
and reviewers, Haiku for readonly/observer agents.

## Documentation

- **[docs/GUIDE.md](./docs/GUIDE.md)** — full human guide: concepts, CLI,
  configuration, roles, rules, daemon, integrations, admin, SOUL
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

---

<div align="center">

Made to be bossed around.

</div>
