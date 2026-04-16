/**
 * Deterministic Dicebear "notionists" avatar URL for an agent.
 *
 * Goals:
 *  - same agent name → same avatar, always (deterministic seed)
 *  - no two agents with the same name collide (seed derives from name)
 *  - an optional `gender` hint biases the seed prefix so the rendered
 *    character reads as feminine / masculine / neutral
 *  - a stable background colour is picked from a curated Notion-ish palette
 *
 * The URL is served directly by dicebear's public API; no runtime dependency.
 */
const BACKGROUNDS = [
  'B5E1DC', // soft teal
  'C9D8F4', // periwinkle
  'F5DCE5', // blush
  'E8D9F4', // lilac
  'F7E5CC', // cream
  'D8EAD2', // sage
  'F4D9C4', // peach
  'D4E2F7', // sky
  'E7D9C5', // beige
  'F1CFCF', // rose
];

export interface AvatarOptions {
  name: string;
  gender?: 'female' | 'male' | 'neutral';
  size?: number;
}

export function avatarUrl(opts: AvatarOptions): string {
  const seed = avatarSeed(opts.name, opts.gender);
  const bg = avatarBackground(opts.name);
  const size = opts.size ?? 64;
  const params = new URLSearchParams({
    seed,
    backgroundColor: bg,
    size: String(size),
    radius: '50',
  });
  return `https://api.dicebear.com/9.x/notionists/svg?${params.toString()}`;
}

export function avatarSeed(name: string, gender?: 'female' | 'male' | 'neutral'): string {
  const prefix = gender === 'female' ? 'f-' : gender === 'male' ? 'm-' : 'n-';
  return `${prefix}${name.toLowerCase()}`;
}

export function avatarBackground(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return BACKGROUNDS[Math.abs(hash) % BACKGROUNDS.length]!;
}
