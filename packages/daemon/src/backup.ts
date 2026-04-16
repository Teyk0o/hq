import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@hq/core';
import { Cron } from 'croner';

const log = createLogger('backup');

export interface BackupOptions {
  projects: Array<{ name: string; path: string }>;
  /** How many daily snapshots to keep on disk before pruning. */
  keepDays?: number;
  /** Override the backup dir (default ~/.hq/backups). */
  backupDir?: string;
}

/**
 * Schedule a daily SQLite backup for each registered project plus the
 * global registry. Snapshots land in ~/.hq/backups/YYYY-MM-DD/. Runs once
 * at startup after a short delay so fresh daemon launches capture at
 * least one point-in-time backup; then every day at 03:17 local time to
 * stay out of the way of scheduler / quota ticks.
 *
 * WAL mode is honoured by copying the -wal + -shm files too. This is a
 * best-effort hot copy (SQLite recommends .backup via the API for
 * strict consistency, but a cp+WAL on idle DBs is good enough for a
 * local dev tool's daily snapshot).
 */
export function installDailyBackup(options: BackupOptions): () => void {
  const keepDays = options.keepDays ?? 14;
  const backupDir = options.backupDir ?? join(homedir(), '.hq', 'backups');

  const run = async () => {
    const day = new Date().toISOString().slice(0, 10);
    const target = join(backupDir, day);
    try {
      await mkdir(target, { recursive: true });
      await snapshot(join(homedir(), '.hq', 'registry.sqlite'), target, 'registry.sqlite');
      for (const p of options.projects) {
        const src = join(p.path, '.hq', 'db.sqlite');
        await snapshot(src, target, `${sanitize(p.name)}.sqlite`);
      }
      await prune(backupDir, keepDays);
      log.info('snapshot complete', { target, keep_days: keepDays });
    } catch (err) {
      log.error('snapshot failed', { error: (err as Error).message });
    }
  };

  // Run once ~30s after start so an operator who just installed HQ sees the
  // feature work, then every day at 03:17 to avoid scheduler / probe ticks.
  const kickoff = setTimeout(run, 30_000);
  const cron = new Cron('17 3 * * *', { paused: false }, run);

  return () => {
    clearTimeout(kickoff);
    cron.stop();
  };
}

async function snapshot(src: string, destDir: string, destName: string): Promise<void> {
  try {
    await stat(src);
  } catch {
    return; // source doesn't exist yet, nothing to back up
  }
  await copyFile(src, join(destDir, destName));
  // Try to grab the WAL + SHM if they exist so the snapshot is consistent
  // with in-flight writes. Failure here is silent — main file is captured.
  for (const suffix of ['-wal', '-shm']) {
    try {
      await copyFile(`${src}${suffix}`, join(destDir, `${destName}${suffix}`));
    } catch {
      /* not all SQLite configs write these; skip */
    }
  }
}

async function prune(dir: string, keepDays: number): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  for (const entry of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry)) continue;
    const entryTime = Date.parse(entry);
    if (Number.isFinite(entryTime) && entryTime < cutoff) {
      try {
        await rm(join(dir, entry), { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }
}

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}
