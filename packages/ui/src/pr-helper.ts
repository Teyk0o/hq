/**
 * After a push, open a PR/MR on the remote. We detect the host from the
 * `origin` remote URL and invoke the matching CLI (`gh` for GitHub, `glab`
 * for GitLab). Both tools read their auth from the user's config. Returns
 * the merge-request URL on success, or null if we couldn't create one.
 */
export async function openPullRequest(
  projectRoot: string,
  branch: string,
  title: string,
): Promise<{ url: string | null; error?: string }> {
  const remote = readRemote(projectRoot);
  if (!remote) return { url: null, error: 'no origin remote configured' };

  const host = parseHost(remote);
  if (!host) return { url: null, error: `unrecognised remote: ${remote}` };

  if (host === 'github') {
    return runGhPr(projectRoot, branch, title);
  }
  return runGlabMr(projectRoot, branch, title);
}

function readRemote(cwd: string): string | null {
  const r = Bun.spawnSync(['git', '-C', cwd, 'remote', 'get-url', 'origin']);
  if (r.exitCode !== 0) return null;
  const url = r.stdout.toString().trim();
  return url || null;
}

type Host = 'github' | 'gitlab';

function parseHost(url: string): Host | null {
  if (/github\.com[:/]/.test(url)) return 'github';
  // Match gitlab.com and self-hosted gitlab instances (gitlab.*, *.gitlab.*).
  if (/gitlab[.-]/i.test(url) || /gitlab\./i.test(url)) return 'gitlab';
  return null;
}

async function runGhPr(
  cwd: string,
  branch: string,
  title: string,
): Promise<{ url: string | null; error?: string }> {
  // `gh pr create` prints the URL on stdout on success.
  const r = Bun.spawnSync(
    ['gh', 'pr', 'create', '--head', branch, '--title', title, '--body', `Opened by HQ.`],
    { cwd },
  );
  if (r.exitCode !== 0) {
    const stderr = r.stderr.toString().trim();
    // `gh` exits 1 when a PR already exists; try to parse its URL out of stderr.
    const existing = extractUrl(stderr);
    if (existing) return { url: existing };
    return { url: null, error: stderr || 'gh pr create failed' };
  }
  return { url: extractUrl(r.stdout.toString()) };
}

async function runGlabMr(
  cwd: string,
  branch: string,
  title: string,
): Promise<{ url: string | null; error?: string }> {
  const r = Bun.spawnSync(
    [
      'glab',
      'mr',
      'create',
      '--source-branch',
      branch,
      '--title',
      title,
      '--description',
      'Opened by HQ.',
      '--fill',
      '--yes',
    ],
    { cwd },
  );
  if (r.exitCode !== 0) {
    const stderr = r.stderr.toString().trim();
    const existing = extractUrl(stderr);
    if (existing) return { url: existing };
    return { url: null, error: stderr || 'glab mr create failed' };
  }
  return { url: extractUrl(r.stdout.toString()) };
}

function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}
