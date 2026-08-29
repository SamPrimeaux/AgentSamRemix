/**
 * Code / develop — thin alias over D1 profile compile.
 * Profile selection SSOT: agentsam_tool_profile_bindings (not this file).
 * Menu + cap SSOT: agentsam_tool_profiles where profile_key = code_develop
 *   (loadToolProfileRow → tool_keys_json + max_tools).
 */

/** Soft UI route keys used by agentsam_route_requirements lookup (not profile selection). */
export const CODE_DEVELOP_SOFT_ROUTE_KEYS = new Set([
  'agent_code',
  'agent_frontend',
  'workspace_editor',
]);

/** Hard route keys for route-requirements lookup. */
export const CODE_DEVELOP_ROUTE_KEYS = new Set([
  'agent_terminal',
  'agent_debug',
]);

/**
 * @param {string} message
 * @deprecated Message heuristics must not select tool profiles. Kept for call-site compat only.
 */
export function isCodeMutateIntent(message) {
  void message;
  return false;
}

/**
 * @deprecated DELETE-BY boring-law: profile selection is bindings-only.
 */
export function shouldUseCodeDevelopToolProfile(_ctx) {
  return false;
}

/**
 * Compile tool rows from D1 profile code_develop only (no JS pin list / invent cap).
 * @param {unknown} env
 * @param {{ userId: string, tenantId?: string|null, workspaceId?: string|null, isSuperadmin?: boolean }} scope
 * @param {{
 *   maxTools?: number|null,
 *   taskType?: string|null,
 *   modeSlug?: string|null,
 *   message?: string|null,
 *   routeToolRequirements?: import('./agentsam-route-tool-resolver.js').RouteToolRequirements|null,
 * }} opts
 */
export async function compileCodeDevelopToolRows(env, scope, opts = {}) {
  const { compileD1ToolProfileRows } = await import('./d1-tool-profile.js');
  const det = await compileD1ToolProfileRows(env, scope, {
    profileKey: 'code_develop',
    maxTools: opts.maxTools,
    taskType: opts.taskType,
    modeSlug: opts.modeSlug,
    message: opts.message,
    routeToolRequirements: opts.routeToolRequirements,
  });
  if (!det.rows?.length) {
    console.warn(
      '[code-develop-tool-profile] d1_profile_empty',
      JSON.stringify({ profile_key: 'code_develop', source: det.source }),
    );
  }
  return det;
}
