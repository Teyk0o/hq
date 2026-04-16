import { describe, expect, test } from 'bun:test';
import { avatarSeed, avatarUrl, avatarBackground } from '../src/avatar';

describe('avatar helper', () => {
  test('seed is deterministic', () => {
    expect(avatarSeed('alice')).toBe('n-alice');
    expect(avatarSeed('alice', 'female')).toBe('f-alice');
    expect(avatarSeed('bob', 'male')).toBe('m-bob');
  });

  test('background picked from palette', () => {
    const bg = avatarBackground('alice');
    expect(bg).toMatch(/^[A-F0-9]{6}$/i);
  });

  test('background is stable per name', () => {
    expect(avatarBackground('alice')).toBe(avatarBackground('alice'));
    expect(avatarBackground('bob')).toBe(avatarBackground('bob'));
  });

  test('url includes the expected seed and backgroundColor', () => {
    const url = avatarUrl({ name: 'alice', gender: 'female' });
    expect(url).toContain('api.dicebear.com/9.x/notionists/svg');
    expect(url).toContain('seed=f-alice');
    expect(url).toContain(`backgroundColor=${avatarBackground('alice')}`);
  });

  test('different names produce different seeds', () => {
    expect(avatarSeed('alice')).not.toBe(avatarSeed('bob'));
  });

  test('same name different gender produces different seeds', () => {
    expect(avatarSeed('alex', 'female')).not.toBe(avatarSeed('alex', 'male'));
  });
});
