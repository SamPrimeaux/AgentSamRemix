/**
 * Glob ignore + allowlist for codebase RAG indexing (Worker queue + local index scripts).
 * Only Agent Sam–relevant source paths are indexed; repo inventory noise is excluded.
 */

/** Top-level / tree paths never indexed (RAG noise). */
export const CODEBASE_INDEX_IGNORE_GLOBS = [
  'artifacts/**',
  'scripts/**',
  'tmp/**',
  '.scratch/**',
  'captures/**',
  'prototypes/**',
  'analytics/**',
  '.tmp/**',
  'learn/**',
  'r2/**',
  'sql/**',
  'audits/**',
  'docs/**',
  'db/**',
  'reports/**',
  'migrations/**',
  'scripts/sql/**',
  'scripts/*.sql',
  'supabase/migrations/**',
  'node_modules/**',
  'dist/**',
  '.wrangler/**',
  'agent-dashboard/**',
  '*.lock',
  '*.log',
];

/**
 * Explicit allowlist: prefix + extension (repo-relative paths only).
 * @type {readonly { prefix: string, ext: RegExp }[]}
 */
export const CODEBASE_INDEX_ALLOW_RULES = [
  { prefix: 'src/', ext: /\.js$/i },
  { prefix: 'app/components/', ext: /\.tsx$/i },
  { prefix: 'app/features/', ext: /\.tsx$/i },
  { prefix: 'app/src/', ext: /\.ts$/i },
  { prefix: 'app/pages/', ext: /\.(tsx|ts|jsx|js)$/i },
];

/** Directories to walk when building a fresh index (subset of repo). */
export const CODEBASE_INDEX_WALK_DIRS = [
  'src',
  'app/components',
  'app/features',
  'app/src',
  'app/pages',
];

/** @deprecated Use CODEBASE_INDEX_WALK_DIRS — kept for imports that expect roots. */
export const CODEBASE_INDEX_SOURCE_ROOTS = CODEBASE_INDEX_WALK_DIRS;

/**
 * @param {string} glob
 * @param {string} relPath forward-slash path relative to repo root
 */
function matchGlob(glob, relPath) {
  const g = String(glob || '').replace(/\\/g, '/');
  const p = String(relPath || '').replace(/\\/g, '/');
  if (!g) return false;

  if (g.startsWith('**/')) {
    const tail = g.slice(3);
    return matchGlob(tail, p) || p.split('/').some((_, i, parts) => matchGlob(tail, parts.slice(i).join('/')));
  }

  if (!g.includes('/')) {
    const re = new RegExp(
      `^${g
        .split('*')
        .map((s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*')}$`,
    );
    const base = p.split('/').pop() || p;
    return re.test(base) || re.test(p);
  }

  const parts = g.split('/');
  const reParts = parts.map((part) => {
    if (part === '**') return '(?:.+/)*';
    if (part === '*') return '[^/]*';
    if (part.includes('*')) {
      return part
        .split('*')
        .map((s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*');
    }
    return part.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  });
  const re = new RegExp(`^${reParts.join('/')}$`);
  return re.test(p);
}

const IGNORE_DIR_SEGMENT_NAMES = new Set([
  'artifacts',
  'scripts',
  'tmp',
  '.scratch',
  'captures',
  'prototypes',
  'analytics',
  '.tmp',
  'learn',
  'r2',
  'sql',
  'audits',
  'docs',
  'db',
  'reports',
  'migrations',
  'node_modules',
  'dist',
  '.wrangler',
  'agent-dashboard',
]);

/** True if any path segment is an ignored directory name (e.g. dashboard under artifacts/). */
function hasIgnoredDirSegment(relPath) {
  const segments = String(relPath || '').replace(/\\/g, '/').split('/');
  return segments.some((seg) => IGNORE_DIR_SEGMENT_NAMES.has(seg));
}

/**
 * @param {string} relPath repo-relative path (forward slashes)
 */
export function shouldIgnoreCodebaseIndexPath(relPath) {
  const p = String(relPath || '').replace(/\\/g, '/');
  if (!p) return true;
  if (hasIgnoredDirSegment(p)) return true;
  for (const glob of CODEBASE_INDEX_IGNORE_GLOBS) {
    if (matchGlob(glob, p)) return true;
  }
  return false;
}

/**
 * @param {string} relPath repo-relative path
 */
export function isCodebaseIndexSourcePath(relPath) {
  const p = String(relPath || '').replace(/\\/g, '/');
  if (shouldIgnoreCodebaseIndexPath(p)) return false;
  return CODEBASE_INDEX_ALLOW_RULES.some((rule) => p.startsWith(rule.prefix) && rule.ext.test(p));
}
