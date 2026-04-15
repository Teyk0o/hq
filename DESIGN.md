# HQ — Design Document

> Version : 0.1-draft — à geler avant implémentation
> Cible : v0.1 MVP (live dès v0.1)

## 1. Vue d'ensemble

HQ est un orchestrateur d'équipes d'agents Claude Code autonomes, local-first, multi-projets. Il fournit :

- Un **kanban persistant** par projet (SQLite) façon Trello minimaliste
- Un **daemon central** qui lance périodiquement les agents selon un scheduler par-projet
- Un **serveur MCP** via lequel les agents lisent/écrivent le kanban et communiquent entre eux
- Un **dashboard web live** (SSE) qui affiche l'état, les logs et l'activité
- Un **CLI** (`hq`) pour administrer projets, agents, goals, tasks depuis le terminal

Les agents Claude Code **ne sont pas lancés en headless** (`claude -p`). Chaque agent tourne dans sa propre **session tmux persistante** comme une vraie session interactive. HQ pilote ces sessions via `tmux send-keys` et capture leurs logs via `tmux pipe-pane`. L'état d'un agent est la vérité **MCP-side**, jamais dérivée du parsing TUI.

## 2. Décisions verrouillées

| Domaine | Décision |
|---|---|
| Runtime | Bun ≥ 1.1 |
| Langage | TypeScript strict, ESM |
| Structure | Monorepo pnpm workspaces : `@hq/core`, `@hq/daemon`, `@hq/mcp`, `@hq/cli`, `@hq/ui` |
| DB | SQLite (WAL), via Drizzle ORM + drizzle-kit |
| Agent transport | tmux send-keys + pipe-pane (pas de `claude -p`) |
| Agent API vers HQ | MCP server (primaire) + CLI shell (debug humain) |
| Session Claude | Hybride : resume tant que même task, `/clear` entre tasks |
| Scheduler | Daemon central unique, systemd user service auto-install |
| Concurrence | Limite par-projet uniquement |
| UI | Bun HTTP + Hono JSX serveur + HTMX + SSE + Tailwind (shadcn-style) |
| UI bind | 127.0.0.1:7433 (fixe, override env), pas d'auth |
| États kanban | Fixes : `backlog → todo → in_progress → peer_review → review → approved → done`, plus `blocked` |
| Git push | Local-only par défaut, bouton UI "Push" après review humaine |
| Budget tokens | Hard stop agent (pas projet) au dépassement |
| Notifications | Activity feed UI + browser Notification API + webhook Discord par projet |
| Packaging | `bun link` en dev ; npm global + binaire compilé plus tard |
| Commits | Au fil de l'eau |
| License | Propriétaire maintenant, MIT envisagée en v1 |

## 3. Arborescence

### 3.1 Repo HQ

```
/home/theo/Perso/HQ/
├── DESIGN.md                      # ce document
├── README.md
├── package.json                   # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
├── .tool-versions                 # bun 1.1.42
├── .gitignore
└── packages/
    ├── core/
    │   └── src/
    │       ├── db/
    │       │   ├── schema.ts      # tables Drizzle
    │       │   ├── migrations/    # générées par drizzle-kit
    │       │   └── client.ts      # factory de connexion
    │       ├── domain/
    │       │   ├── task.ts        # state machine
    │       │   ├── agent.ts       # rôles, capabilities
    │       │   ├── goal.ts
    │       │   └── events.ts      # types des events SSE
    │       ├── rules/
    │       │   ├── compile.ts     # project.toml → hooks
    │       │   └── defaults.ts    # blacklist globale
    │       └── config/
    │           ├── project.ts     # parse project.toml
    │           └── agent.ts       # parse agent.toml
    ├── daemon/
    │   └── src/
    │       ├── scheduler.ts       # croner, ticks par projet
    │       ├── tmux.ts            # wrapper new/kill/send-keys/pipe-pane
    │       ├── heartbeat.ts       # protocole, prompt builder
    │       ├── budget.ts          # tracking tokens
    │       ├── retry.ts           # crash/timeout recovery
    │       └── registry.ts        # ~/.hq/registry.sqlite
    ├── mcp/
    │   └── src/
    │       ├── server.ts          # MCP HTTP/stdio selon target
    │       ├── tools/             # un fichier par tool
    │       └── events.ts          # bus → SSE
    ├── cli/
    │   └── src/
    │       ├── bin.ts             # entrypoint commander
    │       └── commands/          # init, agent, task, goal, daemon, board, pause, attach, ...
    └── ui/
        └── src/
            ├── server.ts          # Hono + SSE
            ├── views/             # JSX serveur (kanban, drawer, agents, activity)
            ├── sse.ts             # bridge events → clients
            └── static/            # tailwind build, htmx
```

