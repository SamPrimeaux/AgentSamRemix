/**
 * Catalog dispatch for open-web tools — must not fall through to generic ai_complete.
 * Canonical handler_type: `websearch` (distinct from `mybrowser` / MYBROWSER and from generic `ai`).
 * Legacy rows may still use handler_type `ai` + execution_lane metadata until migrated.
 */

/** @param {Record<string, unknown>|null|undefined} config */
export function resolveOpenWebDispatchTarget(config, toolKey = '') {
  const c = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const lane = String(c.execution_lane || '').trim();
  const target = String(c.dispatch_target || c.dispatcher || toolKey || '').trim();
  if (lane === 'open_web_search' || target === 'search_web') return 'search_web';
  if (lane === 'web_fetch' || target === 'web_fetch') return 'web_fetch';
  return null;
}

/**
 * @param {Record<string, unknown>|null|undefined} config
 * @param {string} [toolKey]
 */
export function isOpenWebCatalogConfig(config, toolKey = '') {
  return resolveOpenWebDispatchTarget(config, toolKey) != null;
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} config
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} runContext
 * @param {string} [toolKey]
 */
export async function executeOpenWebCatalogDispatch(env, config, params, runContext, toolKey = '') {
  const target = resolveOpenWebDispatchTarget(config, toolKey);
  if (!target) {
    return { ok: false, error: 'open_web_catalog_config_missing_dispatch_target' };
  }
  const { handlers: webHandlers } = await import('../../backend/agentsam/tools/web.js');
  const fn = webHandlers[target];
  if (typeof fn !== 'function') {
    return { ok: false, error: `open_web handler not registered: ${target}` };
  }
  const out = await fn(params, env, runContext);
  // Budget stop is intentional soft guidance — never surface as hard catalog failure.
  if (out?.budget_exhausted === true) {
    return { ok: true, body: out };
  }
  return out?.error ? { ok: false, error: String(out.error) } : { ok: true, body: out };
}

/** Canonical handler_config for search_web (handler_type=websearch). */
export const SEARCH_WEB_HANDLER_CONFIG = Object.freeze({
  execution_lane: 'open_web_search',
  web_backend: 'tavily',
  dispatch_target: 'search_web',
  dispatcher: 'search_web',
  auth_source: 'platform',
  env_key: 'TAVILY_API_KEY',
  not_browser: true,
  not_workspace_search: true,
  source_file: 'backend/agentsam/tools/web.js',
});

/** Canonical handler_config for web_fetch (handler_type=websearch). */
export const WEB_FETCH_HANDLER_CONFIG = Object.freeze({
  execution_lane: 'web_fetch',
  dispatch_target: 'web_fetch',
  dispatcher: 'web_fetch',
  auth_source: 'platform',
  platform_bindingless: true,
  not_browser: true,
  not_workspace_search: true,
  source_file: 'backend/agentsam/tools/web.js',
});

/** D1 `agentsam_tools.handler_type` for open-web lane (Tavily + URL fetch; not MYBROWSER). */
export const OPEN_WEB_HANDLER_TYPE = 'websearch';
