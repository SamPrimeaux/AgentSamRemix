/**
 * Project ↔ GitHub repo binding.
 * Lives on projects.metadata_json.github_repo so many projects can share
 * one execution workspace without clobbering workspaces.github_repo.
 */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function parseMeta(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
}

/** Normalize owner/name; reject URLs / blanks. */
export function normalizeGithubRepoFullName(raw) {
  let s = trim(raw);
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

/**
 * @param {Record<string, unknown>|null|undefined} projectRow
 * @returns {string|null}
 */
export function readProjectGithubRepoFromRow(projectRow) {
  if (!projectRow) return null;
  const meta = parseMeta(projectRow.metadata_json);
  // Companions and many client projects store git_repo; index/UI also use github_repo.
  return normalizeGithubRepoFullName(
    meta.github_repo ||
      meta.githubRepo ||
      meta.git_repo ||
      meta.gitRepo ||
      meta.repository ||
      null,
  );
}

/**
 * Persist github_repo on projects.metadata_json (merge). Does not touch workspaces.
 * @param {any} env
 * @param {string} projectId
 * @param {string|null} repoFullName — null clears
 */
export async function setProjectGithubRepo(env, projectId, repoFullName) {
  const pid = trim(projectId);
  if (!env?.DB || !pid) throw new Error('project_id_required');
  const normalized = repoFullName == null || repoFullName === ''
    ? null
    : normalizeGithubRepoFullName(repoFullName);
  if (repoFullName && !normalized) throw new Error('invalid_github_repo');

  const row = await env.DB.prepare(`SELECT metadata_json FROM projects WHERE id = ? LIMIT 1`)
    .bind(pid)
    .first();
  if (!row) throw new Error('not_found');

  const meta = parseMeta(row.metadata_json);
  if (normalized) meta.github_repo = normalized;
  else delete meta.github_repo;
  delete meta.githubRepo;

  await env.DB.prepare(
    `UPDATE projects SET metadata_json = ?, updated_at = unixepoch() WHERE id = ?`,
  )
    .bind(JSON.stringify(meta), pid)
    .run();

  return normalized;
}

/**
 * Prefer project metadata github_repo. Do NOT fall back to a shared
 * workspace github_repo — that leaks another project's index onto this page.
 * @param {any} _env
 * @param {Record<string, unknown>} projectRow
 * @param {{ githubRepo?: string|null }|null} [_bindings] unused — kept for call-site compat
 */
export async function resolveProjectGithubRepo(_env, projectRow, _bindings = null) {
  return readProjectGithubRepoFromRow(projectRow);
}
