import type { ProjectConfig } from '../config/project';

export interface RulesEngineInput {
  config: ProjectConfig;
  agentName: string;
  /** The Claude Code tool being invoked: Edit, Write, MultiEdit, Bash, etc. */
  toolName: string;
  /** Absolute or project-relative path being modified, if applicable. */
  filePath?: string;
  /** Raw bash command, if the tool is Bash. */
  command?: string;
  /** Project root absolute path, for relative-path normalisation. */
  projectRoot?: string;
}

export interface RulesVerdict {
  ok: boolean;
  blocked: boolean;
  /** Human-facing messages. For `warn` rules the verdict remains ok=true but
   * messages are returned so the caller can surface them. */
  messages: string[];
}

/**
 * Evaluate the project's declarative `[[rules]]` against a single tool
 * invocation. Pure function, no IO, no side effects — the CLI hook wraps it
 * and converts the verdict into an exit code.
 *
 * Supported rule shapes:
 *  - `match` + `action = "block"`  → refuse the edit
 *  - `match` + `action = "warn"`   → allow, surface a message
 *  - `match` + `owner = "<agent>"` → only that agent may modify
 *  - `protected_paths = [..]`      → implicit block on any of these globs
 *  - `forbid_commands = [..]`      → Bash-only, substring or regex match
 *  - `agents = [..]` scopes a rule to specific agents ("*" or omitted = any)
 */
export function evaluateRules(input: RulesEngineInput): RulesVerdict {
  const messages: string[] = [];
  let blocked = false;

  const relPath = normalisePath(input.filePath, input.projectRoot);

  for (const rule of input.config.rules) {
    // Scope check: does this rule apply to the caller?
    if (rule.agents && rule.agents.length > 0 && !rule.agents.includes('*')) {
      if (!rule.agents.includes(input.agentName)) continue;
    }

    // forbid_commands only applies to Bash.
    if (rule.forbid_commands && rule.forbid_commands.length > 0) {
      if (input.toolName === 'Bash' && input.command) {
        for (const pattern of rule.forbid_commands) {
          let hit = false;
          try {
            hit = new RegExp(pattern).test(input.command);
          } catch {
            hit = input.command.includes(pattern);
          }
          if (hit) {
            blocked = true;
            messages.push(
              `Rule ${rule.id ?? 'forbid_commands'}: forbidden pattern /${pattern}/`,
            );
          }
        }
      }
    }

    // Path-based rules only apply when we have a file path.
    if (!relPath) continue;

    // protected_paths: each glob is an implicit block.
    if (rule.protected_paths) {
      for (const glob of rule.protected_paths) {
        if (matchGlob(glob, relPath)) {
          blocked = true;
          messages.push(
            `Rule ${rule.id ?? 'protected_paths'}: ${relPath} is protected (glob ${glob})`,
          );
        }
      }
    }

    // `match` covers both block/warn action and owner checks.
    if (rule.match && matchGlob(rule.match, relPath)) {
      if (rule.action === 'block') {
        blocked = true;
        messages.push(
          `Rule ${rule.id ?? rule.match}: ${relPath} is blocked by policy`,
        );
      } else if (rule.action === 'warn') {
        messages.push(`Rule ${rule.id ?? rule.match}: ${relPath} — ${humanWarning(rule)}`);
      }
      if (rule.owner && rule.owner !== input.agentName) {
        blocked = true;
        messages.push(
          `Rule ${rule.id ?? rule.match}: ${relPath} is owned by ${rule.owner}, ${input.agentName} may not edit it directly`,
        );
      }
    }
  }

  return { ok: !blocked, blocked, messages };
}

function humanWarning(rule: ProjectConfig['rules'][number]): string {
  if (rule.owner) return `owned by ${rule.owner}`;
  return 'proceed with care';
}

function normalisePath(
  filePath: string | undefined,
  projectRoot: string | undefined,
): string | undefined {
  if (!filePath) return undefined;
  if (!projectRoot) return filePath;
  // Strip a leading projectRoot so globs in project.toml are relative.
  const withSep = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`;
  if (filePath.startsWith(withSep)) return filePath.slice(withSep.length);
  if (filePath === projectRoot) return '';
  return filePath;
}

/**
 * Minimal glob matcher supporting `*`, `**` and `?`. We avoid an external
 * dependency since our globs are simple (path prefixes with wildcards).
 */
function matchGlob(glob: string, path: string): boolean {
  const re = globToRegex(glob);
  return re.test(path);
}

function globToRegex(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // ** matches anything including path separators
        re += '.*';
        i += 2;
        if (glob[i] === '/') i += 1;
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if ('.+^$()|[]{}\\'.includes(c)) {
      re += `\\${c}`;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}
