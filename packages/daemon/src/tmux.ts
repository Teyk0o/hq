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

export async function create(
  session: string,
  cwd: string,
  command?: string,
): Promise<void> {
  const args = ['new-session', '-d', '-s', session, '-c', cwd];
  if (command) args.push(command);
  const { code, stderr } = await run(args);
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
 * Send a multi-line prompt to a Claude Code TUI session via bracketed paste.
 * This is critical: Claude's TUI treats newlines inside a bracketed paste as
 * literal line breaks in the same input, while plain send-keys with Enter would
 * submit each line as a separate turn. `paste-buffer -p` wraps the buffer in
 * ESC[200~ / ESC[201~ which the TUI recognises.
 */
export async function sendPrompt(session: string, text: string): Promise<void> {
  const bufferName = `hq-prompt-${Date.now()}`;
  const { code: setCode, stderr: setErr } = await runWithStdin(
    ['set-buffer', '-b', bufferName, '-'],
    text,
  );
  if (setCode !== 0) throw new Error(`tmux set-buffer failed: ${setErr.trim()}`);

  const { code: pasteCode, stderr: pasteErr } = await run([
    'paste-buffer',
    '-t',
    session,
    '-b',
    bufferName,
    '-p',
    '-d',
  ]);
  if (pasteCode !== 0) throw new Error(`tmux paste-buffer failed: ${pasteErr.trim()}`);

  // Submit the prompt. Claude accepts Enter to submit when the composer has
  // content; bracketed paste keeps the multiline structure intact.
  await sendKeys(session, 'Enter');
}

async function runWithStdin(
  args: string[],
  stdin: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('tmux', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
    proc.stdin?.write(stdin);
    proc.stdin?.end();
  });
}

export function sessionName(projectSlug: string, agent: string): string {
  return `hq-${projectSlug}-${agent}`;
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
