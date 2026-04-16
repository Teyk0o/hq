# HQ for Claude

You are Claude. The user wants you to set up HQ (an autonomous agent
orchestrator) on their project, or to understand what's possible once it
is running. This document is your single reference.

If anything is unclear, ask the user. Don't guess project names, agent
names, or goals.

---

## What HQ is

HQ runs a team of Claude Code agents on a local project. Each agent:

- lives in a persistent tmux session (survives reboots only if the systemd
  unit is enabled)
- runs `claude --dangerously-skip-permissions` inside a bubblewrap sandbox
- talks to a local MCP server `hq` that owns all state in `.hq/db.sqlite`
- has a **role** (worker / reviewer / boss / readonly), a **SOUL.md** (its
  system prompt), and optional **scope** (packages it may touch)

The source of truth is a single SQLite file per project under
`.hq/db.sqlite`. A web UI on `http://127.0.0.1:7433` shows everything live.

---

## Installing HQ on a project

Do these steps in order. Ask the user before running anything that is
destructive or environment-modifying (`sysctl`, `apt install`, systemd
commands).

### 1. Verify prerequisites

```bash
which tmux bwrap bun claude
```

All four must resolve. If not, tell the user which to install:

- `tmux` — `sudo apt install tmux`
- `bwrap` — `sudo apt install bubblewrap`
- `bun` — `curl -fsSL https://bun.sh/install | bash`
- `claude` — Claude Code CLI from https://claude.com/claude-code

On Ubuntu 24+, user namespaces must be enabled for bwrap. Ask before
running:

```bash
echo "kernel.apparmor_restrict_unprivileged_userns = 0" \
  | sudo tee /etc/sysctl.d/60-userns.conf
sudo sysctl --system
```

### 2. Scaffold the project

From the project root:

```bash
hq init
```

This creates `.hq/project.toml`, `.claude/settings.local.json` with
PreToolUse hooks, and `.mcp.json`. It registers the project in
`~/.hq/registry.toml`.

### 3. Tune `project.toml`

Open `.hq/project.toml` and, at minimum, set:

- `project.name` — used in Discord webhooks and UI
- `project.default_branch` — usually `main`
- `[[goals]]` — at least one goal so a boss has something to plan against
- `[[rules]]` — protect lock files, installer docs, secrets folders, etc.

Ask the user for goals before inventing any. Bad goals produce bad tasks.

### 4. Create agents

A minimal team is one `worker` + one `reviewer`. A fuller team adds a
`boss` (planner) and optionally a `readonly` auditor.

```bash
hq agent new alice --role worker --gender female
hq agent new bob   --role reviewer --gender male
hq agent new morgane --role boss --gender female
```

**The 4 roles are capability buckets, not job titles.** You model a
"backend engineer" or a "frontend engineer" or a "DevOps" by:

1. Picking the right base `role` (almost always `worker` if they ship
   code, `reviewer` if they only review, `boss` if they only plan,
   `readonly` if they only observe).
2. Setting `scope.packages` in `agent.toml` to the folders they own.
3. Writing a `SOUL.md` that spells out their stack, conventions, and
   review style.
4. Adding `[[rules]] owner = "<name>"` in `project.toml` so the
   rules-gate hard-blocks cross-team writes.

