# HQ

Orchestrateur d'équipes d'agents Claude Code autonomes.
Un kanban local persistant + un daemon central + des sessions tmux pilotées automatiquement.

> État : scaffold initial. Voir [DESIGN.md](./DESIGN.md) pour la spec complète.

## Packages

| Package | Rôle |
|---|---|
| `@hq/core` | Domaine, schéma DB Drizzle, state machine des tasks, moteur de règles |
| `@hq/daemon` | Scheduler central, orchestration tmux, gestion des heartbeats |
| `@hq/mcp` | Serveur MCP exposé aux agents (tools : claim_task, add_comment, ...) |
| `@hq/cli` | CLI `hq` (init, agent, task, goal, run, pause, daemon, board) |
| `@hq/ui` | Dashboard web live (Bun + HTMX + SSE + Tailwind) |

## Démarrage

```bash
bun install
bun run typecheck
```

## Licence

Propriétaire pour l'instant. Bascule MIT envisagée à la v1.
