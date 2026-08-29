/**
 * D1-driven code-index ignore / allow policy (agentsam_ignore_pattern).
 * Keyed by connected GitHub repo only (repo_full_name), never workspace.
 */
export const IGNORE_POLICY_REPO_REQUIRED = 'repo_full_name_required';
export const IGNORE_POLICY_EMPTY = 'ignore_policy_repo_required';

/** Minimal gitignore-style matcher for *, ** and ?. */
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
  try { return new RegExp(re).test(path); } catch { return false; }
}

export function applyRepoIgnorePolicy(repoPolicy, filePath) {
  const allow = Array.isArray(repoPolicy?.allow) ? repoPolicy.allow : [];
  const deny = Array.isArray(repoPolicy?.deny) ? repoPolicy.deny : [];
  const path = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!path) return { ignored: true, reason: 'unsafe_path' };

  if (allow.length > 0 && !allow.some((pattern) => matchIgnoreGlob(path, pattern))) {
    return { ignored: true, reason: 'repo_allowlist_miss' };
  }
  for (const pattern of deny) {
    if (matchIgnoreGlob(path, pattern)) return { ignored: true, reason: `repo_deny:${pattern}` };
  }
  return { ignored: false, reason: null };
}

export function normalizeIgnorePolicyRepo(value) {
  const repo = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)) return '';
  if (repo.includes('..') || repo.startsWith('/') || repo.endsWith('/')) return '';
  return repo;
}

export async function loadRepoIgnorePolicy(db, repoFullName) {
  const repo = normalizeIgnorePolicyRepo(repoFullName);
  if (!db) throw new Error('db_required');
  if (!repo) throw new Error(IGNORE_POLICY_REPO_REQUIRED);

  const { results } = await db.prepare(
    `SELECT pattern, is_negation
       FROM agentsam_ignore_pattern
      WHERE repo_full_name = ?
      ORDER BY order_index ASC`,
  ).bind(repo).all();

  const rows = results || [];
  if (!rows.length) throw new Error(IGNORE_POLICY_EMPTY);
  const allow = [];
  const deny = [];
  for (const row of rows) {
    const pattern = row?.pattern != null ? String(row.pattern).trim() : '';
    if (!pattern) continue;
    if (Number(row.is_negation) === 1) allow.push(pattern);
    else deny.push(pattern);
  }
  if (!allow.length && !deny.length) throw new Error(IGNORE_POLICY_EMPTY);
  return { allow, deny, repo_full_name: repo };
}

/** Version a raw ordered row set for optimistic settings writes. */
export async function ignorePolicyVersion(rows) {
  const payload = JSON.stringify((rows || []).map((row) => [
    String(row.id || ''),
    String(row.pattern || ''),
    Number(row.is_negation) === 1 ? 1 : 0,
    Number(row.order_index) || 0,
    Number(row.updated_at_unix) || 0,
  ]));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