### 3.2 État global utilisateur

```
~/.hq/
├── config.toml                    # clés globales (webhooks, telegram futur, model defaults)
├── registry.sqlite                # liste projets + daemon state
├── daemon.log                     # stdout du systemd service
└── bin/hq                         # symlink créé par `bun link`
```

### 3.3 État par-projet (versionné vs runtime)

```
<project>/.hq/
├── project.toml                   # [versionné] config projet
├── agents/                        # [versionné] définitions d'agents
│   ├── <name>.toml                #   config
│   └── <name>.md                  #   SOUL (prompt système)
├── hooks/                         # [versionné] hooks compilés depuis project.toml
├── webhooks.toml                  # [versionné] URLs Discord/etc
├── db.sqlite                      # [gitignored] kanban runtime
├── logs/                          # [gitignored] logs tmux par heartbeat
│   └── <agent>/<ISO_ts>.log
├── progress/                      # [gitignored] PROGRESS.md par agent
│   └── <agent>.md
├── worktrees/                     # [gitignored] git worktrees dédiés
│   └── <agent>/
└── runtime/                       # [gitignored] PIDs, tmux session names, last heartbeat
    └── <agent>.state.json
```

Le `.hq/.gitignore` est écrit par `hq init` et liste `db.sqlite*`, `logs/`, `progress/`, `worktrees/`, `runtime/`.

## 4. Schéma de base de données (par-projet)

Toutes les dates sont en unix epoch ms. IDs = nanoid 12 caractères sauf mention contraire.

### 4.1 `tasks`

```sql
id                TEXT PRIMARY KEY
goal_id           TEXT REFERENCES goals(id)   NULL
title             TEXT NOT NULL
description       TEXT NOT NULL DEFAULT ''
assignee          TEXT                         NULL   -- nom d'agent, NULL = non assigné
created_by        TEXT NOT NULL                       -- "human" | nom d'agent
status            TEXT NOT NULL                       -- enum State
priority          INTEGER NOT NULL DEFAULT 3          -- 1 (haute) .. 5 (basse)
package           TEXT                         NULL   -- api, plugin, core, ... (projet-spécifique)
branch            TEXT                         NULL   -- agent/<name>/task-<id>
pushed            INTEGER NOT NULL DEFAULT 0          -- bool : branche push sur remote
blocked_reason    TEXT                         NULL
created_at        INTEGER NOT NULL
updated_at        INTEGER NOT NULL
claimed_at        INTEGER                      NULL
completed_at      INTEGER                      NULL

INDEX tasks_status ON (status)
INDEX tasks_assignee ON (assignee)
INDEX tasks_goal ON (goal_id)
```

État (enum) : `backlog | todo | in_progress | peer_review | review | approved | done | blocked`.

### 4.2 `task_dependencies`

```sql
task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE
depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE
PRIMARY KEY (task_id, depends_on)
```

### 4.3 `comments`

```sql
id          TEXT PRIMARY KEY
task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE
author      TEXT NOT NULL                        -- "human" | agent name
body        TEXT NOT NULL
mentions    TEXT NOT NULL DEFAULT '[]'           -- JSON string[]
created_at  INTEGER NOT NULL
```

### 4.4 `reviews`

```sql
id          TEXT PRIMARY KEY
task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE
reviewer    TEXT NOT NULL
verdict     TEXT NOT NULL                         -- "approved" | "changes_requested"
body        TEXT NOT NULL DEFAULT ''
created_at  INTEGER NOT NULL
```

### 4.5 `goals`

```sql
id              TEXT PRIMARY KEY
title           TEXT NOT NULL
description     TEXT NOT NULL DEFAULT ''
assignees       TEXT NOT NULL DEFAULT '[]'        -- JSON string[] (noms d'agents)
tasks_per_week  INTEGER NOT NULL DEFAULT 0        -- 0 = pas d'auto-gen
active          INTEGER NOT NULL DEFAULT 1
created_at      INTEGER NOT NULL
updated_at      INTEGER NOT NULL
```

