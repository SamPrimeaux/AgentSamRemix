/**
 * Repo identity SSOT (dashboard).
 *
 * One concept — GitHub `owner/repo` — many field names on different surfaces:
 *   - D1 `workspaces.github_repo`          (storage / workspace row)
 *   - API/status `repo_full_name`          (git status, index jobs)
 *   - GitHub API `full_name`               (list-repos payloads)
 *   - React `gitRepoFullName`              (shell state from poll)
 *   - Prop `workspaceRepoHint`             (branch menu hint)
 *
 * After normalize, those MUST be the same string (e.g. `SamPrimeaux/inneranimalmedia`).
 * Do not invent `full_github_repo`. Prefer `normalizeGithubRepoFullName` at every
 * boundary; keep legacy `normalizeGithubRepo` as a thin alias.
 *
 * Worker twin: `src/core/project-github-repo.js` → `normalizeGithubRepoFullName`.
 */

/** Canonical owner/repo slug (same value as D1 github_repo and API repo_full_name). */
export type GithubRepoFullName = string;

/** @deprecated Prefer GithubRepoFullName — same type. */
export type GithubRepoSlug = GithubRepoFullName;

/**
 * Normalize any URL / slug into `owner/repo`, or null if invalid.
 * Identical contract to worker `normalizeGithubRepoFullName`.
 */
export function normalizeGithubRepoFullName(raw: string | null | undefined): GithubRepoFullName | null {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
  s = s.replace(/\.git$/i, '');
  s = s.replace(/^github:/i, '');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const name = parts[1];
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) return null;
  return `${owner}/${name}`;
}

/** Legacy alias — same function as normalizeGithubRepoFullName (returns '' when invalid). */
export function normalizeGithubRepo(full: string): string {
  return normalizeGithubRepoFullName(full) || '';
}

/** True when value is already a valid owner/repo slug. */
export function isGithubRepoFullName(raw: string | null | undefined): boolean {
  return normalizeGithubRepoFullName(raw) != null;
}

/**
 * Pick the first usable owner/repo from alias fields.
 * Treats github_repo / repo_full_name / full_name as the same concept.
 */
export function coerceGithubRepoFullName(
  ...candidates: Array<string | null | undefined>
): GithubRepoFullName | null {
  for (const c of candidates) {
    const n = normalizeGithubRepoFullName(c);
    if (n) return n;
  }
  return null;
}
