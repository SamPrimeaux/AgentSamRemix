/**
 * Search filenames under the persisted File System Access directory handle.
 * Used by Cmd+K Quick Open (file-first) and @ / Files chip.
 */
import {
  LOCAL_TREE_SKIP_DIR_NAMES,
  readLocalDirectoryEntries,
} from './localFileTree';
import {
  loadPersistedLocalDirectoryHandle,
  queryLocalReadPermission,
} from './library/localHandleStore';

export type ConnectedLocalFileHit = {
  path: string;
  name: string;
  rootName: string;
  /** Lower is better when sorting. */
  score?: number;
};

const MAX_MATCHES = 40;
const MAX_DIRS = 500;
const MAX_DEPTH = 8;

/**
 * Cursor-like fuzzy: subsequence match with bonuses for consecutive runs and path segment starts.
 * Returns null if no match; lower score = better.
 */
export function fuzzyPathScore(haystack: string, needle: string): number | null {
  const h = String(haystack || '').toLowerCase();
  const n = String(needle || '').toLowerCase().trim();
  if (!n) return 0;
  if (!h) return null;
  if (h === n) return 0;
  if (h.startsWith(n)) return 1;
  if (h.includes(n)) return 2 + h.indexOf(n) * 0.001;

  let hi = 0;
  let score = 20;
  let consecutive = 0;
  for (let ni = 0; ni < n.length; ni++) {
    const ch = n[ni];
    const found = h.indexOf(ch, hi);
    if (found < 0) return null;
    if (found === hi) {
      consecutive += 1;
      score -= 0.5;
    } else {
      consecutive = 0;
      score += (found - hi) * 0.15;
    }
    // Bonus when match starts a path segment
    if (found === 0 || h[found - 1] === '/' || h[found - 1] === '-' || h[found - 1] === '_') {
      score -= 1.2;
    }
    if (consecutive >= 2) score -= 0.35;
    hi = found + 1;
  }
  score += (h.length - n.length) * 0.02;
  return score;
}

/**
 * Breadth-first filename search under the connected local folder.
 * @param searchTerm empty → top-level hints (package.json, README, …) + shallow listing
 */
export async function searchConnectedLocalFiles(
  searchTerm: string,
): Promise<{ hits: ConnectedLocalFileHit[]; connected: boolean; permission: string }> {
  const root = await loadPersistedLocalDirectoryHandle();
  if (!root) {
    return { hits: [], connected: false, permission: 'none' };
  }
  const perm = await queryLocalReadPermission(root);
  if (perm !== 'granted' && perm !== 'unsupported') {
    return { hits: [], connected: true, permission: perm };
  }

  const needle = String(searchTerm || '').trim().toLowerCase();
  const rootName = root.name || 'local';
  const hits: ConnectedLocalFileHit[] = [];
  const queue: { handle: FileSystemDirectoryHandle; prefix: string; depth: number }[] = [
    { handle: root, prefix: '', depth: 0 },
  ];
  let dirsVisited = 0;

  while (queue.length && hits.length < MAX_MATCHES && dirsVisited < MAX_DIRS) {
    const cur = queue.shift();
    if (!cur) break;
    dirsVisited += 1;
    let children;
    try {
      children = await readLocalDirectoryEntries(cur.handle);
    } catch {
      continue;
    }
    for (const child of children) {
      const path = cur.prefix ? `${cur.prefix}/${child.name}` : child.name;
      if (child.kind === 'file') {
        const nameLc = child.name.toLowerCase();
        let score: number | null;
        if (!needle) {
          score = isDefaultFileHint(nameLc) ? hintScore(nameLc) : cur.depth === 0 ? 10 : null;
        } else {
          const byName = fuzzyPathScore(nameLc, needle);
          const byPath = fuzzyPathScore(path.toLowerCase(), needle);
          if (byName == null && byPath == null) score = null;
          else score = Math.min(byName ?? 999, byPath ?? 999);
        }
        if (score != null) {
          hits.push({ path, name: child.name, rootName, score });
          if (hits.length >= MAX_MATCHES) break;
        }
      } else if (child.kind === 'directory' && cur.depth < MAX_DEPTH) {
        if (LOCAL_TREE_SKIP_DIR_NAMES.has(child.name)) continue;
        if (child.name.startsWith('.') && child.name !== '.agents' && child.name !== '.cursor') {
          continue;
        }
        // When searching, skip dirs whose name can't fuzzy-match and aren't prefixes of needle
        if (needle) {
          const dirScore = fuzzyPathScore(child.name.toLowerCase(), needle);
          const pathScore = fuzzyPathScore(path.toLowerCase(), needle);
          const mayContain =
            dirScore != null ||
            pathScore != null ||
            needle.includes(child.name.toLowerCase()) ||
            child.name.toLowerCase().includes(needle.slice(0, 3));
          // Still descend — fuzzy may match deeper filenames; only prune deep noisy trees
          if (!mayContain && cur.depth >= 3) continue;
        }
        queue.push({
          handle: child.handle as FileSystemDirectoryHandle,
          prefix: path,
          depth: cur.depth + 1,
        });
      }
    }
  }

  hits.sort((a, b) => {
    const aScore = a.score ?? scoreHit(a, needle);
    const bScore = b.score ?? scoreHit(b, needle);
    if (aScore !== bScore) return aScore - bScore;
    return a.path.localeCompare(b.path);
  });

  return { hits: hits.slice(0, MAX_MATCHES), connected: true, permission: String(perm) };
}

function isDefaultFileHint(nameLc: string): boolean {
  return (
    nameLc === 'package.json' ||
    nameLc === 'readme.md' ||
    nameLc === 'wrangler.toml' ||
    nameLc === 'wrangler.jsonc' ||
    nameLc === 'tsconfig.json' ||
    nameLc === 'vite.config.ts' ||
    nameLc === 'src/index.js'
  );
}

function hintScore(nameLc: string): number {
  if (nameLc === 'package.json') return 0;
  if (nameLc === 'readme.md') return 1;
  if (nameLc.startsWith('wrangler')) return 2;
  return 3;
}

function scoreHit(hit: ConnectedLocalFileHit, needle: string): number {
  if (hit.score != null) return hit.score;
  const nameLc = hit.name.toLowerCase();
  if (!needle) return hintScore(nameLc);
  return fuzzyPathScore(nameLc, needle) ?? fuzzyPathScore(hit.path.toLowerCase(), needle) ?? 99;
}

/**
 * Resolve a relative path under the connected folder and return the file handle.
 */
export async function resolveConnectedLocalFile(
  relPath: string,
): Promise<{ file: File; handle: FileSystemFileHandle; workspacePath: string } | null> {
  const root = await loadPersistedLocalDirectoryHandle();
  if (!root) return null;
  const perm = await queryLocalReadPermission(root);
  if (perm !== 'granted' && perm !== 'unsupported') return null;

  const parts = String(relPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
  if (!parts.length || parts.some((p) => p === '..')) return null;

  let dir: FileSystemDirectoryHandle = root;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      dir = await dir.getDirectoryHandle(parts[i]);
    } catch {
      return null;
    }
  }
  try {
    const handle = await dir.getFileHandle(parts[parts.length - 1]);
    const file = await handle.getFile();
    return { file, handle, workspacePath: parts.join('/') };
  } catch {
    return null;
  }
}
