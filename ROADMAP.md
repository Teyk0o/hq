# HQ — MVP → v1 roadmap

> Status après session smoke test : alice peut exécuter un heartbeat complet
> end-to-end (bwrap + Claude + MCP + kanban + UI live). Ce document liste tout
> ce qui manque pour passer d'un MVP fonctionnel à une v1 utilisable.

## 🔴 Must-have pour une v1 utilisable

### Autonomie (le cœur)

- [x] **1. Scheduler cron activé** — aujourd'hui tout est manuel (`hq agent run`). Le daemon a le code croner mais il n'est jamais exercé avec des agents qui tournent en continu. *(logging visible ajouté au boot et à chaque tick, validation live à faire)*
- [x] **2. Gate `peer_review → review` auto** — le code compte les approvals mais ne déclenche pas la transition.
- [x] **3. Gate `peer_review → in_progress` sur `changes_requested`** — pas câblée.
- [x] **4. Goals → tasks auto-gen** — boss agent est censé créer N tasks/semaine depuis les goals, jamais implémenté. *(goals + throughput récent injectés dans le prompt des agents can_create_tasks, protocole étendu pour les pousser à créer/promouvoir)*
- [x] **5. Retry sur crash/timeout** — `retry_max` configuré, jamais lu. *(reaper incrémente retry_count, agent marque blocked après retry_max timeouts)*
- [ ] **6. Auto-resume après auto-pause budget** — on pause mais jamais on reprend au reset.
- [ ] **7. Hot reload SOUL.md / agent.toml** — documenté, à vérifier en conditions réelles.

### Safety / garde-fous

- [x] **8. Rules engine réel** — `[[rules]]` dans `project.toml` sont juste des données, aucune compilation en hooks Claude. Seul le bash-gate est actif. Les règles `require=doc_update`, `protected_paths`, `owner` n'existent pas encore. *(match + action=block/warn, protected_paths, owner, forbid_commands supportés. require=doc_update (qui exige un tracking de session cross-tool) reste à faire.)*
- [x] **9. Transactions SQLite** — changements multi-tables (task + activity + review) ne sont pas atomiques. *(claim_task, submit_review, end/start_heartbeat, addComment+messages wrappés dans db.transaction)*
- [x] **10. Audit log** — qui a appelé quel tool MCP quand ? Pas tracé. *(chaque tool call écrit une ligne activity `mcp.<tool>` avec input tronqué et outcome)*
- [x] **11. Race conditions sur `claim_task`** — deux agents peuvent en théorie race-claim la même task (pas de verrou DB).

### Git & code flow

- [ ] **12. Link branche ↔ task** — MCP `submit_for_review` devrait forcer que la branche soit bien `agent/<name>/task-<id>` et que la task ait des commits.
- [ ] **13. Push avec auth** — aujourd'hui `git push` naïf ; SSH keys du sandbox sont lisibles mais pas testés sous bwrap.
- [ ] **14. PR/MR auto sur `approved`** — ou au moins bouton qui ouvre l'URL GitLab/GitHub.
- [x] **15. Diff / git log dans le drawer** — tu ne peux pas voir le code produit sans `cd worktrees/agent && git log`.
- [ ] **16. Gestion conflits** — quand `main` a avancé pendant qu'un agent bossait, que fait-on ?

### Stabilité

- [x] **17. Migrations DB** — drizzle-kit configuré mais les migrations générées ne sont pas exécutées ; le schéma vit dans `schema-ddl.ts` embarqué dans l'init, divergence possible. *(schema unifié dans @hq/core, appliqué idempotent par openProjectDb — drizzle-kit migrations reste à câbler proprement)*
- [x] **18. Cleanup tmux orphelines** — si le daemon crashe, les sessions tmux survivent mais personne ne les réconcilie.
- [ ] **19. Heartbeat reaper** — code existe, jamais observé en timeout réel.
- [x] **20. Erreurs MCP** — remontent en exception brute, devraient retourner du JSON structuré que l'agent peut gérer.

## 🟡 Important pour l'expérience v1

### UI / UX manquants

- [x] **21. Création de task dans l'UI** — CLI only aujourd'hui.
- [ ] **22. Édition de goals dans l'UI**.
- [x] **23. Filtres board** (par assignee, priority, package, goal).
- [x] **24. Search** (par titre ou ID). *(search par titre via input `search`, ID au hover)*
- [x] **25. Comments humains** — peut review mais pas commenter.
- [ ] **26. Pause/resume par agent** (pas que global).
- [ ] **27. Archived agents filter** — une fois archivé, introuvable dans l'UI.
- [ ] **28. Vue multi-projets** (`/board/all`) — mentionnée DESIGN, pas codée.
- [ ] **29. Settings page** — voir la config compilée, éditer les seuils.
- [ ] **30. Dashboard metrics** (throughput, tokens/projet/semaine, velocity).
- [ ] **31. Loading skeletons** au lieu de "loading…".
- [x] **32. Error toasts** quand une action HTMX foire.
- [x] **33. Inbox messages inter-agents** — `send_message` marche côté MCP, pas de vue UI.

