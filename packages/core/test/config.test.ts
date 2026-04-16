import { describe, expect, test } from 'bun:test';
import { AgentConfigSchema, ProjectConfigSchema } from '../src/config';
import { parse as parseToml } from 'smol-toml';

describe('ProjectConfigSchema', () => {
  test('accepts a minimal project', () => {
    const cfg = ProjectConfigSchema.parse({ project: { name: 'flowly' } });
    expect(cfg.project.name).toBe('flowly');
    expect(cfg.project.default_model).toBe('sonnet');
    expect(cfg.scheduler.interval_minutes).toBe(15);
    expect(cfg.heartbeat.retry_max).toBe(2);
  });

  test('parses a realistic TOML', () => {
    const raw = `
[project]
name = "test"
default_model = "opus"

[scheduler]
interval_minutes = 5
max_concurrent_agents = 2

[[goals]]
id = "ship-v1"
title = "Ship v1"
assignees = ["alice", "bob"]
tasks_per_week = 3

[[rules]]
id = "lock"
protected_paths = ["pnpm-lock.yaml"]

[[rules]]
id = "core-owner"
match = "packages/core/**"
owner = "lucas"
`;
    const cfg = ProjectConfigSchema.parse(parseToml(raw));
    expect(cfg.project.default_model).toBe('opus');
    expect(cfg.scheduler.interval_minutes).toBe(5);
    expect(cfg.goals).toHaveLength(1);
    expect(cfg.goals[0]!.assignees).toEqual(['alice', 'bob']);
    expect(cfg.rules).toHaveLength(2);
    expect(cfg.rules[1]!.owner).toBe('lucas');
  });

  test('rejects invalid model', () => {
    expect(() =>
      ProjectConfigSchema.parse({ project: { name: 'x', default_model: 'bogus' } }),
    ).toThrow();
  });

  test('defaults bash allow_prefixes include cd and git', () => {
    const cfg = ProjectConfigSchema.parse({ project: { name: 'x' } });
    expect(cfg.bash.allow_prefixes).toContain('git ');
    expect(cfg.bash.allow_prefixes).toContain('cd ');
  });
});

describe('AgentConfigSchema', () => {
  test('parses a worker agent', () => {
    const cfg = AgentConfigSchema.parse({
      agent: { name: 'alice', role: 'worker' },
    });
    expect(cfg.agent.name).toBe('alice');
    expect(cfg.agent.role).toBe('worker');
    expect(cfg.agent.active).toBe(true);
  });

  test('accepts a gender hint', () => {
    const cfg = AgentConfigSchema.parse({
      agent: { name: 'alice', role: 'worker', gender: 'female' },
    });
    expect(cfg.agent.gender).toBe('female');
  });

  test('rejects invalid agent name (must be lowercase slug)', () => {
    expect(() =>
      AgentConfigSchema.parse({ agent: { name: 'Alice!', role: 'worker' } }),
    ).toThrow();
  });

  test('rejects invalid role', () => {
    expect(() =>
      AgentConfigSchema.parse({ agent: { name: 'alice', role: 'architect' } }),
    ).toThrow();
  });
});
