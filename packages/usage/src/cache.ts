import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { UsageCacheFile, UsageSnapshot } from './types';

export async function readCache(path: string): Promise<UsageCacheFile | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as UsageCacheFile;
  } catch {
    return null;
  }
}

export async function writeCache(path: string, snapshot: UsageSnapshot, ttlMs: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const payload: UsageCacheFile = { snapshot, ttl_ms: ttlMs };
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf-8');
}

export function isCacheFresh(cache: UsageCacheFile, now = Date.now()): boolean {
  return now - cache.snapshot.fetched_at < cache.ttl_ms;
}
