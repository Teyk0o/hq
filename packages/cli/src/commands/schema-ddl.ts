/**
 * Inline DDL. Kept in sync with packages/core/src/db/schema.ts.
 * TODO: migrate to drizzle-kit generated migrations once the schema stabilises.
 */
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  goal_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignee TEXT,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 3,
  package TEXT,
  branch TEXT,
  pushed INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000),
  claimed_at INTEGER,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_assignee ON tasks(assignee);
CREATE INDEX IF NOT EXISTS tasks_goal ON tasks(goal_id);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL,
  depends_on TEXT NOT NULL,
  PRIMARY KEY (task_id, depends_on)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  mentions TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  verdict TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignees TEXT NOT NULL DEFAULT '[]',
  tasks_per_week INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
);

CREATE TABLE IF NOT EXISTS agent_state (
  name TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_heartbeat INTEGER,
  current_task_id TEXT,
  tmux_session TEXT,
  pid INTEGER,
  tokens_today INTEGER NOT NULL DEFAULT 0,
  tokens_budget INTEGER NOT NULL DEFAULT 0,
  budget_reset_at INTEGER NOT NULL,
  blocked_reason TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
);
CREATE INDEX IF NOT EXISTS messages_to ON messages(to_agent);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,
  action TEXT NOT NULL,
  task_id TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
);
CREATE INDEX IF NOT EXISTS activity_created ON activity(created_at DESC);

CREATE TABLE IF NOT EXISTS heartbeats (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  outcome TEXT,
  log_path TEXT NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  tasks_worked TEXT NOT NULL DEFAULT '[]',
  error TEXT
);
CREATE INDEX IF NOT EXISTS heartbeats_agent ON heartbeats(agent, started_at);
`;