Two "workers" with different scopes + SOULs are effectively two
different specialties. See [full team template](#reference-team--9-agent-saas-startup)
at the end of this doc.

Each command creates `.hq/agents/<name>.toml` and `.hq/agents/<name>.md`
(the SOUL). **Write a real SOUL** for each agent — the generated
placeholder is not enough. See the templates in
[`GUIDE.md`](./GUIDE.md#soulmd-templates). The SOUL controls the agent's
behaviour more than any config.

### 5. Seed tasks (optional)

If the user wants immediate activity:

```bash
hq task add "Add /healthcheck endpoint" --priority 2 --package api
hq task add "Write tests for UserService" --priority 3 --package core
```

Tasks default to `backlog`. The boss will promote them to `todo`, or you
can pass `--status todo` on `hq task add` if there is no boss.

### 6. Launch the daemon

```bash
hq daemon start
```

Then open `http://127.0.0.1:7433` to watch the team work. To run it in
the background, ask the user before installing the systemd unit:

```bash
hq daemon install-service
systemctl --user daemon-reload
systemctl --user enable --now hq
```

---

## MCP tool reference

These 16 tools are what every agent consumes. All return a uniform JSON
envelope: `{"ok": true, "data": ...}` or
`{"ok": false, "error": {"code", "message", "details?"}}`.

### Heartbeat

| Tool | Input | Purpose |
|---|---|---|
| `start_heartbeat` | `{}` | Must be the first call of a heartbeat. |
| `end_heartbeat` | `{ summary?, tokens_used? }` | Must be the last call. |
| `update_progress` | `{ body }` | Replace `PROGRESS.md` for the agent. |

### Tasks

| Tool | Input | Purpose |
|---|---|---|
| `list_tasks` | `{ status?, assignee?, goal_id?, limit? }` | Filtered list. |
| `get_task` | `{ id }` | Task + comments + reviews. |
| `claim_task` | `{ id }` | Self-assign, move to `in_progress`. |
| `submit_for_review` | `{ id, summary? }` | Move to `peer_review`. Refuses without a committed branch. |
| `report_blocked` | `{ id, reason }` | Flag a task as blocked. |
| `create_task` | `{ title, description?, goal_id?, assignee?, priority?, package? }` | Needs `can_create_tasks`. |
| `promote_task` | `{ id }` | Backlog → todo. Needs `can_promote_tasks`. |

### Reviews

| Tool | Input | Purpose |
|---|---|---|
| `submit_review` | `{ id, verdict: "approved" \| "changes_requested", body }` | Auto-promotes to `review` when `min_reviewers` met. |
| `add_comment` | `{ task_id, body, mentions? }` | `@name` in `body` fans out to the inbox. |

### Team

| Tool | Input | Purpose |
|---|---|---|
| `list_teammates` | `{}` | Name + status of every active agent. |
| `send_message` | `{ to, subject?, body }` | `to: "*"` broadcasts. |
| `read_messages` | `{ unread_only? }` | Reads your inbox, marks fetched messages read. |
| `log_activity` | `{ action, details? }` | Free-form audit entry. |

### Contract guarantees

- Tool inputs are validated against a Zod schema. Invalid input returns
  `{ok: false}` with `error.code = "invalid_input"`.
- Capability refusals return `error.code = "forbidden"`. Scope violations
  return `"out_of_scope"`. Claim races return `"claim_race_lost"`.
- Every call writes one row to the `activity` table — audit is free.
- Missing commit on `submit_for_review` returns one of
  `branch_missing`, `branch_mismatch`, `no_commits`.
- `add_comment` returns `{ fanout: number }` — the number of messages
  created from `@mentions`.

---

## Heartbeat protocol

A correct heartbeat always follows this shape:

```
start_heartbeat
read_messages           # handle changes_requested / pings first
list_tasks(...)         # find work within your scope + role
claim_task / submit_review / create_task / ...   (the actual work)
update_progress
end_heartbeat(summary, tokens_used)
```

Deviations cause problems:

- Skipping `start_heartbeat` means the agent shows as `idle` while doing
  work, and the scheduler may re-trigger it.
- Skipping `end_heartbeat` leaves the agent `working`, blocking the next
  tick until the reaper timeout fires.
- Doing multiple claims per heartbeat is fine, but keep it focused — one
  task per heartbeat is the canonical pattern.

---

## What agents must NOT do

- **No direct SQL on `.hq/db.sqlite`** — use MCP tools. The file is
  WAL-mode but HQ assumes it owns the schema.
- **No writes to `.hq/` outside their agent folder** — config drift breaks
  other agents.
- **No `git push`** unless the user explicitly asked. The human approves
  pushes from the UI.
- **No `rm -rf`** of worktrees — let the daemon clean them up after merge.
- **No bypassing `project.toml [[rules]]`** via Bash (e.g. `python -c "open(...)"`).
  The rules-gate catches file edits; bash-gate catches command exec.
  Both log the attempt.

---

## Tuning for a new project

Questions to answer before kicking off:

1. **Goals** — what should the team be working on this week?
2. **Roles** — who plans, who writes, who reviews? Usually 1 boss + 2–3
   workers + 1 reviewer.
3. **Scope partitions** — which agent owns which package? Encode in
   `agent.toml [scope]`.
4. **Protected paths** — lock files, CI, installer docs, secrets?
   Encode in `[[rules]] protected_paths`.
5. **Bash allowlist** — any project-specific commands (`docker compose`,
   custom scripts)? Append to `[bash] allow_prefixes`.
6. **Quota** — does the user want a daily token budget? Set
   `scheduler.daily_token_budget`.
7. **Discord** — webhook URL + events to forward?
8. **Heartbeat cadence** — 15 min is the default. Shorten to 5 for demos,
   lengthen to 30–60 for steady production.

Ask the user for each of these. Don't invent.

---

## Debugging recipes

### An agent never starts

Check in order:
1. `hq agent list` — is it `active`? `archived` agents don't run.
2. `~/.hq/daemon.log` — scheduler errors surface here.
3. `tmux ls` — is there a session `hq-<project>-<agent>`? If not, the
   daemon tried and failed to spawn; the log will say why.

### A heartbeat completed with zero MCP calls

Possible causes:
- The agent's SOUL is too vague and it decided to do nothing.
- The agent hit the trust dialog inside Claude Code — run
  `hq debug reset --all` to re-apply `preApproveTrust()`.
- `.mcp.json` is broken — run `hq init` again.

### Tasks stay in `peer_review`

`min_reviewers` (default 1) not met. Either lower it in
`project.toml [kanban]` or add another `reviewer` agent.

### Tasks stay in `review`

This is expected — `review` means **peer-approved, waiting on human
approval**. The human clicks **Approve** then **Push** in the UI.

### Discord webhook silent

Check `project.toml [webhook]`:
- `discord_url` non-empty
- `discord_events` lists the event types you want
- Restart the daemon — webhooks are wired at startup

---

## Project files you may edit

Safe to edit (hot-reloaded):
- `.hq/project.toml` — takes effect next tick
- `.hq/agents/<name>.toml` — takes effect next heartbeat
- `.hq/agents/<name>.md` (SOUL) — takes effect next heartbeat
- `.hq/soul/*.md` — same

Never edit:
- `.hq/db.sqlite` and `.hq/db.sqlite-wal`/`.sqlite-shm`
- `.hq/worktrees/*` — managed by the daemon
- `.hq/progress/*.md` — agents edit these via `update_progress`
- `.mcp.json`, `.claude/settings.local.json` — regenerated by `hq init`

---

## When the user asks "what can HQ do?"

Answer with concrete examples grounded in their project, not a feature
list. Good prompts for the user:

- "What's the next deliverable? I can turn it into tasks and goals."
- "Which folders are off-limits? I'll encode them as rules."
- "Who in the team plans vs. writes vs. reviews? I'll create matching agents."

Bad response: dumping the CLI list or pasting `GUIDE.md`. The user wants
to know how HQ applies to *their* repo.

---

## Reference team — 9-agent SaaS startup

Use this as a skeleton when the user asks for a "full team". Rename
agents and remap `scope.packages` to the folders that actually exist
in the repo.

Fictional product **Atlas** — a B2B collaboration app (Linear/Notion
flavour). Repo layout:

```
apps/{web,mobile,marketing}/    packages/{api,db,ui}/
design/                         infra/
```

### Org chart

```
                     nora  (boss — CTO + PM)
                     plans goals, routes tasks
                              │
   ┌───────┬───────┬───────┬──┴──┬───────┬────────┐
   │       │       │       │     │       │        │
  alex   sofia   kenji   mira   iris    zoe
 worker  worker  worker  worker worker  worker
 backend web     mobile  infra  designer marketing
 (api,   (web,   (mobile)       (design, (marketing)
  db)    ui)                     ui)
   │       │       │       │     │       │
   └───────┴───────┴───┬───┴─────┴───────┘
                       │
               ┌───────┴────────┐
               │                │
             sandor          thomas
            reviewer         readonly
           (devil's          (QA)
           advocate)
```

### Who does what

| Agent | Role | Scope | Specialty |
|---|---|---|---|
| `nora` | boss | — | CTO+PM, plans goals → tasks, routes via `send_message`. Opus. |
| `alex` | worker | `api`, `db` | Senior backend (REST, schema, migrations). |
| `sofia` | worker | `web`, `ui` | Senior frontend web (Next.js, design-system impl). |
| `kenji` | worker | `mobile` | Mobile (React Native, iOS + Android). |
| `mira` | worker | `infra` | Platform / DevOps (terraform, CI, observability). |
| `iris` | worker | `design`, `ui`, `marketing` | Product designer (tokens, assets, copy decks). |
| `zoe` | worker | `marketing` | Marketing / content (landing, pricing, blog, SEO). |
| `sandor` | reviewer | — | Devil's advocate reviewer. |
| `thomas` | readonly | — | QA auditor, comments only. |

Note: `iris` and `sofia` **both** have `ui` in their scope. Iris edits
tokens and assets; sofia implements the React components. There's no
`owner` rule on `packages/ui/` — ownership is cooperative. The SOULs
spell out the hand-off ("@mention the other before crossing over").

### Minimum `project.toml` contract

```toml
[[rules]]
match = "packages/{api,db}/**"
owner = "alex"

[[rules]]
match = "apps/web/**"
owner = "sofia"

[[rules]]
match = "apps/mobile/**"
owner = "kenji"

[[rules]]
match = "infra/**"
owner = "mira"

[[rules]]
match = "apps/marketing/**"
owner = "zoe"

[[rules]]
match = "design/**"
owner = "iris"

# packages/ui has NO owner rule — shared between sofia and iris.

[[rules]]
match = ".github/**"
owner = "mira"

[[rules]]
protected_paths = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]

[[rules]]
match = "**/.env*"
action = "block"
```

### Key insight: role ≠ specialty

`iris` (designer) and `zoe` (marketing) have the same `role = "worker"`
as the engineers. Their specialty lives in their SOUL + their
`scope.packages`. To create a **security reviewer**, you'd make a new
`role = "reviewer"` agent whose SOUL focuses on authn/crypto audits.
To create an **SRE**, another `role = "worker"` with
`scope.packages = ["infra"]`. No new role type required.

### Scaling rules

- **Solo / week 1**: 1 worker + 1 reviewer. No boss, no marketing, no
  design. Goals optional.
- **Small team**: `nora` + 2 workers covering the user's primary
  packages + `sandor`. Skip design + marketing until there's a design
  system or a marketing surface to own.
- **Full team**: all 9 as above.
- **Heavier**: add specialists — `security-priya` (reviewer), `sre-takeshi`
  (worker, `scope=["infra"]`), `data-mei` (worker, `scope=["analytics"]`), etc.

When the user asks "who should I hire?", do **not** propose this team
verbatim. Map their actual repo folders to scopes first, then suggest
agents with matching scopes and realistic names. Propose the smallest
team that covers their folders.

Full config examples (TOMLs + SOULs for every agent) are in
[`GUIDE.md`](./GUIDE.md#example-team--9-agent-saas-startup). When
setting up, copy from there and adjust names + scopes.

---

## References

- [`GUIDE.md`](./GUIDE.md) — full human-facing reference, SOUL templates,
  troubleshooting
- `packages/mcp/src/server.ts` — authoritative tool registry (16 entries)
- `packages/core/src/domain/capabilities.ts` — per-role capabilities
- `packages/core/src/domain/tasks.ts` — task state machine
- `packages/core/src/config/project.ts` — full project.toml schema
- `packages/core/src/config/agent.ts` — full agent.toml schema
