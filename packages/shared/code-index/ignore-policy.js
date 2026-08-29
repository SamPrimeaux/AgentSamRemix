/**
 * D1-driven code-index ignore / allow policy (agentsam_ignore_pattern).
 *
 * Keyed by connected GitHub repo only (repo_full_name) — not workspace.
 * - is_negation=0 → deny glob
 * - is_negation=1 → allow-scope (path must match ≥1 allow when any allow rows exist)
 * Zero rows for the repo → fail loud (no silent empty / no JS path fallback here).
 *
 * Load once per crawl job — never per file.
 */

export const IGNORE_POLICY_REPO_REQUIRED = 'repo_full_name_required';
export const IGNORE_POLICY_EMPTY = 'ignore_policy_repo_required';

/**
 * Minimal gitignore-style matcher for `*`, `**`, and `?`.
 * @param {string} filePath
 * @param {string} pattern
 */
export function matchIgnoreGlob(filePath, pattern) {
  const path = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  let pat = String(pattern || '').replace(/\\/g, '/').trim();
  if (!path || !pat) return false;

  if (pat.endsWith('/')) pat = `${pat}**`;
  if (!pat.includes('/')) pat = `**/${pat}`;

  let i = 0;
  let re = '^';
  while (i < pat.length) {
    const ch = pat[i];
    if (ch === '*' && pat[i + 1] === '*') {
      if (pat[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 3;
      } else {
        re += '.*';
        i += 2;
      }
      continue;
    }
    if (ch === '*') {
      re += '[^/]*';
      i += 1;
      continue;
    }
    if (ch === '?') {
      re += '[^/]';
      i += 1;
      continue;
    }
    if ('.+^${}()|[]\\'.includes(ch)) re += `\\${ch}`;
    else re += ch;
    i += 1;
  }
  re += '$';
  try {
    return new RegExp(re).test(path);
  } catch {
    return false;
  }
}

/**
 * @param {{ allow?: string[], deny?: string[] }|null|undefined} repoPolicy
 * @param {string} filePath
 * @returns {{ ignored: boolean, reason: string|null }}
 */
export function applyRepoIgnorePolicy(repoPolicy, filePath) {
  const allow = Array.isArray(repoPolicy?.allow) ? repoPolicy.allow : [];
  const deny = Array.isArray(repoPolicy?.deny) ? repoPolicy.deny : [];
  const path = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!path) return { ignored: true, reason: 'unsafe_path' };

  if (allow.length > 0) {
    const allowed = allow.some((p) => matchIgnoreGlob(path, p));
    if (!allowed) {
      return { ignored: true, reason: 'repo_allowlist_miss' };
    }
  }

  for (const p of deny) {
    if (matchIgnoreGlob(path, p)) {
      return { ignored: true, reason: `repo_deny:${p}` };
    }
  }
  return { ignored: false, reason: null };
}

/** @deprecated use applyRepoIgnorePolicy */
export const applyWorkspaceIgnorePolicy = applyRepoIgnorePolicy;

/**
 * Normalize owner/repo; reject empty / non-slash forms.
 * @param {unknown} repoFullName
 * @returns {string}
 */
export function normalizeIgnorePolicyRepo(repoFullName) {
  const repo = repoFullName != null ? String(repoFullName).trim() : '';
  if (!repo || !repo.includes('/') || repo.startsWith('/') || repo.endsWith('/')) {
    return '';
  }
  return repo;
}

/**
 * Load allow/deny for one connected GitHub repo. Fail loud if missing.
 *
 * @param {import('@cloudflare/workers-types').D1Database|undefined|null} db
 * @param {string} repoFullName
 * @returns {Promise<{ allow: string[], deny: string[], repo_full_name: string }>}
 */
export async function loadRepoIgnorePolicy(db, repoFullName) {
  const repo = normalizeIgnorePolicyRepo(repoFullName);
  if (!db) throw new Error('db_required');
  if (!repo) throw new Error(IGNORE_POLICY_REPO_REQUIRED);

  const { results } = await db
    .prepare(
      `SELECT pattern, is_negation
         FROM agentsam_ignore_pattern
        WHERE repo_full_name = ?
        ORDER BY order_index ASC`,
    )
    .bind(repo)
    .all();

  const rows = results || [];
  if (!rows.length) throw new Error(IGNORE_POLICY_EMPTY);

  const allow = [];
  const deny = [];
  for (const r of rows) {
    const pattern = r?.pattern != null ? String(r.pattern).trim() : '';
    if (!pattern) continue;
    if (Number(r.is_negation) === 1) allow.push(pattern);
    else deny.push(pattern);
  }
  if (!allow.length && !deny.length) throw new Error(IGNORE_POLICY_EMPTY);

  return { allow, deny, repo_full_name: repo };
}

/**
 * @deprecated use loadRepoIgnorePolicy(db, repoFullName)
 * @param {import('@cloudflare/workers-types').D1Database|undefined|null} db
 * @param {string} _workspaceId ignored
 * @param {string} [repoFullName]
 */
export async function loadWorkspaceIgnorePolicy(db, _workspaceId, repoFullName = '') {
  return loadRepoIgnorePolicy(db, repoFullName);
}