### 4.6 `agent_state` (runtime)

```sql
name              TEXT PRIMARY KEY
status            TEXT NOT NULL                    -- "idle" | "working" | "blocked" | "archived"
last_heartbeat    INTEGER                NULL
current_task_id   TEXT                   NULL REFERENCES tasks(id)
tmux_session      TEXT                   NULL
pid               INTEGER                NULL
tokens_today      INTEGER NOT NULL DEFAULT 0
tokens_budget     INTEGER NOT NULL DEFAULT 0       -- 0 = illimité
budget_reset_at   INTEGER NOT NULL                 -- epoch de reset quotidien
blocked_reason    TEXT                   NULL
```

### 4.7 `messages` (DM inter-agents)

```sql
id          TEXT PRIMARY KEY
from_agent  TEXT NOT NULL
to_agent    TEXT NOT NULL                         -- nom d'agent ou "*" (broadcast)
subject     TEXT NOT NULL DEFAULT ''
body        TEXT NOT NULL
read_at     INTEGER                       NULL
created_at  INTEGER NOT NULL
```

### 4.8 `activity`

```sql
id          INTEGER PRIMARY KEY AUTOINCREMENT
agent       TEXT NOT NULL                         -- "human" inclus
action      TEXT NOT NULL                         -- "task.claimed", "review.submitted", ...
task_id     TEXT                          NULL
details     TEXT NOT NULL DEFAULT '{}'            -- JSON
created_at  INTEGER NOT NULL

INDEX activity_created ON (created_at DESC)
```

### 4.9 `heartbeats`

```sql
id           TEXT PRIMARY KEY
agent        TEXT NOT NULL
started_at   INTEGER NOT NULL
ended_at     INTEGER                      NULL
outcome      TEXT                         NULL   -- "ok" | "timeout" | "crash" | "budget"
log_path     TEXT NOT NULL                        -- .hq/logs/<agent>/<ts>.log
tokens_used  INTEGER NOT NULL DEFAULT 0
tasks_worked TEXT NOT NULL DEFAULT '[]'           -- JSON string[]
error        TEXT                         NULL
```

## 5. State machine des tasks

### 5.1 Diagramme

```
                      ┌────────────┐
                      │  backlog   │  (auto-gen par goal, ou manuel)
                      └─────┬──────┘
              (human or boss-agent promotes)
                            ▼
                      ┌────────────┐
                      │    todo    │  (assignable, claimable)
                      └─────┬──────┘
                  (agent claim_task)
                            ▼
                      ┌────────────┐
                      │in_progress │  (worker bosse)
                      └─────┬──────┘
            (agent submit_for_review)
                            ▼
                      ┌────────────┐
              ┌──────▶│peer_review │  (reviewers invités)
              │       └─────┬──────┘
              │    (reviewer submit_review)
              │             ▼
              │     ┌───────┴────────┐
              │     │                │
    (changes_requested)        (approved, gate: min_reviewers atteint)
              │                      │
              │                      ▼
              │              ┌────────────┐
              │              │   review   │  (attente humain)
              │              └─────┬──────┘
              │            (human approves in UI)
              │                    ▼
              │              ┌────────────┐
              │              │  approved  │  (prête à push/merge)
              │              └─────┬──────┘
              │            (human pushes → done)
              │                    ▼
              │              ┌────────────┐
              │              │    done    │  ◀── terminal
              │              └────────────┘
              │
              └── renvoyée à `in_progress` (auteur recommence avec feedback)

  À tout moment : → `blocked` (agent report_blocked ou crash)
                   depuis blocked → retour à l'état précédent via `hq unblock` ou auto-recover
```

### 5.2 Règles de transition

