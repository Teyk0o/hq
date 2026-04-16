/**
 * Lightweight leveled logger with an optional JSON output mode. Zero deps.
 *
 * Usage:
 *   const log = createLogger('scheduler');
 *   log.info('tick fired', { project: 'flowly', agents: 3 });
 *
 * Levels: debug < info < warn < error. Control via HQ_LOG_LEVEL env var
 * (default 'info'). Set HQ_LOG_FORMAT=json for machine-readable output
 * (one JSON object per line on stderr) — useful when shipping to an
 * external log collector. Default is 'pretty' (coloured-ish, human).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function envLevel(): LogLevel {
  const raw = (process.env.HQ_LOG_LEVEL ?? 'info').toLowerCase();
  return (['debug', 'info', 'warn', 'error'] as const).includes(raw as LogLevel)
    ? (raw as LogLevel)
    : 'info';
}

function envFormat(): 'pretty' | 'json' {
  return process.env.HQ_LOG_FORMAT === 'json' ? 'json' : 'pretty';
}

export interface Logger {
  debug: (message: string, extra?: Record<string, unknown>) => void;
  info: (message: string, extra?: Record<string, unknown>) => void;
  warn: (message: string, extra?: Record<string, unknown>) => void;
  error: (message: string, extra?: Record<string, unknown>) => void;
  child: (subscope: string) => Logger;
}

export function createLogger(scope: string): Logger {
  const minRank = LEVEL_RANK[envLevel()];
  const format = envFormat();

  const emit = (level: LogLevel, message: string, extra?: Record<string, unknown>) => {
    if (LEVEL_RANK[level] < minRank) return;
    if (format === 'json') {
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        scope,
        message,
        ...(extra ?? {}),
      });
      process.stderr.write(`${line}\n`);
      return;
    }
    const badge = `[${scope}]`;
    const tail = extra && Object.keys(extra).length > 0 ? ` ${stringifyExtra(extra)}` : '';
    const line = `${badge} ${message}${tail}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };

  return {
    debug: (m, e) => emit('debug', m, e),
    info: (m, e) => emit('info', m, e),
    warn: (m, e) => emit('warn', m, e),
    error: (m, e) => emit('error', m, e),
    child: (subscope) => createLogger(`${scope}/${subscope}`),
  };
}

function stringifyExtra(extra: Record<string, unknown>): string {
  try {
    return Object.entries(extra)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
  } catch {
    return JSON.stringify(extra);
  }
}
