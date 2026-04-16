# Security Policy

## Reporting a vulnerability

**Do not open a public issue.** Do not email anyone.

Report vulnerabilities through GitHub's private vulnerability reporting:

> **[Report a vulnerability →](https://github.com/Teyk0o/hq/security/advisories/new)**

This opens a private advisory that only the maintainers and the people
you invite can see. You'll get updates directly in the advisory thread.

## What to include

- A short description of the issue and the impact you see.
- Exact steps or a minimal proof-of-concept.
- The HQ version (`hq --version`) and Bun version (`bun --version`).
- Whether the issue is reachable by a remote attacker, requires local
  access, or requires a malicious project / agent config.

## Scope

HQ is designed to run **locally** for a single operator. Interesting
attack surfaces:

- The MCP server trusts the agent identity passed via `--agent`; a
  malicious agent TOML could request elevated capabilities.
- The bubblewrap sandbox is the main containment boundary for what an
  agent can touch on disk; an escape is in scope.
- The Claude Code `PreToolUse` hooks (`hq bash-gate`, `hq rules-gate`)
  enforce `project.toml` rules — a bypass is in scope.
- The web UI listens on `127.0.0.1:7433` by default; exposing it to a
  network is the operator's call, but auth-bypass or XSS in the UI is
  in scope.
- Reports about dependency vulnerabilities pulled in via `bun install`
  are welcome but not urgent unless they're exploitable through HQ.

Out of scope:

- Denial of service through crafted `project.toml` that makes the
  rules engine slow — fail-closed is the intended behaviour.
- Social engineering of a human approver through crafted task titles
  or Discord webhook output.

## Response

- Acknowledgement within 72 hours.
- A fix or decision (accept / wontfix) within 14 days for issues we
  confirm.
- Coordinated disclosure once a fix is released; you'll be credited in
  the advisory unless you prefer anonymity.