| From | To | Autorisé pour |
|---|---|---|
| `backlog` | `todo` | human, agent avec `can_promote_tasks` |
| `todo` | `in_progress` | agent avec `can_claim_tasks` (et assignee = lui ou non assigné) |
| `in_progress` | `peer_review` | assignee uniquement |
| `in_progress` | `blocked` | assignee (via `report_blocked`), daemon (crash/timeout) |
| `peer_review` | `review` | daemon (quand N reviews `approved` ≥ `min_reviewers`) |
| `peer_review` | `in_progress` | daemon (si review `changes_requested`) |
| `review` | `approved` | human uniquement |
| `review` | `in_progress` | human (rejet) |
| `approved` | `done` | human (après push/merge) |
| `blocked` | état précédent | human (via `hq unblock`) |
| any | `backlog` | human (reset) |

Toutes les transitions interdites sont refusées par `core/domain/task.ts` et loggées en `activity`.

### 5.3 Gate peer-review

`min_reviewers` est défini dans `project.toml`. Un agent ne peut pas reviewer sa propre task. Un agent `readonly` ne peut pas claim mais peut review. Un reviewer qui `changes_requested` doit donner un `body` non vide.

## 6. Rôles et capabilities agents

### 6.1 Rôles prédéfinis

Chaque rôle est un preset de capabilities et d'outils Claude Code autorisés.

| Rôle | can_claim | can_review | can_promote_tasks | can_create_tasks | can_write_files | can_commit | tools par défaut |
|---|---|---|---|---|---|---|---|
| `boss` | false | true | true | true | false | false | Read, Grep, Glob, Bash (safe) |
| `worker` | true | true | false | false | true | true | Read, Write, Edit, Grep, Glob, Bash |
| `reviewer` | false | true | false | false | false | false | Read, Grep, Glob |
| `readonly` | false | false | false | false | false | false | Read, Grep, Glob |

### 6.2 Format de définition

**`<project>/.hq/agents/lucas.toml`** (exemple) :

```toml
[agent]
name = "lucas"
role = "worker"                       # preset de capabilities/tools
model = "sonnet"                      # override du default projet
soul = "lucas.md"                     # chemin relatif au SOUL
active = true
readonly = false

[capabilities]                         # overrides du rôle (optionnel)
can_review = true

[tools]                                # overrides (optionnel)
extra_allowed = ["Bash(docker:*)"]
extra_denied = ["Bash(rm:*)"]

[scope]
packages = ["api", "core"]             # pour rules "owner", visibilité suggestions

[budget]
max_tokens_per_heartbeat = 200000
max_tokens_per_day = 3000000

[timeout]
heartbeat_minutes = 15                 # override du default projet
```

**`<project>/.hq/agents/lucas.md`** (SOUL) : prose libre décrivant personnalité, mission, ton, règles métier propres.

### 6.3 Hot reload

À chaque tick du scheduler, le daemon relit `agents/<name>.toml` et `agents/<name>.md`. Les modifications s'appliquent au **prochain heartbeat**, jamais en cours d'exécution.

## 7. Protocole heartbeat

### 7.1 Cycle de vie d'une session agent

Une session tmux nommée `hq-<project_slug>-<agent>` est créée **une fois** au premier heartbeat, puis réutilisée :

```bash
tmux new-session -d -s hq-flowly-lucas -c <worktree>
tmux pipe-pane  -t hq-flowly-lucas -o "cat >> <log_path>"
tmux send-keys  -t hq-flowly-lucas "claude" Enter
# attente que le prompt soit prêt (sleep bref + retry)
```

Aux heartbeats suivants, si la session existe toujours, elle est réutilisée. Si elle a disparu (kill manuel, reboot), elle est recréée.

### 7.2 Mode session hybride

- **Même task qu'au dernier heartbeat** : on ne `/clear` pas. L'agent reprend naturellement, le contexte est vivant.
- **Task différente / pas de task active** : on envoie `/clear` + Enter avant le prompt de heartbeat, pour repartir sur un contexte propre.
- **Timeout de session atteint** (ex: session > 4h) : on envoie `/clear` même sur même task, pour éviter l'explosion de contexte.

### 7.3 Prompt de heartbeat envoyé à l'agent

Template construit par `daemon/src/heartbeat.ts` :

