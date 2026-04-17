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
7. [Example team — 9-agent SaaS startup](#example-team--9-agent-saas-startup)
8. [Rules & guardrails](#rules--guardrails)
9. [The daemon](#the-daemon)
10. [Integrations](#integrations)
11. [Administration](#administration)
12. [SOUL.md templates](#soulmd-templates)
13. [Troubleshooting](#troubleshooting)
14. [Dev & tests](#dev--tests)

---

## Installation

One command. Installs Bun, tmux, bubblewrap, clones HQ, compiles the
binary into `~/.local/bin/hq`, and fixes the Ubuntu 24+ user-namespace
tweak if needed:

```bash
curl -fsSL https://raw.githubusercontent.com/Teyk0o/hq/main/install.sh | bash
```

You still need the [Claude Code CLI](https://claude.com/claude-code) on
your PATH — HQ spawns it for every heartbeat. The installer warns if
it's missing.

### What it installs

- **Bun ≥ 1.1** — runtime (via the official installer if missing)
- **tmux ≥ 3.0** — persistent session per agent (apt / dnf / brew)
- **bubblewrap (bwrap)** — per-agent filesystem sandbox (Linux only)
- **HQ** itself — cloned into `~/.local/share/hq`, compiled into
  `~/.local/bin/hq`

### Overrides

```bash
HQ_DIR=~/code/hq HQ_REF=dev bash <(curl -fsSL .../install.sh)
```

- `HQ_DIR` — where to clone (default `~/.local/share/hq`)
- `HQ_REF` — git ref to check out (default `main`)

### From a local clone

```bash
cd HQ
./install.sh
```

The script is idempotent — re-running it updates HQ in place.

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
default_model = "sonnet"       # sonnet is a good default; see model selection below
default_branch = "main"

[scheduler]
interval_minutes = 15          # heartbeat tick rate
stagger_seconds = 60           # delay between agents launched on the same tick
max_concurrent_agents = 3
daily_token_budget = 0         # 0 = unlimited (on top of Claude quota)

[git]
branch_prefix = "agent/"       # branches become agent/<agent>-task-<id>
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
# Merged with the built-in defaults (see config/project.ts).
# allow_prefixes: extra commands to allow (added on top of the built-ins)
# deny_patterns: regex blocked even when matching an allowed prefix
allow_prefixes = ["cargo "]
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
model = "sonnet"               # opus (boss) | sonnet (worker/reviewer) | haiku (readonly)
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

**The 4 roles are capability buckets, not job titles.** You have as many
*kinds* of agents as you want: backend, frontend, DevOps, content,
security — all of those are still one of the 4 roles underneath. The
specialty comes from three places, not from the `role` field:

1. **`scope.packages`** in `agent.toml` — which packages the agent may
   claim and touch (`["api", "core"]` = backend; `["dashboard", "website"]`
   = frontend; `["installer", "plugin-server"]` = platform).
2. **`SOUL.md`** — the persistent system prompt: identity, expertise,
   stack, conventions, review style.
3. **`[[rules]] owner`** in `project.toml` — hard enforcement of
   ownership on specific paths.

| Role | Defaults | What it controls | Recommended model |
|---|---|---|---|
| `worker` | claim, commit, review | Can pick up and finish tasks | `sonnet` |
| `reviewer` | review only | Can peer-review, cannot claim | `sonnet` |
| `boss` | create/promote tasks, review | Can plan and shape the backlog | `opus` |
| `readonly` | read only | Can observe, comment, message — never writes | `haiku` |

**Model selection by role** — set `model` in `agent.toml` to override the project default:

- **`opus`** — reserve for the boss. Planning, goal decomposition, and backlog management benefit from Opus's reasoning depth. One boss per project means one Opus session at a time, keeping cost manageable.
- **`sonnet`** — the right default for workers and reviewers. Strong enough to write, refactor, and review production code; cost-effective at scale.
- **`haiku`** — use for readonly agents (auditors, observers). They only read and comment, so Sonnet's full capacity is wasted on them. Haiku handles the load at a fraction of the cost.

Exact per-role capabilities live in
`packages/core/src/domain/capabilities.ts`. Override per agent under
`[capabilities]` in `agent.toml`. The MCP refuses at the tool-call layer,
the rules-gate refuses at the Claude Code hook layer — defense in depth.

> **Pattern**: if a "senior backend engineer" and a "senior frontend
> engineer" both ship code, they are both `role = "worker"`. What makes
> them different is their scope, their SOUL, and the `[[rules]] owner`
> entries pointing at them.

---

## Example team — 9-agent SaaS startup

Meet **Atlas**, a fictional B2B collaboration product (think a small
Linear / Notion hybrid). The repo layout and team below are generic —
rename agents, remap `scope.packages` to your folders, and you're set.

### Repo layout

```
apps/
  web/          # main dashboard — Next.js
  mobile/       # iOS + Android — React Native
  marketing/    # landing, pricing, blog — Next.js
packages/
  api/          # backend REST API
  db/           # schema + migrations
  ui/           # shared design system
design/         # Figma exports, brand assets, copy decks
infra/          # terraform, k8s manifests, CI jobs
```

### Org chart

```
                           nora  (boss — CTO + PM)
                           plans goals, routes tasks
                                     │
   ┌──────────┬──────────┬───────────┼───────────┬──────────┬──────────┐
   │          │          │           │           │          │          │
  alex      sofia      kenji       mira        iris        zoe       
 worker    worker     worker      worker      worker      worker
 backend  frontend    mobile     platform    product     marketing
 (api,     (apps/     (apps/     (infra)    designer    / content
  db)      web,       mobile)                (design,   (apps/
           ui)                                ui)       marketing)
   │          │          │           │           │          │
   └──────────┴──────────┴─────┬─────┴───────────┴──────────┘
                               │
                  ┌────────────┴────────────┐
                  │                         │
                sandor                   thomas
               reviewer                  readonly
            devil's advocate            QA auditor
```

Four tiers, nine agents:

- **Leadership** — `nora` (boss) plans goals → tasks, routes via
  `send_message`, unblocks.
- **Engineering** — `alex`, `sofia`, `kenji`, `mira` are all `worker`s
  with disjoint scopes. They ship code.
- **Design & Marketing** — `iris` and `zoe` are also `worker`s. Iris
  edits Figma exports, design tokens, and UI component specs. Zoe
  writes landing copy, blog posts, and SEO metadata. They don't touch
  backend or mobile code.
- **Quality** — `sandor` reviews every peer_review diff with suspicion.
  `thomas` watches silently, comments when he smells a regression.

Notice that `iris` and `zoe` use the same underlying `role = "worker"`
as the engineers — the **specialty is the SOUL + the scope**, not the
role. You could add a `security-priya` or an `sre-kenji` the same way.

### `project.toml` excerpts

```toml
[project]
name = "atlas"
default_branch = "main"

[[goals]]
id = "ship-mobile-v1"
title = "Ship mobile app v1 (iOS + Android public beta)"
assignees = ["kenji", "iris", "alex"]
tasks_per_week = 5
active = true

[[goals]]
id = "signup-conversion"
title = "Improve signup funnel conversion by 20%"
assignees = ["sofia", "zoe", "iris"]
tasks_per_week = 4
active = true

[[goals]]
id = "soc2-readiness"
title = "Pre-SOC2 security hardening"
assignees = ["alex", "mira"]
tasks_per_week = 3
active = true

[[goals]]
id = "design-system-v2"
title = "Refresh design tokens + migrate core components"
assignees = ["iris", "sofia"]
tasks_per_week = 3
active = true

# Ownership — hard-enforced at the rules-gate layer.
[[rules]]
id = "backend-owner"
match = "packages/{api,db}/**"
owner = "alex"

[[rules]]
id = "web-owner"
match = "apps/web/**"
owner = "sofia"

[[rules]]
id = "mobile-owner"
match = "apps/mobile/**"
owner = "kenji"

[[rules]]
id = "platform-owner"
match = "infra/**"
owner = "mira"

[[rules]]
id = "marketing-owner"
match = "apps/marketing/**"
owner = "zoe"

[[rules]]
id = "design-owner"
match = "design/**"
owner = "iris"

# packages/ui is shared territory — sofia and iris both edit it.
# No owner rule; instead both have "ui" in their scope.packages.

[[rules]]
id = "ci-owner"
match = ".github/**"
owner = "mira"

[[rules]]
id = "lock-files"
protected_paths = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]

[[rules]]
id = "secrets-forbidden"
match = "**/.env*"
action = "block"
```

### Agent configs

**nora — CTO + PM (boss)**

```toml
# .hq/agents/nora.toml
[agent]
name = "nora"
role = "boss"
soul = "nora.md"
model = "opus"                 # boss: Opus for planning depth
gender = "female"
```

```md
# .hq/agents/nora.md
# nora — CTO + PM

You run the product and the team. You don't write code. Your six direct
reports: alex (backend), sofia (web), kenji (mobile), mira (platform),
iris (product designer), zoe (marketing).

Weekly rhythm:
- Keep every active goal above its `tasks_per_week` target
- Break goals into tasks with sharp titles + 2-3 acceptance criteria
- Route every new task to the right assignee via send_message
- Mondays: list_tasks(status="blocked") and help unblock
- Fridays: list_tasks(status="done") and celebrate shipped work in
  a broadcast message

Priority scale:
- P1: blocks revenue, customers, or shipped-goal commitments
- P2: on-roadmap feature
- P3: quality-of-life, tech debt
- P4-5: opportunistic polish

Protocol:
  1. start_heartbeat
  2. read_messages — triage human input first
  3. For each active, under-quota goal:
     - create_task with acceptance criteria
     - promote_task → todo
     - send_message(to=assignee) with a one-line brief
  4. list_tasks(status="blocked") → comment / reassign
  5. list_tasks(status="peer_review") — you can review too
  6. update_progress + end_heartbeat
```

**alex — backend engineer**

```toml
# .hq/agents/alex.toml
[agent]
name = "alex"
role = "worker"
soul = "alex.md"
model = "sonnet"
gender = "neutral"

[scope]
packages = ["api", "db"]

[budget]
max_tokens_per_heartbeat = 60000
```

```md
# .hq/agents/alex.md
# alex — senior backend engineer

You own packages/api/ (REST API) and packages/db/ (schema + migrations).
You think in idempotent migrations, bounded response times, and
observable failure modes.

Non-negotiable:
- Every schema change ships as a new migration — never mutate an
  existing one, never hot-patch prod
- Every new endpoint gets integration tests against a real DB
- Authn / authz changes require @sandor in send_message before merging
- Never touch apps/web/, apps/mobile/, or infra/
- Run the package's typecheck + tests before submit_for_review
- Conventional Commits, English, imperative mood

Heartbeat protocol:
  1. start_heartbeat
  2. read_messages — triage @mentions and changes_requested first
  3. list_tasks(status="todo", assignee=null) filter package ∈ {api, db}
  4. claim_task → read, edit, test, commit
  5. submit_for_review with one-line summary
  6. update_progress + end_heartbeat
```

**sofia — frontend web engineer**

```toml
# .hq/agents/sofia.toml
[agent]
name = "sofia"
role = "worker"
soul = "sofia.md"
model = "sonnet"
gender = "female"

[scope]
packages = ["web", "ui"]       # ui is shared with iris
```

```md
# .hq/agents/sofia.md
# sofia — senior frontend web engineer

You own apps/web/ and co-own packages/ui/ with iris (she defines the
design tokens and visuals; you implement the components). You care
about perceived performance, a11y, and pixel-correct realisation of
Iris's specs.

Non-negotiable:
- React Server Components by default, Client only when state demands it
- Tailwind only — no styled-components, no CSS modules
- Every Client Component has a data-testid for E2E
- Icons: whatever packages/ui exports, don't introduce new sets
- Never touch apps/mobile, packages/api, packages/db, infra
- When editing packages/ui, @mention iris in the PR body
- Run package typecheck before submit_for_review

Protocol:
  1. start_heartbeat
  2. read_messages — iris's design briefs first
  3. list_tasks(status="todo") filter package ∈ {web, ui}
  4. claim → edit → preview locally → commit
  5. submit_for_review
  6. update_progress + end_heartbeat
```

**kenji — mobile engineer**

```toml
# .hq/agents/kenji.toml
[agent]
name = "kenji"
role = "worker"
soul = "kenji.md"
model = "sonnet"
gender = "male"

[scope]
packages = ["mobile"]
```

```md
# .hq/agents/kenji.md
# kenji — mobile engineer

You own apps/mobile/ (React Native, shared codebase iOS + Android).
You're fluent in platform-specific quirks (SafeArea, keyboard insets,
permission prompts, background tasks).

Non-negotiable:
- Any native module change must include both platforms in the same PR
- Test on a real device (or at least a simulator for each platform)
  before submit_for_review
- API calls go through the shared SDK in packages/api client; never
  hit the REST endpoints directly from components
- Accessibility labels on every interactive element
- Never touch apps/web, packages/api server code

Protocol:
  1. start_heartbeat
  2. read_messages
  3. list_tasks(status="todo") filter package == "mobile"
  4. claim → edit → run on sim → commit
  5. submit_for_review — note which platforms you smoke-tested
  6. update_progress + end_heartbeat
```

**mira — platform / DevOps**

```toml
# .hq/agents/mira.toml
[agent]
name = "mira"
role = "worker"
soul = "mira.md"
model = "sonnet"
gender = "female"

[scope]
packages = ["infra"]

[capabilities]
can_review = true              # infra changes affect every team
```

```md
# .hq/agents/mira.md
# mira — platform / devops

You own infra/ (terraform, k8s, CI/CD pipelines, observability). You
also maintain .github/ workflows. You think in blast radius, rollback
paths, and cost per request.

Non-negotiable:
- Terraform plan is reviewed by sandor before apply — always
- No `apply` to prod without a rollback note in the PR description
- CI changes are tested on a branch before merging
- Never hard-code secrets anywhere; use the configured secrets manager
- If infra change breaks a teammate, send_message them immediately

Protocol:
  1. start_heartbeat
  2. read_messages — infra incidents trump features
  3. list_tasks(status="todo") filter package == "infra" or path ~ ".github/"
  4. claim → plan → review plan → apply on staging → commit
  5. submit_for_review with a "what could this break" paragraph
  6. update_progress + end_heartbeat
```

**iris — product designer**

```toml
# .hq/agents/iris.toml
[agent]
name = "iris"
role = "worker"
soul = "iris.md"
model = "sonnet"
gender = "female"

[scope]
packages = ["design", "ui", "marketing"]   # design system + brand assets

[capabilities]
# Iris edits design tokens and copy; she rarely needs heavy Bash
can_commit = true
```

```md
# .hq/agents/iris.md
# iris — product designer

You own design/ (Figma exports, brand assets, icon system, copy decks)
and co-own packages/ui/ with sofia (you define tokens, she implements).
You also contribute art direction + imagery for apps/marketing.

Non-negotiable:
- Design tokens live in packages/ui/tokens/ and are the source of truth
- Every new component ships with a Figma link in its README
- Never change a design token without an @mention of sofia — she owns
  the component implementations that depend on it
- Marketing copy lands in design/copy/ as .md; zoe wires it into
  apps/marketing/
- No raster assets without @2x and @3x in design/exports/

Protocol:
  1. start_heartbeat
  2. read_messages — nora's priorities, sofia's implementation feedback
  3. list_tasks(status="todo") filter package ∈ {design, ui, marketing}
     (for ui: token changes only; component code is sofia's)
  4. claim → edit tokens / export assets / write copy → commit
  5. submit_for_review with a Figma link if relevant
  6. update_progress + end_heartbeat
```

**zoe — marketing / content**

```toml
# .hq/agents/zoe.toml
[agent]
name = "zoe"
role = "worker"
soul = "zoe.md"
model = "sonnet"
gender = "female"

[scope]
packages = ["marketing"]
```

```md
# .hq/agents/zoe.md
# zoe — marketing & content

You own apps/marketing/ (landing pages, pricing, blog). You ship copy,
SEO metadata, and the conversion funnel — not infrastructure.

Non-negotiable:
- Every new page ships with OpenGraph + Twitter card + JSON-LD
- Copy passes a grade-8 readability bar — short, active, concrete
- Pricing numbers mirror packages/api or a single pricing.json source;
  if you see drift, open a blocked task and @mention alex
- Blog posts: minimum one internal link, one primary keyword in H1 and
  meta description
- When a marketing visual is needed, open a task @mentioning iris
  instead of inlining a placeholder

Protocol:
  1. start_heartbeat
  2. read_messages — nora's briefs, iris's asset hand-offs
  3. list_tasks(status="todo") filter package == "marketing"
  4. claim → write → preview → commit
  5. submit_for_review
  6. update_progress + end_heartbeat
```

**sandor — devil's advocate reviewer**

```toml
# .hq/agents/sandor.toml
[agent]
name = "sandor"
role = "reviewer"
soul = "sandor.md"
model = "sonnet"
gender = "male"
```

SOUL: see [templates](#soulmd-templates) — the stock devil's-advocate
template fits here. Optionally add a line: "infra PRs from mira require
your explicit approval before she applies".

**thomas — readonly QA auditor**

```toml
# .hq/agents/thomas.toml
[agent]
name = "thomas"
role = "readonly"
soul = "thomas.md"
model = "haiku"                 # readonly: Haiku is sufficient and cost-efficient
readonly_strict = true          # belt AND braces
gender = "male"
```

SOUL: see [templates](#soulmd-templates).

### How a task flows through this team

1. You note "mobile signup keeps timing out" in an issue. `nora` reads
   it next heartbeat, creates a task under goal `ship-mobile-v1`:
   "Retry signup request with exponential backoff on network failure".
2. `nora` → `promote_task` → `todo` → `send_message(to="kenji")`.
3. `kenji` claims on branch `agent/kenji-task-<id>`, implements the
   retry, tests on both simulators, `submit_for_review`.
4. Event trigger wakes `sandor` right away (no waiting for next tick).
   He reads the diff, notices the retry has no jitter. `changes_requested`
   with reasoning. Task → `in_progress`; `kenji` gets the message.
5. `kenji` adds jitter, resubmits. `sandor` approves. Task → `review`
   (peer-approved, waiting on you).
6. In parallel, `iris` had already opened a sibling task for the
   signup empty state illustration. She shipped the asset, zoe wired it
   into the marketing page, and that task also ended `review`.
7. You approve both in the UI, click Push. Discord embed confirms.
   21:00 — the daily digest says "2 shipped · kenji, iris".

### Scaling rules

- **Solo / week 1**: 1 worker + 1 reviewer. Add `nora` once you have
  3+ active goals.
- **Small team**: `nora` + 2 workers covering your primary packages +
  `sandor`. Skip marketing and design until you have a real marketing
  surface or design system to own.
- **Heavier team**: add specialists the same way — a `security-priya`
  reviewer with a security-hardening SOUL, or a `sre-takeshi` worker
  with `scope.packages = ["infra"]` alongside `mira`.

The shape of the team should mirror the shape of your repo.

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
