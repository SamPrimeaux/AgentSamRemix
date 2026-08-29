/**
 * Browser session scope — bsess_* lease id (BROWSER_SESSION DO key).
 * Not agent_run_id, not workflow_run_id, not spawn_session.
 */

/** @returns {string} */
export function newBrowserSessionId() {
  return `bsess_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** @param {unknown} id */
export function isBrowserSessionId(id) {
  const s = String(id || '').trim();
  return s.startsWith('bsess_') && s.length > 8;
}

/**
 * Resolve stateful browser scope from tool/request params.
 * @param {Record<string, unknown>} params
 * @returns {string|null}
 */
export function resolveBrowserSessionScopeId(params) {
  const candidates = [
    params.browser_session_id,
    params.browserSessionId,
    params.browser_session_key,
    params.scope_id,
    params.scopeId,
  ];
  for (const c of candidates) {
    const s = c != null ? String(c).trim() : '';
    if (isBrowserSessionId(s)) return s;
  }
  return null;
}

/**
 * @deprecated Use resolveBrowserSessionScopeId — agent_run_id is not a browser DO key.
 * @param {Record<string, unknown>} params
 * @returns {string|null}
 */
export function resolveBrowserRunScopeId(params) {
  return resolveBrowserSessionScopeId(params);
}

/** Stateless quick-action lane — no bsess_* lease. */
const STATELESS_BROWSER_TOOL_PREFIXES = ['browser_run_'];

/**
 * Stateful MYBROWSER tools require a bsess_* lease (Phase E).
 * @param {unknown} toolName
 */
export function browserToolRequiresSession(toolName) {
  const t = String(toolName || '').trim();
  if (!t) return false;
  if (STATELESS_BROWSER_TOOL_PREFIXES.some((p) => t.startsWith(p))) return false;
  if (t === 'playwright_screenshot') return false;
  if (t.startsWith('browser_') || t.startsWith('cdt_')) return true;
  return false;
}
