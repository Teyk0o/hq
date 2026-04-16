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
- [x] **6. Auto-resume après auto-pause budget** — on pause mais jamais on reprend au reset. *(QuotaPoller détecte la transition paused→resumed, émet `daemon.quota_paused` / `daemon.quota_resumed` sur le bus, respecte resume_on_reset)*
- [x] **7. Hot reload SOUL.md / agent.toml** — documenté, à vérifier en conditions réelles. *(buildHeartbeatPrompt lit SOUL à chaque heartbeat + trace mtime, log explicite "SOUL updated" quand l'operator a édité)*

### Safety / garde-fous

- [x] **8. Rules engine réel** — `[[rules]]` dans `project.toml` sont juste des données, aucune compilation en hooks Claude. Seul le bash-gate est actif. Les règles `require=doc_update`, `protected_paths`, `owner` n'existent pas encore. *(match + action=block/warn, protected_paths, owner, forbid_commands supportés. require=doc_update (qui exige un tracking de session cross-tool) reste à faire.)*
- [x] **9. Transactions SQLite** — changements multi-tables (task + activity + review) ne sont pas atomiques. *(claim_task, submit_review, end/start_heartbeat, addComment+messages wrappés dans db.transaction)*
- [x] **10. Audit log** — qui a appelé quel tool MCP quand ? Pas tracé. *(chaque tool call écrit une ligne activity `mcp.<tool>` avec input tronqué et outcome)*
- [x] **11. Race conditions sur `claim_task`** — deux agents peuvent en théorie race-claim la même task (pas de verrou DB).

### Git & code flow

- [x] **12. Link branche ↔ task** — MCP `submit_for_review` devrait forcer que la branche soit bien `agent/<name>/task-<id>` et que la task ait des commits. *(claim_task stamp la branche attendue, submitForReview vérifie le git state réel et refuse avec des McpError typées)*
- [x] **13. Push avec auth** — aujourd'hui `git push` naïf ; SSH keys du sandbox sont lisibles mais pas testés sous bwrap. *(bwrap ro-bind ~/.ssh, ~/.gitconfig, ~/.netrc, ~/.config/git ; push UI surface stderr comme 422 JSON error)*
- [x] **14. PR/MR auto sur `approved`** — ou au moins bouton qui ouvre l'URL GitLab/GitHub. *(détection host github/gitlab via remote, invoke gh pr create / glab mr create, URL stockée dans tasks.pr_url, lien Open PR dans le drawer)*
- [x] **15. Diff / git log dans le drawer** — tu ne peux pas voir le code produit sans `cd worktrees/agent && git log`.
- [x] **16. Gestion conflits** — quand `main` a avancé pendant qu'un agent bossait, que fait-on ? *(sur Push: git fetch + git rebase origin/default_branch ; conflit → rebase --abort + task blocked avec reason, humain/agent reprend en main)*

### Stabilité

- [x] **17. Migrations DB** — drizzle-kit configuré mais les migrations générées ne sont pas exécutées ; le schéma vit dans `schema-ddl.ts` embarqué dans l'init, divergence possible. *(schema unifié dans @hq/core, appliqué idempotent par openProjectDb — drizzle-kit migrations reste à câbler proprement)*
- [x] **18. Cleanup tmux orphelines** — si le daemon crashe, les sessions tmux survivent mais personne ne les réconcilie.
- [x] **19. Heartbeat reaper** — code existe, jamais observé en timeout réel. *(reaper retourne ReapResult, tests unitaires qui simulent stale+retry+giveUp, logs par agent)*
- [x] **20. Erreurs MCP** — remontent en exception brute, devraient retourner du JSON structuré que l'agent peut gérer.

## 🟡 Important pour l'expérience v1

### UI / UX manquants

- [x] **21. Création de task dans l'UI** — CLI only aujourd'hui.
- [x] **22. Édition de goals dans l'UI**. *(/goals CRUD: create + pause/activate toggle + delete, open-tasks counter, bus events)*
- [x] **23. Filtres board** (par assignee, priority, package, goal).
- [x] **24. Search** (par titre ou ID). *(search par titre via input `search`, ID au hover)*
- [x] **25. Comments humains** — peut review mais pas commenter.
- [x] **26. Pause/resume par agent** (pas que global). *(status 'paused' distinct de 'paused_quota', boutons sur agent card, scheduler skip)*
- [x] **27. Archived agents filter** — une fois archivé, introuvable dans l'UI. *(toggle ?archived=1 sur /agents + bouton Archive/Restore par card)*
- [x] **28. Vue multi-projets** (`/board/all`) — mentionnée DESIGN, pas codée. *(grid de project summary cards avec counts + agents stack + shortcut sidebar)*
- [x] **29. Settings page** — voir la config compilée, éditer les seuils. *(read-only, sections Project/Scheduler/Heartbeat/Kanban/Sandbox/Rules&Goals, path hint vers project.toml)*
- [x] **30. Dashboard metrics** (throughput, tokens/projet/semaine, velocity). *(/metrics: 7d throughput bar chart, tokens/heartbeats totals, top agents shipped, pipeline by status)*
- [x] **31. Loading skeletons** au lieu de "loading…". *(CSS .skel shimmer pour usage widget + sidebar team + anywhere)*
- [x] **32. Error toasts** quand une action HTMX foire.
- [x] **33. Inbox messages inter-agents** — `send_message` marche côté MCP, pas de vue UI.

### Observabilité

- [x] **34. Logs viewer UI** — les logs tmux sont sur disque, pas de UI pour tail/search. *(bouton Logs sur card agent ouvre le dernier heartbeat, log ANSI-stripped dans le drawer)*
- [x] **35. Daemon health endpoint** — est-ce qu'il tourne ? dernier tick ?  *(/api/health JSON + /health/widget HTML dans sidebar, refresh 30s)*
- [x] **36. Métriques agents** — temps idle/working par jour, tokens utilisés. *(shipped/beats/tokens today + swatches des 12 derniers heartbeats cliquables)*
- [x] **37. Structured logging** — `console.log` partout, pas de niveaux. *(@hq/core createLogger avec levels debug/info/warn/error, scoping child, HQ_LOG_LEVEL + HQ_LOG_FORMAT=json)*
- [x] **38. Replay d'un heartbeat** — revoir ce qu'un agent a fait il y a 2h. *(/heartbeats/:id drawer : metadata + activity timeline + log ANSI-stripped)*

### Notifications

- [x] **39. Discord webhook** — code écrit, jamais testé. *(bus subscriber POST embed Discord pour chaque event configuré dans project.toml, fire-and-forget)*
- [x] **40. Browser Notification API** — toast only pour l'instant. *(bouton sidebar, permission persistée localStorage, notifs sur review/blocked/message quand tab hors focus)*
- [ ] **41. Digest quotidien** — résumé de la journée d'agents.

## 🟢 Polish / nice-to-have pour une v1

### Agents & scheduler

- [x] **42. Load balancing** — éviter qu'un agent prenne toutes les tasks. *(scheduler trie les idle par tokens_today asc + last_heartbeat asc, les plus "froids" passent en premier)*
- [x] **43. Agent capabilities check** — si un agent n'a pas les tools requis par la task, pas assignable. *(scope.packages agent vs task.package, claim refuse avec McpError 'out_of_scope')*
- [x] **44. Dépendances de tasks** — `blocked` quand dep pas done, auto-unblock. *(claim refuse si dep pas done, push auto-unblock les dépendants dont toutes les deps sont done)*
- [ ] **45. Stop propre d'un agent** — `hq agent stop` (kill tmux + mark idle).

### Sécurité (défense en profondeur)

- [x] **46. Bash gate à l'intérieur du sandbox** — aujourd'hui il tourne côté host via le hook, devrait être dans le bwrap. *(vérifié : le hook est spawné par Claude qui tourne dans bwrap, donc le hook hérite des namespaces. Doc ajoutée dans bash-gate.ts.)*
- [x] **47. `~/.claude/.credentials.json` RW** — agent pourrait read/write ; envisager un bind read-only avec un symlink writable minimal. *(--ro-bind-try overlay sur le fichier spécifique, par-dessus le --bind writable de ~/.claude)*
- [x] **48. Audit des commandes Bash** — logger chaque commande exécutée. *(bash-gate écrit une ligne activity bash.allowed / bash.denied avec commande tronquée + reason, best-effort)*
- [x] **49. Mode "full readonly"** — pour un agent audit 100% qui ne peut rien modifier. *(agent.toml readonly_strict=true, rules-gate refuse Edit/Write/MultiEdit/NotebookEdit avant même d'évaluer les règles projet)*

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

## Sprints

### ✅ Sprint A — faire fonctionner pour de vrai

Items 1, 2-3, 4, 11, 17, 18, 20. Scheduler cron, peer-review auto-gates,
goals→tasks, claim locking race-free, migrations, tmux reaper, MCP errors
structured.

### ✅ Sprint B — human UX

Items 15, 21, 23, 24, 25, 32, 33. Task creation UI, filtres board, search,
comments humains, git diff dans drawer, error toasts, inbox.

### ✅ Sprint C — safety

Items 8, 9, 10, 11. Rules engine compilé, transactions, audit log, claim
locking.

### ✅ Sprint D — ops & v1 ship

Items 39, 50, 54, 55-58, 60-62. Discord webhook, mobile-friendly, docs
utilisateur, tests unitaires, CI GitHub Actions.

---

### ✅ Sprint E — Git flow production-ready (4 items)

> Objectif : HQ utilisable sur un vrai repo avec un vrai remote.

- **12. Link branche ↔ task** — `submit_for_review` exige que la branche soit
  `agent/<name>/task-<id>` et qu'elle contienne des commits. Refuse sinon.
- **13. Push avec auth** — tester SSH keys dans le sandbox (bind ~/.ssh RO),
  gérer HTTPS + token via netrc ou credential helper.
- **14. PR/MR auto sur `approved`** — créer une MR GitLab / PR GitHub via
  `gh` ou `glab` quand l'humain clique Push ; ouvre l'URL en retour.
- **16. Gestion conflits** — si la branche de l'agent ne fast-forward pas,
  tenter rebase auto ; sinon transition `blocked` avec `blocked_reason`.

### ✅ Sprint F — Autonomy robustness (6 items)

> Objectif : l'orchestration tient sur la durée sans intervention.

- **6. Auto-resume après auto-pause budget** — au reset du quota
  hebdomadaire, le daemon reprend les ticks au lieu de rester pausé.
- **7. Hot reload SOUL.md / agent.toml** — valider en conditions réelles
  que les modifs sont bien prises au prochain heartbeat.
- **19. Heartbeat reaper observé** — chaos-test : simuler un crash de
  claude, vérifier que le reaper timeout + unclaim + retry fonctionnent.
- **42. Load balancing** — éviter qu'un worker prenne toutes les tasks ;
  distribuer selon `tokens_today` et `current_task_id`.
- **43. Agent capabilities check** — marquer les tasks avec les tools
  requis, skip les agents qui n'ont pas ces tools.
- **44. Dépendances de tasks** — enforcer `task_dependencies`, bloquer
  tant que les deps ne sont pas `done`, auto-unblock au reverse.

### ✅ Sprint G — Human UX complete (7 items)

> Objectif : l'UI couvre tous les workflows humain, plus de CLI obligatoire.

- **22. Édition de goals dans l'UI** — page `/goals` CRUD.
- **26. Pause/resume par agent** — bouton dans la card agent.
- **27. Archived agents filter** — toggle "show archived" sur `/agents`.
- **28. Vue multi-projets** (`/board/all`) — grille de projets en ligne.
- **29. Settings page** — vue read-only du `project.toml` compilé,
  éditeur pour les seuils simples (interval, timeout, budget).
- **31. Loading skeletons** au lieu de `"loading…"` text.
- **40. Browser Notification API** — ask permission une fois, push une
  notif système pour les events critiques (review, blocked).

### ✅ Sprint H — Observability (6 items)

> Objectif : quand un agent déconne, on sait pourquoi en 10 secondes.

- **30. Dashboard metrics** — throughput tasks/jour, tokens/semaine par
  projet, velocity par agent.
- **34. Logs viewer UI** — tail live d'un heartbeat log, filtres.
- **35. Daemon health endpoint** — `/api/health` + widget "daemon: ok
  — dernier tick il y a 23s" en sidebar.
- **36. Métriques agents** — temps idle/working par jour, tokens utilisés,
  tasks shippées (graphiques simples dans la page Agents).
- **37. Structured logging** — remplacer `console.log` par un logger
  avec levels (debug/info/warn/error) et un output JSON optionnel pour
  l'ingestion externe.
- **38. Replay d'un heartbeat** — cliquer sur une ligne `heartbeats`
  ouvre un drawer avec le log, les tools appelés, les events émis.

### ✅ Sprint I — Safety hardening (4 items)

> Objectif : défense en profondeur sur le sandbox.

- **46. Bash gate à l'intérieur du sandbox** — aujourd'hui le hook s'exécute
  côté host ; si un agent casse bwrap, le hook tombe avec. Embarquer
  `hq bash-gate` dans le bind read-only et le lancer depuis dedans.
- **47. `~/.claude/.credentials.json` en read-only** — créer un symlink
  vers une copie dans un dir bind séparé, pour qu'un agent ne puisse
  pas overwrite les credentials de l'humain.
- **48. Audit des commandes Bash** — chaque commande Bash acceptée par
  bash-gate est loggée dans `activity` avec l'agent + commande tronquée.
- **49. Mode "full readonly"** — flag `readonly_strict=true` dans
  agent.toml qui force même les `Write`/`Edit` à passer par rules-gate
  avec un refus global.

### ⏳ Sprint J — Ops & packaging (5 items)

> Objectif : déployable, upgradable, sauvegardable.

- **45. Stop propre d'un agent** — `hq agent stop <name>` : kill tmux,
  mark idle, annule les retries en cours.
- **50. systemd service end-to-end** — `hq daemon install-service`,
  `systemctl --user enable --now hq`, vérifier que ça tourne au reboot.
- **51. Packaging binaire** — `bun build --compile packages/cli/src/bin.ts`,
  publier un binaire par release pour distribution sans node_modules.
- **52. Backup auto** — script cron user qui zip `~/.hq/registry.sqlite`
  + chaque `<project>/.hq/db.sqlite` une fois par jour.
- **53. Migration path** — versioning du schema via une table `meta`,
  migrations générées par drizzle-kit dans `@hq/core/src/db/migrations/`.

### ⏳ Sprint K — Tests, perf, polish final (5 items)

> Objectif : passer les 39 tests unitaires à une vraie suite + perf.

- **41. Digest quotidien** — résumé du jour envoyé par Discord à
  21h : N tasks shippées, N bloquées, top 3 agents actifs.
- **59. DESIGN.md public avec captures** — screenshots du kanban, du
  drawer, de l'inbox ; publier sur le repo public.
- **63. Integration test** — spawn un projet dummy dans `/tmp`, lancer
  un agent fake en process séparé qui appelle le MCP, vérifier la DB
  à chaque étape. Tourne dans la CI.
- **64. DB pooling UI** — cacher les `Database` handles par projet
  plutôt que d'en ouvrir un par requête HTTP.
- **65. SSE fanout optimization** — remplacer le single `EventEmitter`
  par un pub/sub plus scalable si on dépasse ~10 clients SSE simultanés
  (probable jamais atteint pour usage solo, mais prêt pour le cas).

---

## Totaux

- Items faits : 31
- Items restants : 34
- Sprints restants : 7 (E à K)
- Estimation : ~2-3h chacun, soit ~15-21h pour boucler la v1