```
=== HQ HEARTBEAT <short_id> ===

You are <agent_name>, a <role> on project <project_name>.

Your SOUL:
<contenu de <agent>.md>

Your teammates:
- morgane (boss, status=idle)
- inès (worker, status=working on task_ab12)
- thomas (reviewer, status=idle)

Your PROGRESS since last heartbeat:
<contenu de progress/<agent>.md>

Execute your heartbeat protocol IN THIS ORDER:

1. Call mcp__hq__start_heartbeat to mark yourself working.
2. REVIEW PHASE: Call mcp__hq__list_tasks(status="peer_review")
   and for each task you are eligible to review (you're on the same goal, and you didn't author it):
   - Read the task, diffs, prior comments
   - Call mcp__hq__submit_review with verdict and body
3. UNBLOCK PHASE: if you have tasks in "blocked", recheck dependencies.
4. WORK PHASE: Call mcp__hq__list_tasks(status="todo", assignee=<you or null>)
   Pick one according to priority, call mcp__hq__claim_task.
   Do the work in the current working directory (your worktree).
   Commit to branch agent/<you>/task-<id>.
   When done, call mcp__hq__submit_for_review.
5. Call mcp__hq__update_progress with a short summary to be persisted.
6. Call mcp__hq__end_heartbeat to mark yourself idle. This MUST be the last tool call.

Constraints:
- Token budget this heartbeat: <max_tokens>
- Timeout: <minutes> min
- You CANNOT modify files outside your worktree.
- You CANNOT push branches. Commit only.
- If you encounter an unrecoverable problem, call mcp__hq__report_blocked and stop.
```

### 7.4 Détection de fin

Source de vérité exclusive : appel MCP `end_heartbeat`. Le daemon marque alors `agent_state.status = "idle"`, insère dans `heartbeats.ended_at`.

Si pas de `end_heartbeat` après `timeout_minutes` :
1. Le daemon envoie un signal SIGINT via `tmux send-keys C-c` pour interrompre Claude
2. Il envoie `/clear`
3. Marque le heartbeat `outcome = "timeout"`
4. Auto-unclaim des tasks `in_progress` de cet agent → retour à `todo`
5. Retry configuré : si `retry_count < max_retries`, replanifie le heartbeat dans 1 min ; sinon passe l'agent en `blocked`.

### 7.5 Crash recovery

- Tmux session tuée : recréée au prochain tick
- Daemon redémarré : au boot, scan des `heartbeats` sans `ended_at` → les marque `outcome = "crash"`, unclaim, continue
- SIGKILL du process Claude : pareil, `outcome = "crash"`

## 8. Serveur MCP

### 8.1 Transport

MCP exposé en **stdio** (standard Claude Code MCP servers) configuré via `.mcp.json` dans le worktree de l'agent :

```json
{
  "mcpServers": {
    "hq": {
      "command": "hq",
      "args": ["mcp", "--project", "<project_path>", "--agent", "<agent_name>"]
    }
  }
}
```

Le wrapper `hq mcp` connaît le projet et l'agent via args, ouvre la DB, expose les tools.

### 8.2 Liste des tools

Tous les tools renvoient JSON. Erreurs = exception MCP standard.

| Tool | Description | Input |
|---|---|---|
| `start_heartbeat` | Marque l'agent `working`, log le début | — |
| `end_heartbeat` | Marque l'agent `idle`, log la fin. Doit être le dernier appel. | `{ summary?: string }` |
| `list_tasks` | Liste filtrée des tasks | `{ status?, assignee?, goal_id?, limit? }` |
| `get_task` | Détails d'une task (incl. comments, reviews) | `{ id }` |
| `claim_task` | Assigne et passe en `in_progress` | `{ id }` |
| `submit_for_review` | `in_progress → peer_review` | `{ id, summary?: string }` |
| `submit_review` | Review pair | `{ id, verdict: "approved" \| "changes_requested", body }` |
| `add_comment` | Commente une task | `{ task_id, body, mentions?: string[] }` |
| `report_blocked` | Passe une task en `blocked` | `{ id, reason }` |
| `create_task` | Crée une task (si `can_create_tasks`) | `{ title, description, goal_id?, assignee?, priority?, package? }` |
| `promote_task` | `backlog → todo` (si `can_promote_tasks`) | `{ id }` |
| `list_teammates` | Liste des agents du projet + status | — |
| `send_message` | DM à un teammate (ou `*` broadcast) | `{ to, subject?, body }` |
| `read_messages` | Boîte de réception | `{ unread_only?: boolean }` |
| `update_progress` | Écrit PROGRESS.md | `{ body }` |
| `log_activity` | Log libre | `{ action, details? }` |