### Observabilité

- [ ] **34. Logs viewer UI** — les logs tmux sont sur disque, pas de UI pour tail/search.
- [ ] **35. Daemon health endpoint** — est-ce qu'il tourne ? dernier tick ?
- [ ] **36. Métriques agents** — temps idle/working par jour, tokens utilisés.
- [ ] **37. Structured logging** — `console.log` partout, pas de niveaux.
- [ ] **38. Replay d'un heartbeat** — revoir ce qu'un agent a fait il y a 2h.

### Notifications

- [x] **39. Discord webhook** — code écrit, jamais testé. *(bus subscriber POST embed Discord pour chaque event configuré dans project.toml, fire-and-forget)*
- [ ] **40. Browser Notification API** — toast only pour l'instant.
- [ ] **41. Digest quotidien** — résumé de la journée d'agents.

## 🟢 Polish / nice-to-have pour une v1

### Agents & scheduler

- [ ] **42. Load balancing** — éviter qu'un agent prenne toutes les tasks.
- [ ] **43. Agent capabilities check** — si un agent n'a pas les tools requis par la task, pas assignable.
- [ ] **44. Dépendances de tasks** — `blocked` quand dep pas done, auto-unblock.
- [ ] **45. Stop propre d'un agent** — `hq agent stop` (kill tmux + mark idle).

### Sécurité (défense en profondeur)

- [ ] **46. Bash gate à l'intérieur du sandbox** — aujourd'hui il tourne côté host via le hook, devrait être dans le bwrap.
- [ ] **47. `~/.claude/.credentials.json` RW** — agent pourrait read/write ; envisager un bind read-only avec un symlink writable minimal.
- [ ] **48. Audit des commandes Bash** — logger chaque commande exécutée.
- [ ] **49. Mode "full readonly"** — pour un agent audit 100% qui ne peut rien modifier.

### Déploiement

- [ ] **50. systemd service testé** — le fichier est généré mais jamais exercé.
- [ ] **51. Packaging binaire** (`bun build --compile`) pour distribution sans node_modules.
- [ ] **52. Backup auto** de `~/.hq/registry.sqlite` + project DBs.
- [ ] **53. Migration path** entre versions HQ (schema DB qui évolue).
- [x] **54. Mobile-friendly UI** — sidebar collapse sur petit écran. *(media query <900px : sidebar devient overlay slidable via bouton menu, drawer en pleine largeur, header tightened)*

### Documentation

- [x] **55. README utilisateur** — actuellement scaffold-level.
- [x] **56. Guide d'onboarding projet** — comment créer un SOUL.md efficace. *(docs/SOUL-templates.md)*
- [x] **57. Exemples de templates SOUL.md** — boss, worker, reviewer, devil's advocate. *(docs/SOUL-templates.md)*
- [x] **58. Troubleshooting** — erreurs courantes (bwrap userns, tmux, mcp.json). *(section dans README.md)*
- [ ] **59. DESIGN.md public** avec captures d'écran.

### Tests

- [x] **60. 0 test automatisé aujourd'hui** — au minimum : state machine, rules engine, TOML parsers. *(39 tests bun:test sur domain, rules, config, avatar)*
- [x] **61. Smoke test scripté** — `hq debug test` est manuel. *(hq debug test --reset joue scenario complet)*
- [x] **62. CI GitHub Actions** — typecheck + tests. *(.github/workflows/ci.yml : pnpm install + typecheck + bun test)*
- [ ] **63. Integration test** — spawn un projet dummy, lancer un agent fake, vérifier la DB.

### Perf

- [ ] **64. DB pooling UI** — `new Database()` par requête, OK pour quelques utilisateurs, limitant au-delà.
- [ ] **65. SSE fanout optimization** — un seul `EventEmitter`, peut bloquer avec N clients.

---

## Sprints proposés

### Sprint A — faire fonctionner pour de vrai

- 1 Scheduler cron activé
- 2-3 Peer-review auto-transitions
- 4 Goals→tasks (minimum viable)
- 17 Migrations propres
- 18 Cleanup tmux orphelines
- 20 Erreurs MCP structurées

### Sprint B — human UX

- 21 Task creation UI
- 23 Filtres board
- 25 Comments humains
- 15 Git diff dans drawer
- 32 Error toasts
- 33 Inbox messages

### Sprint C — safety

- 8 Rules engine réel
- 9 Transactions
- 10 Audit log
- 11 Claim locking

### Sprint D — ops & v1 ship

- 39 Discord testé
- 50 systemd testé
- 54 Mobile-friendly
- 55-58 Docs
- 60-62 Tests de base
