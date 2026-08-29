/**
 * Codemode routing constants — no @cloudflare/codemode import (safe for Node smoke/tests).
 */
export const CODEMODE_TOOL_NAME = 'codemode';

/**
 * Ledger / catalog attribution for the outer `codemode` envelope row.
 * Matches D1 `agentsam_tools.id = tool_codemode_meta`.
 * is_active=1 (registry truth); oauth_visible=0 (not MCP tools/list).
 * Mounted for agent / debug / multitask via shouldUseCodemodeForRequest.
 */
export const CODEMODE_TOOLS_ID = 'tool_codemode_meta';
export const CODEMODE_TOOL_CATEGORY = 'runtime.codemode';
export const CODEMODE_HANDLER_KEY = 'cf.codemode';
export const CODEMODE_CAPABILITY_KEY = 'runtime.codemode';
export const CODEMODE_HANDLER_TYPE = 'cf';

/**
 * Sandbox connector namespace for the already-authorized Agent Sam tool menu.
 * Cloudflare Codemode requires a connector; this is presentation, not a second catalog plane.
 */
export const CODEMODE_TOOL_CONNECTOR = 'tools';
/** @deprecated Use CODEMODE_TOOL_CONNECTOR — "catalog" implied a parallel capability universe. */
export const CODEMODE_CATALOG_CONNECTOR = CODEMODE_TOOL_CONNECTOR;

/** Hosted durable runtime identity returned by getOrBuildCodemodeRuntime. */
export const CODEMODE_RUNTIME_MODE = 'durable_runtime';

/** Routes that skip codemode entirely (native allowlist only — no additive codemode mount). */
export const CODEMODE_EXEMPT_ROUTE_KEYS = new Set([
  'design_intake',
  'cad_generation',
  'design_studio',
  'cms_code_pass',
  'mcp_panel',
]);

/**
 * @param {import('@cloudflare/workers-types').Env} env
 * @param {{ agentLikeTooling?: boolean }} ctx
 */
export function shouldUseCodemodeTooling(env, ctx = {}) {
  return Boolean(env?.LOADER && env?.DB && ctx.agentLikeTooling);
}

/**
 * @param {string|null|undefined} routeKey
 * @param {string|null|undefined} taskType
 */
export function isCodemodeExemptRoute(routeKey, taskType) {
  const rk = routeKey != null ? String(routeKey).trim().toLowerCase() : '';
  const tt = taskType != null ? String(taskType).trim().toLowerCase() : '';
  if (rk && CODEMODE_EXEMPT_ROUTE_KEYS.has(rk)) return true;
  if (tt && CODEMODE_EXEMPT_ROUTE_KEYS.has(tt)) return true;
  return false;
}

/**
 * Codemode eligibility: LOADER+DB, agent/debug/multitask mode tooling, not an exempt route.
 * No task_type string carve-outs — multitask is included via agentLikeTooling (profile.mode).
 *
 * @param {import('@cloudflare/workers-types').Env} env
 * @param {{
 *   agentLikeTooling?: boolean,
 *   routeKey?: string|null,
 *   routeKeyPin?: string|null,
 *   resolvedRoutingTaskType?: string|null,
 *   rawBodyTaskType?: string|null,
 * }} ctx
 */
export function shouldUseCodemodeForRequest(env, ctx = {}) {
  if (!shouldUseCodemodeTooling(env, { agentLikeTooling: ctx.agentLikeTooling })) return false;
  if (isCodemodeExemptRoute(ctx.routeKey, ctx.routeKeyPin)) return false;
  if (isCodemodeExemptRoute(ctx.resolvedRoutingTaskType, ctx.rawBodyTaskType)) return false;
  return true;
}