Chaque tool vérifie les **capabilities de l'agent appelant** avant d'exécuter (rôle + overrides).

### 8.3 Bus d'events

Chaque mutation (write) émet un event interne consommé par le serveur UI pour SSE. Events :

```
task.created      task.claimed         task.status_changed
task.commented    task.reviewed        task.blocked
task.unblocked    task.pushed
agent.heartbeat_started    agent.heartbeat_ended
agent.status_changed       agent.token_usage    agent.archived
goal.created      goal.updated         goal.task_generated
message.sent
webhook.fired     webhook.failed
```

Bus implémentation : simple EventEmitter in-process, le serveur UI vit dans le même process que le daemon (même binaire Bun).

## 9. Moteur de règles

### 9.1 project.toml

```toml
[project]
name = "flowly"
root = "."
default_model = "sonnet"
default_branch = "main"

[scheduler]
interval_minutes = 15
stagger_seconds = 60
max_concurrent_agents = 3
daily_token_budget = 10_000_000    # somme projet, 0 = illimité

[git]
branch_prefix = "agent/"
worktree_dir = ".hq/worktrees"

[kanban]
min_reviewers = 1
require_lint_before_review = true
require_typecheck_before_review = true

[heartbeat]
default_timeout_minutes = 15
max_session_hours = 4
retry_max = 2

[webhook]
discord_url = ""                   # URL si notif Discord
discord_events = ["task.blocked", "task.approved"]

[[goals]]
id = "core-audit"
title = "Audit continu cross-package"
assignees = ["morgane", "thomas"]
tasks_per_week = 5
active = true

[[rules]]
id = "installer-docs-required"
match = "packages/installer/**"
require = "doc_update"
require_path = "packages/installer/docs/**"

[[rules]]
id = "lock-file-protected"
match = "pnpm-lock.yaml"
action = "block"

[[rules]]
id = "forbidden-commands"
agents = ["*"]
forbid_commands = ["rm -rf /", "git push --force", "git reset --hard", "chmod 777"]

[[rules]]
id = "core-owner"
match = "packages/core/**"
owner = "lucas"
```

### 9.2 Types de règles

- `match + action = block` : fail hard si l'agent tente d'éditer
- `match + action = warn` : autorise mais log un warning
- `match + require = doc_update + require_path` : refuse si fichiers `match` modifiés sans fichier `require_path` modifié
- `match + owner` : l'agent `owner` doit approuver (review) avant merge
- `forbid_commands` : liste substring/regex bloquées dans Bash
- `match + require_tests_pass` : refuse transition `peer_review` si tests échouent
- `match + protected_paths` : readonly absolu même pour `worker`

### 9.3 Compilation

`hq init` et `hq sync` compilent `project.toml` en **hooks Claude Code** dans `.hq/hooks/`. Exemple généré :

```
.hq/hooks/
├── pre-tool.sh           # applique match+block, forbid_commands
├── post-edit.sh          # vérifie require=doc_update
└── pre-status-change.sh  # vérifie require_tests_pass
```

Ces hooks sont pointés via `settings.json` dans le worktree de l'agent, auto-généré par `hq init`.

## 10. Events SSE & UI temps réel

### 10.1 Endpoint SSE

`GET /events?project=<name>` — stream texte. Chaque event :

```
event: task.status_changed
id: 1743273829-12
data: {"task_id":"abc","from":"in_progress","to":"peer_review","agent":"lucas"}

```

Le serveur UI subscribe au bus interne du daemon et forward. Reconnection gérée par le client SSE natif du navigateur.

### 10.2 Rendu HTMX

Chaque carte : `<div id="task-abc" hx-ext="sse" sse-swap="task-abc-updated">...</div>`
Les mouvements de colonne : swap out-of-band `hx-swap-oob="true"` pour retirer de l'ancienne colonne + insérer dans la nouvelle. Animation via View Transitions API (`document.startViewTransition`).

### 10.3 Pages

- `/` redirige vers `/board` (projet actif)
- `/board` kanban du projet courant (cookie `hq_project`)
- `/board?project=<name>` switch projet
- `/board/all` vue multi-projets grille
- `/task/:id` drawer latéral (chargé via HTMX hx-get)
- `/agents` liste agents détaillée
- `/activity` stream historique
- `/settings` vue read-only du `project.toml` compilé
- `/api/…` endpoints humains (review/approve/push)
- `/events` SSE stream
- `/mcp/…` (si MCP en HTTP pour debug — optionnel v0.2)

