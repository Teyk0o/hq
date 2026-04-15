import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { newId } from '@hq/core';
import { resolveProjectPath } from '../util';

export interface TaskAddOpts {
  goal?: string;
  assignee?: string;
  priority?: string;
  package?: string;
  status?: string;
}

export async function taskAdd(title: string, opts: TaskAddOpts): Promise<void> {
  const projectPath = resolveProjectPath();
  const db = new Database(join(projectPath, '.hq', 'db.sqlite'));
  const id = newId();
  db.prepare(
    `INSERT INTO tasks (id, title, goal_id, assignee, priority, package, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, 'human', ?)`,
  ).run(
    id,
    title,
    opts.goal ?? null,
    opts.assignee ?? null,
    opts.priority ? Number.parseInt(opts.priority, 10) : 3,
    opts.package ?? null,
    opts.status ?? 'todo',
  );
  db.close();
  console.log(`✓ Task created: ${id} — ${title}`);
}

export async function taskList(opts: { status?: string; assignee?: string }): Promise<void> {
  const projectPath = resolveProjectPath();
  const db = new Database(join(projectPath, '.hq', 'db.sqlite'));
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.status) {
    where.push('status = ?');
    params.push(opts.status);
  }
  if (opts.assignee) {
    where.push('assignee = ?');
    params.push(opts.assignee);
  }
  const sql = `SELECT id, title, status, assignee, priority FROM tasks ${
    where.length ? 'WHERE ' + where.join(' AND ') : ''
  } ORDER BY priority, created_at DESC`;
  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    title: string;
    status: string;
    assignee: string | null;
    priority: number;
  }>;
  db.close();
  if (rows.length === 0) {
    console.log('(no tasks)');
    return;
  }
  for (const r of rows) {
    console.log(
      `  [${r.status.padEnd(12)}] p${r.priority} ${r.id} ${(r.assignee ?? '-').padEnd(10)} ${r.title}`,
    );
  }
}

export async function taskShow(id: string): Promise<void> {
  const projectPath = resolveProjectPath();
  const db = new Database(join(projectPath, '.hq', 'db.sqlite'));
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) {
    console.error(`Task not found: ${id}`);
    process.exit(1);
  }
  console.log(JSON.stringify(task, null, 2));
  const comments = db.prepare('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at').all(id);
  const reviews = db.prepare('SELECT * FROM reviews WHERE task_id = ? ORDER BY created_at').all(id);
  console.log('\n--- Comments ---');
  console.log(JSON.stringify(comments, null, 2));
  console.log('\n--- Reviews ---');
  console.log(JSON.stringify(reviews, null, 2));
  db.close();
}

export async function taskUnblock(id: string, opts: { to?: string }): Promise<void> {
  const projectPath = resolveProjectPath();
  const db = new Database(join(projectPath, '.hq', 'db.sqlite'));
  const target = opts.to ?? 'todo';
  db.prepare(
    `UPDATE tasks SET status = ?, blocked_reason = NULL, updated_at = ? WHERE id = ? AND status = 'blocked'`,
  ).run(target, Date.now(), id);
  db.close();
  console.log(`✓ Task ${id} unblocked → ${target}`);
}
