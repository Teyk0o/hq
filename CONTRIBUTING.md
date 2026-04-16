# Contributing to HeadQuarter

Thanks for considering a contribution. This is a small project with a few
load-bearing assumptions — knowing them up-front saves everyone time.

## Before opening a PR

1. **Discuss first for anything non-trivial.** Open a
   [discussion](https://github.com/Teyk0o/hq/discussions) or an issue
   describing the change. Small bug fixes and docs tweaks don't need this.
2. **Keep PRs focused.** One concern per PR. A bug fix and a refactor
   should be two PRs.
3. **Commits use [Conventional Commits](https://www.conventionalcommits.org/)**
   in English — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`,
   `perf:`, `build:`, `ci:`. Use a scope when helpful: `feat(daemon): …`.

## Dev setup

```bash
git clone https://github.com/Teyk0o/hq.git && cd hq
bun install          # or pnpm install
```

Run the full check suite:

```bash
pnpm -r typecheck
pnpm test            # 104+ unit + e2e tests, serial under --max-concurrency 1
pnpm build
```

The CI runs the same pipeline on every PR (`.github/workflows/ci.yml`).

## Architecture in 30 seconds

Six packages under `packages/`:

- `@hq/core` — SQLite schema, task state machine, rules engine
- `@hq/mcp` — MCP server (16 tools agents consume)
- `@hq/daemon` — scheduler, tmux wrapper, bubblewrap sandbox, webhooks
- `@hq/usage` — Claude Max quota probe
- `@hq/cli` — `hq` binary (Commander.js)
- `@hq/ui` — Hono + HTMX + SSE dashboard

Agents never touch the DB or filesystem directly — everything flows
through the MCP layer. If your change adds a new interaction surface,
it almost certainly belongs as an MCP tool.

## Testing

- **Unit tests** live in `packages/*/test/*.test.ts` and run with `bun:test`.
- **E2E tests** (under `packages/mcp/test/e2e*.test.ts`) spawn the real
  MCP server as a subprocess and drive it over JSON-RPC. No mocks, no
  tmux, no Claude — they assert the contract agents depend on.
- **Keep the bar high**: every new MCP tool gets at least one E2E test;
  every new task-status transition gets a state-machine test.

Run a single file:

```bash
bun test --timeout 30000 packages/mcp/test/e2e.test.ts
```

## Docs

- `docs/GUIDE.md` — human-facing guide. Update it when you add user-
  visible behaviour, config keys, CLI commands, or rules.
- `docs/CLAUDE.md` — reference for Claude agents being told to install
  HQ. Update it when you add a new MCP tool or change the protocol.

README.md is a landing page — keep it short; full content goes in
`docs/`.

## Reviews

- One approving review is required before merge (enforced by the main
  branch ruleset).
- CI (`typecheck + test`) must pass.
- Rebase or squash merges preferred over merge commits for feature PRs;
  longer-lived branches can merge with `--no-ff`.

## Questions

Open a [discussion](https://github.com/Teyk0o/hq/discussions) — faster
than an issue for open-ended questions.