### 10.4 Actions humaines UI

- Drag `review → approved` : `POST /api/tasks/:id/approve`
- Bouton "Push" sur carte `approved` : `POST /api/tasks/:id/push` (git push + task → `done`)
- Bouton "Reject" : `POST /api/tasks/:id/reject` avec body `{reason}` → task retour `in_progress`
- Bouton "Pause all" header : `POST /api/daemon/pause?project=<name>`
- Bouton "Run now" sur carte agent : `POST /api/agents/:name/run`

## 11. CLI `hq`

Implémentée avec commander.js. Commandes v0.1 :

### Projet
```
hq init [path]                       # scaffold .hq/ dans le projet
hq register                          # ajoute au ~/.hq/registry.sqlite
hq unregister [name]
hq list                              # liste projets enregistrés
hq pause [--project <name>]          # stoppe heartbeats
hq resume [--project <name>]
```

### Agents
```
hq agent new <name> [--role worker]  # scaffold agents/<name>.toml + .md
hq agent list
hq agent archive <name>
hq agent restore <name>
hq agent run <name>                  # heartbeat manuel
hq agent attach <name>               # alias tmux attach -t hq-<project>-<name>
hq agent logs <name> [--tail]
```

### Tasks / Goals
```
hq task add "<title>" [--goal <id>] [--assignee <name>] [--priority <1-5>]
hq task list [--status <s>] [--assignee <name>]
hq task show <id>
hq task unblock <id>
hq goal new
hq goal list
```

### Daemon
```
hq daemon start                       # lance en foreground
hq daemon install-service             # écrit ~/.config/systemd/user/hq.service + enable
hq daemon status
hq daemon stop
```

### UI & MCP
```
hq board                              # ouvre http://127.0.0.1:7433 dans le navigateur
hq mcp --project <path> --agent <n>   # interne, utilisé par les agents via .mcp.json
```

## 12. Orchestration tmux

Helper `daemon/src/tmux.ts` expose :

```typescript
tmux.exists(session: string): boolean
tmux.create(session: string, cwd: string): void
tmux.kill(session: string): void
tmux.sendKeys(session: string, text: string, { enter?: boolean }): void
tmux.sendCtrlC(session: string): void
tmux.pipePane(session: string, logPath: string): void
tmux.sendPrompt(session: string, multiLine: string): void  // envoie avec heredoc-safe
```

Naming : `hq-<project_slug>-<agent_name>`. Ex: `hq-flowly-lucas`. Evite les collisions entre projets.

Commandes exactes utilisées :

```bash
tmux new-session -d -s hq-flowly-lucas -c /home/theo/Perso/HQ/.hq/worktrees/lucas
tmux pipe-pane -t hq-flowly-lucas -o "cat >> <log>"
tmux send-keys -t hq-flowly-lucas "claude" Enter
tmux send-keys -t hq-flowly-lucas -l "<prompt line 1>"
tmux send-keys -t hq-flowly-lucas Enter
```

