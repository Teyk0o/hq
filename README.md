# HQ

> Orchestrateur d'équipes d'agents Claude Code autonomes.

HQ fait tourner une équipe d'agents Claude Code sur un ou plusieurs projets,
comme une vraie équipe : des workers qui prennent des tasks, des reviewers
qui vérifient avant merge, un boss qui planifie depuis des goals, toi qui
approuves. Les agents s'envoient des messages, se reviewent entre eux, et
tout est visible dans un dashboard web local en temps réel.

## En deux minutes

```bash
# Prérequis : tmux, bubblewrap, bun ≥ 1.1
sudo apt install -y tmux bubblewrap
curl -fsSL https://bun.sh/install | bash

# Installer HQ (depuis le source, le temps qu'on publie)
git clone <this-repo> && cd HQ && bun install
cd packages/cli && bun link

# Ubuntu 24+ : autoriser les user namespaces pour bwrap
echo "kernel.apparmor_restrict_unprivileged_userns = 0" | sudo tee /etc/sysctl.d/60-userns.conf
sudo sysctl --system

# Créer un projet de test
hq debug test --reset --agents alice:worker,bob:reviewer --tasks 5 --interval 1

# Lancer le daemon (dans un terminal dédié)
hq daemon start
# Ouvrir http://127.0.0.1:7433
```

Laisse tourner : alice prend une task, bob la review, la task monte en
`review` et attend ton OK dans l'UI. Tu approuves, tu appuies sur Push,
elle part.

## Architecture

Six packages en TypeScript / Bun :

| Package | Rôle |
|---|---|
| `@hq/core` | Schéma SQLite (Drizzle), state machine des tasks, parsers TOML, moteur de règles |
| `@hq/mcp` | Serveur MCP exposé aux agents (16 tools : claim/review/comment/message...) |
| `@hq/daemon` | Scheduler cron, wrapper tmux, bubblewrap sandbox, event-driven reviewer wake-up, webhooks |
| `@hq/usage` | Monitoring du quota Claude Max via tmux probe + ccusage fallback |
| `@hq/cli` | CLI `hq` pour scaffolder projets/agents/tasks et gérer le daemon |
| `@hq/ui` | Dashboard web (Hono + HTMX + SSE + Tailwind + Lucide icons) |

Chaque agent tourne dans une **session tmux persistante** avec
`claude --dangerously-skip-permissions` enfermé dans un **bubblewrap** qui
contraint l'accès au filesystem. Claude Code consomme le serveur MCP `hq`
via `.mcp.json`, qui écrit directement dans la base SQLite du projet. Le
daemon observe le bus d'events et réveille les reviewers event-driven.

## Commandes quotidiennes

```bash
# Gestion projets
hq init                              # scaffold .hq/ dans le cwd
hq list                              # projets enregistrés
hq unregister <name>

# Agents
hq agent new <name> --role worker --gender female
hq agent list
hq agent run <name>                  # trigger un heartbeat manuel
hq agent attach <name>               # print la cmd tmux attach
hq agent archive <name>
hq agent restore <name>

# Tasks
hq task add "Title" --priority 2 --package api
hq task list
hq task show <id>
hq task unblock <id>

# Daemon
hq daemon start                      # foreground, avec UI sur :7433
hq daemon install-service            # systemd --user unit
hq usage                             # snapshot du quota Claude Max

# Debug / itération
hq debug reset --all                 # kill tmux, purge worktrees, wipe DBs
hq debug test --reset --agents alice:worker,bob:reviewer --tasks 5
```

## Rôles d'agents

| Rôle | Capabilities | Usage |
|---|---|---|
| `worker` | claim, commit, review | Exécute les tasks `todo` |
| `reviewer` | review seulement | Valide le travail des workers |
| `boss` | create/promote tasks, review | Planifie depuis les goals, coordonne |
| `readonly` | read seulement | Audit, observation |

Override fin possible dans `agent.toml` section `[capabilities]`.

## Règles et garde-fous

`project.toml` accepte des `[[rules]]` compilées en hooks Claude Code
`PreToolUse`. Exemples :

```toml
# Lock files protégés
[[rules]]
id = "lock-files"
protected_paths = ["pnpm-lock.yaml", "package-lock.json"]

# Docs installer obligatoires
[[rules]]
id = "installer-untouchable"
match = "packages/installer/**"
action = "block"

# Ownership par package
[[rules]]
id = "core-owner"
match = "packages/core/**"
owner = "lucas"

# Bash patterns bannis (au-delà du bash-gate par défaut)
[[rules]]
forbid_commands = ["curl .*\\| *sh", "dd if=", "mkfs"]
```

## Hot reload pendant le dev UI

```bash
cd /path/to/HQ
bun --watch packages/cli/src/bin.ts daemon start
```

Le process redémarre <1s après chaque sauvegarde de fichier. Le navigateur
reconnecte sa SSE automatiquement.

## Troubleshooting

### bwrap : "setting up uid map: Permission denied"

Ubuntu 24+ restreint les user namespaces via AppArmor. Fix :
```bash
echo "kernel.apparmor_restrict_unprivileged_userns = 0" | sudo tee /etc/sysctl.d/60-userns.conf
sudo sysctl --system
```

### bwrap : "Can't chdir"

Le bind du worktree est masqué par un `--tmpfs /tmp`. Ça ne devrait plus
arriver avec la v0.2+ (reorder du mount). Vérifier en comparant `sandbox.ts`.

### Claude TUI reste vide dans tmux

Plusieurs causes possibles :
1. Pane trop petit (80x24 par défaut) — on force 200x50 via `-x -y`
2. Trust dialog jamais accepté — `preApproveTrust()` écrit dans `~/.claude.json`
3. `.mcp.json` présent mais serveur pas activé — `enabledMcpjsonServers: ["hq"]` est écrit automatiquement
4. `~/.claude.json` pas writable dans le sandbox — binding explicite ajouté

Si l'un de ces cas revient : `hq debug reset --all && hq debug test --reset`.

### "Cannot find module 'react/jsx-dev-runtime'"

C'est Bun qui ne lit pas `jsxImportSource` de ton tsconfig à runtime. Le
`bunfig.toml` au root du repo force `jsx = "react-jsx"` +
`jsxImportSource = "hono/jsx"`.

### Agent bloqué `working` sans rien faire

Le reaper timeout (défaut 15min) le remettra `idle`. Pour accélérer,
édite `project.toml` : `heartbeat.default_timeout_minutes = 5`. Après 3
timeouts (retry_max=2), l'agent passe `blocked` automatiquement.

### Rules engine refuse tout

Fail-closed quand `project.toml` est illisible. Check TOML syntax avec
`hq task list` qui le re-parse ; si ça crash, corrige le fichier.

## Dev

```bash
pnpm install
pnpm -r typecheck
pnpm test             # 39+ tests sur core (state machine, rules, config, avatar)
```

CI GitHub Actions tourne le même pipeline sur chaque PR.

## Roadmap

Voir [ROADMAP.md](./ROADMAP.md) pour l'état complet MVP → v1.
