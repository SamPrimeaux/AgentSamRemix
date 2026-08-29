/**
 * Inspect — thin alias over D1 profile compile.
 * Profile selection SSOT: agentsam_tool_profile_bindings (not this file).
 * Menu + cap SSOT: agentsam_tool_profiles where profile_key = inspect
 *   (loadToolProfileRow → tool_keys_json + max_tools).
 */

/**
 * @param {string} message
 * @deprecated Message heuristics must not select tool profiles.
 */
export function isRepoInspectIntent(message) {
  void message;
  return false;
}

/**
 * @deprecated DELETE-BY boring-law: profile selection is bindings-only.
 */
export function shouldUseInspectToolProfile(_ctx) {
  return false;
}

/**
 * Compile tool rows from D1 profile inspect only (no JS pin list / invent cap).
 * @param {unknown} env
 * @param {{ userId: string, tenantId?: string|null, workspaceId?: string|null }} scope
 * @param {{ maxTools?: number|null, message?: string|null, taskType?: string|null, modeSlug?: string|null }} opts
 */
export async function compileInspectToolRows(env, scope, opts = {}) {
  const { compileD1ToolProfileRows } = await import('./d1-tool-profile.js');
  const det = await compileD1ToolProfileRows(env, scope, {
    profileKey: 'inspect',
    maxTools: opts.maxTools,
    taskType: opts.taskType,
    modeSlug: opts.modeSlug,
    message: opts.message,
  });
  if (!det.rows?.length) {
    console.warn(
      '[inspect-tool-profile] d1_profile_empty',
      JSON.stringify({ profile_key: 'inspect', source: det.source }),
    );
  }
  return det;
}