Pour les multi-lignes : `tmux send-keys -l` avec `-l` (literal, pas d'expansion) puis Enter final.

## 13. Budget & tokens

- `tokens_used` remonté par `end_heartbeat` (source : parsing du footer de Claude Code en fin de turn, extrait depuis les logs tmux pipe-pane). Fallback : estimation par caractères comptés dans le stream si parsing échoue.
- Reset quotidien à minuit local via job croner dédié
- Si `agent_state.tokens_today + estimated_next_hb > tokens_budget` : skip le tick pour cet agent, émet `agent.budget_stopped`

## 14. Webhooks Discord

Config dans `<project>/.hq/webhooks.toml` :

```toml
[discord]
url = "https://discord.com/api/webhooks/..."
events = ["task.blocked", "task.approved", "agent.budget_stopped"]
mentions = { role = "<role_id>" }     # optionnel, ping rôle
```

Un listener daemon consomme le bus interne, filtre selon events subscribed, POST JSON standard Discord. Rate-limited naturellement.

## 15. Systemd auto-install

`hq daemon install-service` écrit :

**`~/.config/systemd/user/hq.service`**

```ini
[Unit]
Description=HQ agent orchestration daemon
After=network.target

[Service]
Type=simple
ExecStart=%h/.local/bin/hq daemon start
Restart=on-failure
RestartSec=5
StandardOutput=append:%h/.hq/daemon.log
StandardError=append:%h/.hq/daemon.log
Environment=TERM=xterm-256color

[Install]
WantedBy=default.target
```

Puis `systemctl --user daemon-reload && systemctl --user enable --now hq`. Confirmation interactive.

## 15bis. Monitoring du quota Claude Max

HQ surveille en continu la consommation du quota Claude Code de l'utilisateur et l'expose dans le dashboard.

### 15bis.1 Source des données

Les chiffres affichés par `/usage` dans Claude Code sont calculés localement à partir des logs `~/.claude/projects/*/*.jsonl`. HQ s'appuie sur **`ccusage`** (outil open-source, `bunx ccusage`) qui reproduit ces calculs : fenêtres de 5h, semaine Anthropic, ventilation par modèle.

Pas de parseur maison : on shell-out `bunx ccusage blocks --json` + variantes, on cache le résultat.

### 15bis.2 Package dédié

Nouveau package `@hq/usage` exposant :

- `fetchUsage(): Promise<UsageSnapshot>` — exécute ccusage, normalise
- `UsageSnapshot` : `{ session_pct, week_all_pct, week_sonnet_pct, resets: {session, week_all, week_sonnet}, fetched_at }`
- Cache dans `~/.hq/usage-cache.json` (TTL = intervalle adaptatif)

### 15bis.3 Polling adaptatif

- **Fréquence normale** : 10 min
- **Fréquence accélérée** : 2 min si `week_all_pct > 80`
- Scheduler dédié dans `@hq/daemon`, distinct des heartbeats d'agents
- Émet bus event `claude.usage_updated` à chaque refresh

### 15bis.4 Auto-pause daemon

Seuil configurable dans `~/.hq/config.toml` :

```toml
[claude_usage]
auto_pause_threshold_week = 85        # %, 0 = désactive
auto_pause_threshold_session = 0      # désactivé par défaut, session reset toutes les 5h
resume_on_reset = true
```

Au-delà du seuil, le daemon :
1. Marque tous les agents en `paused_quota`
2. Skip les ticks jusqu'au prochain reset de quota
3. Émet event `daemon.quota_paused`
4. Reprend auto au reset (détection via `resets.week_all < fetched_at`)

### 15bis.5 Widget UI

Header global du dashboard :

```
[ Session 60% · resets 23:00 ]  [ Week 32% · resets Apr 17 ]  [ Sonnet 4% · Apr 19 ]
```

Couleurs : vert < 60, orange 60-80, rouge > 80. Tooltip hover = détails.
Push SSE via event `claude.usage_updated`.

### 15bis.6 CLI

```
hq usage                              # affiche le snapshot courant
hq usage --refresh                    # force un refresh immédiat
hq usage --watch                      # live dans le terminal
```

## 16. Roadmap

- **v0.1 (MVP live)** : DB + migrations, MCP server (tous tools), daemon + scheduler + tmux, CLI humain, UI live kanban + activity + agents + drawer task, hooks règles de base, webhook Discord, systemd install, test sur projet dummy
- **v0.2** : replay des heartbeats, vue multi-projets `--all`, push GitLab/GitHub auto avec PR, rate-limit intelligent, metrics/graphs
- **v0.3** : Telegram notifications, mobile-friendly UI, tunnel sécurisé optionnel
- **v1.0** : stabilisation API MCP, packaging binaire, open-source MIT

## 17. Points ouverts à trancher pendant l'implémentation

- Parsing exact du compte de tokens depuis les logs Claude Code (vérifier le format actuel)
- Gestion des permissions Claude Code dynamiques (via `settings.json` par worktree ou via `--permission-mode`)
- Interaction entre hooks Claude Code et rollback DB si hook refuse une action après mutation MCP : **atomicité à garantir** (transactions)
- Détection "prompt prêt" après lancement initial de `claude` (attendre quelques secondes + poll ? Sentinel ?)
- Stratégie de gestion des `.mcp.json` par worktree : réécriture par `hq init` ou dynamique par le daemon ?
