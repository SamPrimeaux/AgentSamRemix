/**
 * Worker / project identity — env only, never a hardcoded repo/worker string.
 *
 * Set in wrangler `vars` for each Worker:
 *   PROJECT_ID   — product/project key used in D1/RAG rows
 *   WORKER_NAME  — usually matches wrangler `name`
 *
 * Callers that need an id must use requireWorkerProjectId (fail loud) or
 * handle null from resolveWorkerProjectId. Silent "inneranimalmedia" fallbacks
 * are forbidden — they break other workers/repos.
 */

/**
 * @param {any} env
 * @returns {string|null}
 */
export function resolveWorkerProjectId(env) {
  const candidates = [
    env?.PROJECT_ID,
    env?.WORKER_NAME,
    env?.CLOUDFLARE_WORKER_NAME,
    env?.CF_WORKER_NAME,
  ];
  for (const c of candidates) {
    const s = c != null ? String(c).trim() : '';
    if (s) return s;
  }
  return null;
}

/**
 * @param {any} env
 * @param {string} [context]
 * @returns {string}
 */
export function requireWorkerProjectId(env, context = 'worker_identity') {
  const id = resolveWorkerProjectId(env);
  if (!id) {
    throw new Error(
      `${context}: PROJECT_ID or WORKER_NAME missing from env — set wrangler vars (no hardcoded worker fallback)`,
    );
  }
  return id;
}

/**
 * PTY cd target: "." when repoDir is empty or already the workspace folder name.
 * Uses path basename only — never a fixed platform repo string.
 * @param {string|null|undefined} repoDirRaw
 * @param {string|null|undefined} workspaceRoot
 * @returns {string}
 */
export function normalizePtyRepoDirForWorkspace(repoDirRaw, workspaceRoot) {
  const raw = String(repoDirRaw || '').trim();
  if (!raw || raw === '.') return '.';
  const wsTail =
    String(workspaceRoot || '')
      .split(/[/\\]/)
      .filter(Boolean)
      .pop() || '';
  if (wsTail && raw === wsTail) return '.';
  return raw;
}
