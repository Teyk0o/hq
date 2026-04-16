import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { openProjectDb } from '@hq/core';

const BIN = new URL('../src/bin.ts', import.meta.url).pathname;

interface GateResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runGate(
  command: 'bash-gate' | 'rules-gate',
  project: string,
  agent: string,
  payload: Record<string, unknown>,
): Promise<GateResult> {
  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', BIN, command, '--project', project, '--agent', agent], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

function freshProject(overrides?: {
  bash?: { allow_prefixes?: string[]; deny_patterns?: string[] };
  rules?: unknown[];
  readonly_strict?: boolean;
}): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'hq-gate-test-'));
  const hqDir = join(root, '.hq');
  mkdirSync(join(hqDir, 'agents'), { recursive: true });
  const allow = overrides?.bash?.allow_prefixes?.map((p) => `"${p}"`).join(', ') ?? '"git ", "ls"';
  const deny = overrides?.bash?.deny_patterns?.map((p) => `"${p}"`).join(', ') ?? '"rm -rf /"';
  const rulesBlock = overrides?.rules
    ? overrides.rules
        .map((r) => `[[rules]]\n${Object.entries(r as Record<string, unknown>).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n')}`)
        .join('\n')
    : '';
  writeFileSync(
    join(hqDir, 'project.toml'),
    `[project]
name = "gate-test"
default_branch = "main"

[bash]
allow_prefixes = [${allow}]
deny_patterns = [${deny}]

${rulesBlock}
`,
    'utf-8',
  );
  writeFileSync(
    join(hqDir, 'agents', 'alice.toml'),
    `[agent]
name = "alice"
role = "worker"
soul = "alice.md"
${overrides?.readonly_strict ? 'readonly_strict = true' : ''}
`,
    'utf-8',
  );
  writeFileSync(join(hqDir, 'agents', 'alice.md'), '# alice\n', 'utf-8');
  openProjectDb(join(hqDir, 'db.sqlite'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe('bash-gate subprocess', () => {
  let scenario: { root: string; cleanup: () => void };
  beforeAll(() => {
    scenario = freshProject({
      bash: { allow_prefixes: ['git ', 'ls'], deny_patterns: ['rm -rf /'] },
    });
  });
  afterAll(() => scenario.cleanup());

  test('allowed prefix → exit 0 + audit row', async () => {
    const r = await runGate('bash-gate', scenario.root, 'alice', {
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
    });
    expect(r.code).toBe(0);
    const db = new Database(join(scenario.root, '.hq', 'db.sqlite'));
    const row = db
      .prepare(`SELECT action, details FROM activity WHERE action = 'bash.allowed' ORDER BY created_at DESC LIMIT 1`)
      .get() as { action: string; details: string };
    expect(row.action).toBe('bash.allowed');
    expect(JSON.parse(row.details).command).toBe('git status');
    db.close();
  });

  test('denied pattern → exit 2 + stderr + audit row', async () => {
    const r = await runGate('bash-gate', scenario.root, 'alice', {
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /etc/passwd' },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('denied by pattern');
    const db = new Database(join(scenario.root, '.hq', 'db.sqlite'));
    const row = db
      .prepare(`SELECT action FROM activity WHERE action = 'bash.denied' ORDER BY created_at DESC LIMIT 1`)
      .get() as { action: string };
    expect(row.action).toBe('bash.denied');
    db.close();
  });

  test('not whitelisted → exit 2', async () => {
    const r = await runGate('bash-gate', scenario.root, 'alice', {
      tool_name: 'Bash',
      tool_input: { command: 'curl https://example.com' },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('not in allow_prefixes');
  });

  test('non-Bash tools pass through', async () => {
    const r = await runGate('bash-gate', scenario.root, 'alice', {
      tool_name: 'Read',
      tool_input: { file_path: 'README.md' },
    });
    expect(r.code).toBe(0);
  });
});

describe('rules-gate subprocess', () => {
  test('protected_paths globs block + exit 2', async () => {
    const scenario = freshProject({
      rules: [{ id: 'lock', protected_paths: ['pnpm-lock.yaml'] }],
    });
    try {
      const r = await runGate('rules-gate', scenario.root, 'alice', {
        tool_name: 'Write',
        tool_input: { file_path: 'pnpm-lock.yaml' },
      });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('rules-gate');
    } finally {
      scenario.cleanup();
    }
  });

  test('owner rule lets owner through, blocks others', async () => {
    const scenario = freshProject({
      rules: [{ match: 'packages/core/**', owner: 'lucas' }],
    });
    try {
      const other = await runGate('rules-gate', scenario.root, 'alice', {
        tool_name: 'Edit',
        tool_input: { file_path: 'packages/core/src/foo.ts' },
      });
      expect(other.code).toBe(2);

      const own = await runGate('rules-gate', scenario.root, 'lucas', {
        tool_name: 'Edit',
        tool_input: { file_path: 'packages/core/src/foo.ts' },
      });
      expect(own.code).toBe(0);
    } finally {
      scenario.cleanup();
    }
  });

  test('readonly_strict refuses any write', async () => {
    const scenario = freshProject({ readonly_strict: true });
    try {
      const r = await runGate('rules-gate', scenario.root, 'alice', {
        tool_name: 'Write',
        tool_input: { file_path: 'README.md' },
      });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('readonly_strict');
    } finally {
      scenario.cleanup();
    }
  });

  test('no file / no command → exit 0', async () => {
    const scenario = freshProject();
    try {
      const r = await runGate('rules-gate', scenario.root, 'alice', { tool_name: 'Read' });
      expect(r.code).toBe(0);
    } finally {
      scenario.cleanup();
    }
  });
});
