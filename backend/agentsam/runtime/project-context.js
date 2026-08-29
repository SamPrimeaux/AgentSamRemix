/**
 * Request-scoped project execution context (repo, branch, active file).
 * Not conversation metadata — runtime turn preparation only.
 *
 * @module backend/agentsam/runtime/project-context
 */

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @typedef {{ github_repo?: string|null, branch?: string|null, active_file?: string|null, client_authority?: boolean }} ProjectContext
 */

/**
 * Parse explicit `project` object from chat body (JSON object or string).
 * Absent → null. Does not invent workspace defaults.
 * @param {Record<string, unknown>|null|undefined} body
 * @returns {ProjectContext|null}
 */
export function parseProjectContextFromBody(body) {
  if (!body || typeof body !== 'object') return null;
  const raw = body.project ?? body.projectContext ?? body.project_context;
  if (raw == null || raw === '') return null;

  /** @type {Record<string, unknown>} */
  let obj;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  } else if (typeof raw === 'object') {
    obj = /** @type {Record<string, unknown>} */ (raw);
  } else {
    return null;
  }

  const github_repo = trim(obj.github_repo ?? obj.githubRepo ?? obj.repo);
  const branch = trim(obj.branch ?? obj.github_branch ?? obj.githubBranch) || 'main';
  const active_file = trim(
    obj.active_file ?? obj.activeFile ?? obj.active_path ?? obj.activePath ?? obj.github_path,
  );

  return {
    github_repo: github_repo || null,
    branch,
    active_file: active_file || null,
    client_authority: true,
  };
}
