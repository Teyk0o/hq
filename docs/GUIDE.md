# HQ — Full Guide

HQ orchestrates teams of autonomous Claude Code agents on one or more local
projects. Each agent runs inside a persistent tmux session, wrapped in a
bubblewrap sandbox, and talks to an MCP server that writes straight to the
project's SQLite DB. You watch everything move in a local web dashboard at
`http://127.0.0.1:7433`.

This file is the single source of truth for humans: installation, concepts,
configuration, administration, debugging. SOUL.md templates are at the end.
For the companion doc aimed at Claude agents ("can you set up HQ on this
repo?"), see [`CLAUDE.md`](./CLAUDE.md).

---

## Table of contents

1. [Installation](#installation)
2. [Quickstart — 2 minutes](#quickstart--2-minutes)
3. [Concepts](#concepts)
4. [The `hq` CLI](#the-hq-cli)
5. [Configuration](#configuration)
6. [Roles & capabilities](#roles--capabilities)
7. [Rules & guardrails](#rules--guardrails)
8. [The daemon](#the-daemon)
9. [Integrations](#integrations)
10. [Administration](#administration)
11. [SOUL.md templates](#soulmd-templates)
12. [Troubleshooting](#troubleshooting)
13. [Dev & tests](#dev--tests)

---

## Installation

Requirements:

- **tmux ≥ 3.0** — persistent session per agent
- **bubblewrap (bwrap)** — per-agent filesystem sandbox
- **Bun ≥ 1.1** — runtime
- **Claude Code CLI** — available on `$PATH` (tmux sessions invoke it)

```bash
# Debian / Ubuntu
sudo apt install -y tmux bubblewrap
curl -fsSL https://bun.sh/install | bash

# Ubuntu 24.04+: allow user namespaces for bwrap
echo "kernel.apparmor_restrict_unprivileged_userns = 0" \
  | sudo tee /etc/sysctl.d/60-userns.conf
sudo sysctl --system

# HQ from sources
git clone <this-repo> && cd HQ
bun install
cd packages/cli && bun link      # exposes `hq` on your PATH
```

Or, once a compiled binary is published:

```bash
bun run build:bin
install -m0755 dist/hq ~/.local/bin/hq
```

---

## Quickstart — 2 minutes

```bash
# 1. Bootstrap a demo project (alice worker, bob reviewer, 5 seeded tasks)
hq debug test --reset --agents alice:worker,bob:reviewer --tasks 5

# 2. Start the daemon in a dedicated terminal
hq daemon start

# 3. Open http://127.0.0.1:7433
```

What you'll see: alice claims a task, works on it, pushes to `peer_review`,
bob reviews it, and the task advances to `review`. You click **Approve**
then **Push**; HQ pushes the branch and fires a Discord message if you have
the webhook configured.

For a real project:

```bash
cd ~/src/myproject
hq init                                          # scaffold .hq/
hq agent new lucas --role worker --gender male
hq agent new sandor --role reviewer --gender male
hq task add "Refactor /users endpoint" --priority 2 --package api
hq daemon start
```

---

## Concepts

### Project

A project is a git repo with a `.hq/` folder:

```
.hq/
  project.toml          # project config (goals, rules, quotas)
  db.sqlite             # single SQLite file holding everything
  agents/
    alice.toml          # agent config (role, scope, capabilities)
    alice.md            # SOUL.md — persistent system prompt
  soul/                 # (optional) shared SOULs
  worktrees/            # created on claim, destroyed after merge
  progress/
    alice.md            # auto-edited progress report (update_progress)
```

### Agent

An agent is defined by a `*.toml` + a `*.md` (SOUL). It has:

- a **role** (worker, reviewer, boss, readonly)
- **capabilities** derived from the role, overridable
- an optional **scope** (packages it's allowed to touch)
- an optional **budget** (tokens/heartbeat, tokens/day)
- a **SOUL** — its personality and domain rules

### Task

A task goes through this state machine:

```
backlog → todo → in_progress → peer_review → review → done
                                         ↓
                                     blocked
```

- `backlog` — draft created by a boss, not yet ready
- `todo` — claimable by an eligible worker
- `in_progress` — being worked, git branch created
- `peer_review` — submitted by the agent, waiting on one review
- `review` — peer-approved, waiting on human approval
- `done` — merged / pushed
- `blocked` — the agent flagged a blocker

### Heartbeat

An active agent's lifecycle: `start_heartbeat` → ... → `end_heartbeat`.
Everything in between is logged (timing, outcome, tokens, tasks touched).
The scheduler fires heartbeats on a fixed interval (default 15 min) and
staggers them (default 60 s) so the Claude instance isn't flooded.

### MCP server

The `hq` MCP server is the **only** contact point between Claude Code and
HQ. It exposes 16 tools over JSON-RPC on stdio. No direct SQL, no
cross-agent filesystem access. See [`CLAUDE.md`](./CLAUDE.md) for the
full tool reference with signatures.

---

## The `hq` CLI

```bash
# --- projects ---
hq init                               # scaffold .hq/ in the cwd
hq list                               # projects registered in ~/.hq/registry.toml
hq unregister <name>

# --- agents ---
hq agent new <name> --role worker --gender female
hq agent list
hq agent run <name>                   # trigger a manual heartbeat (debug)
hq agent attach <name>                # print the tmux attach command
hq agent pause <name>
hq agent resume <name>
hq agent archive <name>
hq agent restore <name>

# --- tasks ---
hq task add "Title" --priority 2 --package api --goal g1
hq task list [--status todo]
hq task show <id>
hq task unblock <id>

# --- daemon ---
hq daemon start                       # foreground + UI on :7433
hq daemon install-service             # systemd --user unit → ~/.config/systemd/user/hq.service
hq daemon status                      # systemctl is-active / is-enabled / status

# --- monitoring ---
hq usage                              # Claude Max snapshot (session + week)

# --- debug ---
hq debug reset --all                  # kill tmux, purge worktrees, wipe DBs
hq debug test --reset \
  --agents alice:worker,bob:reviewer \
  --tasks 5 \
  --interval 1                        # smoke fixture, heartbeat every minute

# --- internal hooks (not called by hand) ---
hq bash-gate                          # PreToolUse hook filtering Bash commands
hq rules-gate                         # PreToolUse hook enforcing [[rules]]
hq mcp --project <path> --agent <name>  # MCP server (invoked by Claude Code)
```

---

## Configuration

### Global — `~/.hq/config.toml`

```toml
[daemon]
ui_host = "127.0.0.1"
ui_port = 7433

[claude_usage]
poll_interval_minutes = 30
pause_threshold_pct = 85      # > 85% weekly usage → daemon pauses everyone
resume_threshold_pct = 70
```

### Project — `<project>/.hq/project.toml`

```toml
[project]
name = "myproject"
root = "."
default_model = "sonnet"       # opus | sonnet | haiku
default_branch = "main"

[scheduler]
interval_minutes = 15          # heartbeat tick rate
stagger_seconds = 60           # delay between agents launched on the same tick
max_concurrent_agents = 3
daily_token_budget = 0         # 0 = unlimited (on top of Claude quota)

[git]
branch_prefix = "agent/"       # branches become agent/<agent>/<task-id>
worktree_dir = ".hq/worktrees"

[kanban]
min_reviewers = 1              # approvals needed to move to review
require_lint_before_review = true
require_typecheck_before_review = true

[heartbeat]
default_timeout_minutes = 15
max_session_hours = 4          # hard cap — tmux killed after
retry_max = 2                  # timeouts tolerated before auto-blocked

[webhook]
discord_url = "https://discord.com/api/webhooks/..."
discord_events = [
  "task.created", "task.claimed", "task.status_changed",
  "task.reviewed", "task.blocked", "task.pushed",
  "agent.heartbeat_started", "agent.heartbeat_ended",
  "daemon.quota_paused", "daemon.quota_resumed",
  "message.sent",
]

[sandbox]
enabled = true                 # set false if bwrap is unavailable
share_net = true               # pass --share-net to bwrap (HTTPS, npm install...)
extra_binds = []               # extra RW binds (absolute paths)
extra_ro_binds = []            # extra read-only binds

[bash]
# Appended to the built-in defaults (see config/project.ts).
# allow_prefixes: commands allowed through the gate
# deny_patterns: regex blocked even when matching a prefix
allow_prefixes = ["docker compose "]
deny_patterns = ["rm -rf /"]

[[goals]]
id = "refactor-auth"
title = "Refactor auth module"
description = "..."
assignees = ["lucas", "morgane"]
tasks_per_week = 5             # boss must keep this pace
active = true

[[rules]]
id = "lock-files"
protected_paths = ["pnpm-lock.yaml", "package-lock.json"]

[[rules]]
id = "installer-untouchable"
match = "packages/installer/**"
action = "block"

[[rules]]
id = "core-owner"
match = "packages/core/**"
owner = "lucas"                # only lucas can write here

[[rules]]
id = "readonly-sandor"
agents = ["sandor"]
forbid_commands = ["curl .*\\| *sh", "dd if=", "mkfs"]
```

### Agent — `<project>/.hq/agents/<name>.toml`

```toml
[agent]
name = "lucas"
role = "worker"                # worker | reviewer | boss | readonly
model = "sonnet"               # overrides project default_model
soul = "lucas.md"              # path relative to .hq/agents/ or .hq/soul/
active = true
readonly_strict = false        # force-refuse every edit at the hook level
gender = "male"                # biases the Dicebear Notionists avatar

[capabilities]
# Fine-grained override; defaults depend on role
can_claim_tasks = true
can_review = true
can_promote_tasks = false
can_create_tasks = false
can_write_files = true
can_commit = true

[tools]
extra_allowed = []             # appended to the Claude Code whitelist
extra_denied = []

[scope]
packages = ["api", "core"]     # agent can only claim tasks tagged api or core

[budget]
max_tokens_per_heartbeat = 40000
max_tokens_per_day = 200000

[timeout]
heartbeat_minutes = 15
```

---

## Roles & capabilities

| Role | Defaults | Typical use |
|---|---|---|
| `worker` | claim, commit, review | Executes `todo` tasks |
| `reviewer` | review only | Validates worker output (no claims) |
| `boss` | create/promote tasks, review | Plans from goals, coordinates |
| `readonly` | read only | Audit, observation |

Exact per-role capabilities live in
`packages/core/src/domain/capabilities.ts`. Override per agent under
`[capabilities]` in the agent's `.toml`. The MCP refuses at the tool-call
layer, the rules-gate refuses at the Claude Code hook layer — defense in
depth.

---

## Rules & guardrails

Rules from `project.toml` compile to Claude Code `PreToolUse` hooks. Three
layers stack:

1. **Bash-gate**: every `Bash` call goes through `hq bash-gate` before
   executing. It accepts commands whose prefix matches
   `bash.allow_prefixes` and rejects those matching `bash.deny_patterns`.
   Every decision is audit-logged.
2. **Rules-gate**: every `Edit`/`Write`/`MultiEdit`/`NotebookEdit` goes
   through `hq rules-gate`. It applies the `[[rules]]` —
   `protected_paths`, `owner`, `match` glob, `agents`.
3. **Readonly strict**: if `agent.readonly_strict = true`, all edits are
   refused regardless of rules.

If `project.toml` is unreadable: **fail closed**. The gates reject
everything. Fix the TOML syntax with `hq task list`, which re-parses it;
if that crashes, the file is bad.

---

## The daemon

`hq daemon start` brings up:

- the **scheduler** cron (tick every `scheduler.interval_minutes`)
- the **quota poller** for Claude Max (every 30 min by default)
- the **reaper** for tmux sessions orphaned by a previous run
- the **event triggers** (wake an idle reviewer the moment a `peer_review`
  lands, instead of waiting for the next tick)
- the per-project **Discord webhooks**
- the **daily digest** (summary embed at 21:00 for each project with a webhook)
- the **daily backup** — registry + every project DB → `~/.hq/backups/YYYY-MM-DD/`
- the **web UI** on `ui_host:ui_port`

To run it in the background:

```bash
hq daemon install-service     # systemd --user
systemctl --user daemon-reload
systemctl --user enable --now hq
hq daemon status
```

Logs land in `~/.hq/daemon.log`.

---

## Integrations

### Discord webhooks

Configure under `project.toml [webhook]`. HQ posts a coloured embed on
every event listed in `discord_events`. At 21:00 local, a daily digest
summarises shipped/blocked + top agents + tokens.

### Claude Code hooks

`hq init` writes `PreToolUse` hooks to `.claude/settings.local.json`
pointing at `hq bash-gate` and `hq rules-gate`. `.mcp.json` declares the
`hq` server with the correct project path and agent name.
`preApproveTrust()` writes to `~/.claude.json` so no trust dialog blocks
a non-interactive heartbeat.

### Claude Max quota

`hq usage` (and the internal poller) reads `~/.claude/session` via a tmux
probe and falls back on `ccusage` when unavailable. When weekly usage
exceeds `pause_threshold_pct` (default 85 %), the daemon pauses everyone
and emits `daemon.quota_paused`. Back under `resume_threshold_pct`
(70 %), it emits `daemon.quota_resumed`.

---

## Administration

### Backups

`~/.hq/backups/YYYY-MM-DD/` is populated each day at 02:00 local:
- `registry.sqlite` — copy of the global registry
- `<project>/db.sqlite` — copy of each project DB

Backups older than 30 days are pruned automatically.

### Audit log

Every MCP call lands in the `activity` table with:
- `agent`, `action` (`mcp.<tool>` or `mcp.<tool>.error`)
- `task_id` when extractable
- `details` — JSON of the input (truncated at 1 KB)

Visible in the UI under "Activity" or via direct SQL on `db.sqlite`.

### Schema migrations

The schema is versioned in `meta.schema_version`. On every
`openProjectDb`, ordered migrations in
`packages/core/src/db/client.ts` are applied additively. No manual
action needed: opening an old DB with a newer HQ build migrates it
silently.

### UI hot reload (dev)

```bash
cd /path/to/HQ
bun --watch packages/cli/src/bin.ts daemon start
```

The process restarts in under a second. The browser reconnects its SSE
channel on its own.

---

## SOUL.md templates

A `SOUL.md` is the system prompt injected verbatim at the start of every
heartbeat. **Golden rule**: the agent reads its SOUL every heartbeat **in
isolation**. Any ambiguity gets amplified. Be explicit.

### Worker — backend

```md
# lucas — backend worker

You are Lucas, owner of the NestJS backend (packages/api/ and packages/core/).
You know TypeORM, PostgreSQL, and the Flowly patterns.

Non-negotiable rules:
- Never touch packages/installer/ or ci/ (you don't have the right)
- Never edit pnpm-lock.yaml (rule-protected)
- Always run `pnpm -F flowly-api typecheck` before submit_for_review
- Commits in English, conventional-commits format

Heartbeat protocol:
  1. mcp__hq__start_heartbeat
  2. mcp__hq__read_messages — handle @mentions first (changes_requested)
  3. mcp__hq__list_tasks(status="todo", assignee=null)
     Only claim tasks whose package is "api" or "core".
  4. mcp__hq__claim_task
  5. Read files, edit, run tests, commit
  6. mcp__hq__submit_for_review with a one-line summary
  7. mcp__hq__update_progress
  8. mcp__hq__end_heartbeat
```

### Reviewer — devil's advocate

```md
# sandor — devil's advocate

You are Sandor, the cynical reviewer. Your job is to stop bad work from
landing. You read every diff with suspicion. You look for:
  - untested edge cases
  - undeclared dependencies
  - undocumented behaviour changes
  - potential regressions

You NEVER approve a task out of politeness. Asking for clarification
beats rubber-stamping something fuzzy.

Protocol:
  1. mcp__hq__start_heartbeat
  2. mcp__hq__read_messages
  3. mcp__hq__list_tasks(status="peer_review")
  4. For each task where you are not the author:
     - git log on the branch
     - git show --stat for impact
     - git diff to read the code
     - submit_review with verdict approved OR changes_requested
     - If changes_requested, send_message to the author with precise feedback
  5. update_progress + end_heartbeat
```

### Boss — planner

```md
# morgane — CTO / team lead

You are Morgane, the tech lead. You don't code. You plan and coordinate.
You have access to the project goals and must keep the backlog flowing.

Your responsibilities:
  - Break goals into concrete, actionable tasks
  - Prioritise: P1 blocker, P2 important, P3 normal, P4-5 opportunistic
  - Wake a worker when their task is urgent (send_message)
  - Unblock stuck agents (read their blocked_reason, comment on the task)

Protocol:
  1. mcp__hq__start_heartbeat
  2. read_messages — pick up human requests or blockers
  3. For each active goal under-quota this week:
     - create_task with a sharp description (title + acceptance criteria)
     - promote_task to move it to todo
     - If the task targets a specific worker, send_message to notify them
  4. list_tasks(status="blocked") — help unblock
  5. list_tasks(status="peer_review") — you can review too
  6. update_progress + end_heartbeat
```

### Readonly — auditor

```md
# thomas — QA / auditor

You observe the project without modifying anything. You check
consistency, comment on problematic tasks, spot regressions.

You cannot:
  - claim, edit files, commit, review
You can:
  - list_tasks, get_task, add_comment, send_message

Protocol:
  1. start_heartbeat
  2. read_messages
  3. For each recently-moved task:
     - get_task + read the branch diff
     - If you spot a problem, add_comment with @mention of the author
  4. update_progress with a summary of your observations
  5. end_heartbeat
```

### Writing tips

- **Be concrete about the domain**: "you own packages/api/" beats
  "you are a backend engineer"
- **List non-negotiable rules first**: they stick better
- **Give commit / test patterns**: the agent will follow them
- **Don't over-hardcode**: structural rules belong in
  `project.toml [[rules]]` (enforced); SOUL is for judgement calls
- **Re-read after a run**: if the agent misread, tweak the SOUL — changes
  take effect on the next heartbeat (hot reload)

---

## Troubleshooting

### bwrap: "setting up uid map: Permission denied"

Ubuntu 24+ restricts user namespaces via AppArmor. Fix:

```bash
echo "kernel.apparmor_restrict_unprivileged_userns = 0" \
  | sudo tee /etc/sysctl.d/60-userns.conf
sudo sysctl --system
```

### bwrap: "Can't chdir"

The worktree bind is being masked by a later `--tmpfs /tmp`. Check the
mount order in `packages/daemon/src/sandbox.ts`. If it recurs,
`hq debug reset --all` then re-trigger.

### Claude TUI stays blank in tmux

A few possible causes:

1. Pane too small (default 80×24) — we force 200×50 via `-x -y`
2. Trust dialog never accepted — `preApproveTrust()` writes `~/.claude.json`
3. `.mcp.json` present but the server isn't enabled —
   `enabledMcpjsonServers: ["hq"]` is written automatically
4. `~/.claude.json` not writable inside the sandbox — explicit bind added

If one of these still hits: `hq debug reset --all && hq debug test --reset`.

### "Cannot find module 'react/jsx-dev-runtime'"

Bun doesn't read `jsxImportSource` from your tsconfig at runtime. The
`bunfig.toml` at the repo root forces `jsx = "react-jsx"` +
`jsxImportSource = "hono/jsx"`. Run HQ from the repo root, not from a
subdirectory.

### Agent stuck in `working` doing nothing

The reaper timeout (default 15 min) will flip it back to `idle`. To go
faster, set `project.toml`:
`heartbeat.default_timeout_minutes = 5`. After `retry_max + 1` timeouts,
the agent is auto-moved to `blocked`.

### Paused agent flips back to `working`

Fixed: the scheduler now guards the `paused` status and `end_heartbeat`
only flips to `idle` when the agent was `working`. If you still see it on
an older install, upgrade.

### Rules engine refuses everything

Fail-closed when `project.toml` is unreadable. Check TOML syntax with
`hq task list`, which re-parses it; fix whatever crashes.

### Discord digest not firing at 21:00

Check:
- `webhook.discord_url` is non-empty in `project.toml`
- daemon is running (`hq daemon status`)
- `~/.hq/daemon.log` for POST errors

The digest stays silent on days with zero activity.

### Claude Max quota: repeated `daemon.quota_paused`

The poller only emits on **transition**, not per tick. If you see
repeats, restart the daemon to reset its internal state.

---

## Dev & tests

```bash
pnpm install
pnpm -r typecheck
pnpm test                           # 104+ tests (unit + e2e)
pnpm build                          # all packages
pnpm build:bin                      # compile a single dist/hq binary
```

E2E tests (in `packages/mcp/test/`) spawn the real MCP server as a
subprocess per scenario and assert SQLite state after every step. No
mocks, no tmux, no claude — they cover the contract agents actually
consume.

CI GitHub Actions (`.github/workflows/ci.yml`) runs the same pipeline on
every PR.
