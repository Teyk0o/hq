import { spawn } from 'node:child_process';
import type { UsageSnapshot } from './types';

async function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('tmux', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Probe Claude Code's `/usage` by driving an ephemeral tmux session.
 * This is the only way to get numbers that match the ones displayed in `/usage`
 * since Anthropic does not publish the Max plan token limits that would let us
 * derive them from ccusage output.
 *
 * `/usage` is a client-side slash command — it does not consume any tokens.
 */
export async function probeUsageViaTmux(options: { timeoutMs?: number } = {}): Promise<UsageSnapshot> {
  const session = `hq-usage-probe-${process.pid}-${Date.now()}`;
  const timeoutMs = options.timeoutMs ?? 15_000;

  const probe = async (): Promise<UsageSnapshot> => {
    try {
      const created = await run(['new-session', '-d', '-s', session, '-x', '220', '-y', '60']);
      if (created.code !== 0) throw new Error(`tmux new-session failed: ${created.stderr}`);

      await run(['send-keys', '-t', session, 'claude', 'Enter']);
      // Give Claude a chance to start its TUI.
      await sleep(4000);

      await run(['send-keys', '-t', session, '/usage', 'Enter']);
      await sleep(3500);

      // Capture the full scrollback so nothing is missed.
      const captured = await run(['capture-pane', '-t', session, '-p', '-S', '-200']);
      if (captured.code !== 0) throw new Error(`tmux capture-pane failed: ${captured.stderr}`);

      const snap = parseUsageOutput(captured.stdout);
      if (!snap) throw new Error('could not parse /usage output');
      return snap;
    } finally {
      await run(['kill-session', '-t', session]).catch(() => undefined);
    }
  };

  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`probe timed out after ${timeoutMs}ms`)), timeoutMs),
  );
  return Promise.race([probe(), timer]);
}

/**
 * Parse Claude Code's `/usage` output. It looks roughly like:
 *
 *   Current session
 *   Resets 11pm (Europe/Paris) ████████████████ 100% used
 *
 *   Current week (all models)
 *   Resets Apr 17, 7pm (Europe/Paris) █████████ 34% used
 *
 *   Current week (Sonnet only)
 *   Resets Apr 19, 5pm (Europe/Paris) ██ 4% used
 *
 * The percentages are robustly extractable via regex over the section headers.
 */
export function parseUsageOutput(text: string): UsageSnapshot | null {
  const clean = stripAnsi(text);
  const lines = clean.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());

  const sessionIdx = lines.findIndex((l) => /current session/i.test(l));
  const weekAllIdx = lines.findIndex((l) => /current week\s*\(all models\)/i.test(l));
  const weekSonnetIdx = lines.findIndex((l) => /current week\s*\(sonnet only\)/i.test(l));

  if (sessionIdx === -1 || weekAllIdx === -1 || weekSonnetIdx === -1) return null;

  const sessionBlock = lines.slice(sessionIdx, sessionIdx + 6).join(' ');
  const weekAllBlock = lines.slice(weekAllIdx, weekAllIdx + 6).join(' ');
  const weekSonnetBlock = lines.slice(weekSonnetIdx, weekSonnetIdx + 6).join(' ');

  const pct = (block: string): number => {
    const match = block.match(/(\d+)\s*%\s*used/i);
    return match ? Number.parseInt(match[1]!, 10) : 0;
  };
  const reset = (block: string): string | null => {
    const match = block.match(/Resets\s+([^█]+?)(?=\s+\d+\s*%)/i);
    return match ? match[1]!.trim() : null;
  };

  return {
    session_pct: pct(sessionBlock),
    session_resets_at: parseResetToEpoch(reset(sessionBlock)),
    week_all_pct: pct(weekAllBlock),
    week_all_resets_at: parseResetToEpoch(reset(weekAllBlock)),
    week_sonnet_pct: pct(weekSonnetBlock),
    week_sonnet_resets_at: parseResetToEpoch(reset(weekSonnetBlock)),
    fetched_at: Date.now(),
    source: 'probe' as UsageSnapshot['source'],
  } as UsageSnapshot;
}

/**
 * Best-effort conversion of "Apr 17, 7pm (Europe/Paris)" / "11pm (Europe/Paris)" to an epoch ms.
 * Returns null on failure — the UI tolerates null.
 */
function parseResetToEpoch(s: string | null): number | null {
  if (!s) return null;
  try {
    // Strip timezone label in parens — Date.parse can't use it directly.
    const withoutTz = s.replace(/\s*\([^)]+\)\s*$/, '').trim();
    // Two shapes:
    //   "Apr 17, 7pm" → "2026 Apr 17 7pm"
    //   "11pm"        → today at 11pm
    const year = new Date().getFullYear();
    const candidate = /^[A-Za-z]{3}\s+\d+/.test(withoutTz)
      ? `${year} ${withoutTz}`
      : `${new Date().toDateString()} ${withoutTz}`;
    const t = Date.parse(candidate);
    return Number.isNaN(t) ? null : t;
  } catch {
    return null;
  }
}

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;?]*[A-Za-z]/g, '');
}
