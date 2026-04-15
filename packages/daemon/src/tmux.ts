import { spawn } from 'node:child_process';

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

export async function exists(session: string): Promise<boolean> {
  const { code } = await run(['has-session', '-t', session]);
  return code === 0;
}

export async function create(session: string, cwd: string): Promise<void> {
  const { code, stderr } = await run(['new-session', '-d', '-s', session, '-c', cwd]);
  if (code !== 0) throw new Error(`tmux new-session failed: ${stderr.trim()}`);
}

export async function kill(session: string): Promise<void> {
  await run(['kill-session', '-t', session]);
}

export async function pipePane(session: string, logPath: string): Promise<void> {
  // -o opens the pipe, overrides any previous pipe.
  const { code, stderr } = await run([
    'pipe-pane',
    '-t',
    session,
    '-o',
    `cat >> ${shellEscape(logPath)}`,
  ]);
  if (code !== 0) throw new Error(`tmux pipe-pane failed: ${stderr.trim()}`);
}

export async function sendKeys(
  session: string,
  text: string,
  options: { enter?: boolean; literal?: boolean } = {},
): Promise<void> {
  const args = ['send-keys', '-t', session];
  if (options.literal) args.push('-l');
  args.push(text);
  if (options.enter) args.push('Enter');
  const { code, stderr } = await run(args);
  if (code !== 0) throw new Error(`tmux send-keys failed: ${stderr.trim()}`);
}

export async function sendCtrlC(session: string): Promise<void> {
  await sendKeys(session, 'C-c');
}

/**
 * Send a multi-line prompt safely. Each line is sent with -l (literal), then an
 * Enter keypress terminates the input. This avoids shell interpretation issues.
 */
export async function sendPrompt(session: string, text: string): Promise<void> {
  for (const line of text.split('\n')) {
    await sendKeys(session, line, { literal: true });
    await sendKeys(session, 'Enter');
  }
}

export function sessionName(projectSlug: string, agent: string): string {
  return `hq-${projectSlug}-${agent}`;
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
