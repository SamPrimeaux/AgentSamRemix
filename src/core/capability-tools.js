/**
 * DB-driven capability tool names (image / video / email families).
 * Registry: agentsam_tools.intent_category_tags + workspace_scope.
 */

/**
 * @param {unknown} env
 * @param {string|null|undefined} workspaceId
 * @param {string} mode
 * @param {string} intentCategoryTag
 * @returns {Promise<string[]>}
 */
export async function getCapabilityTools(env, workspaceId, mode, intentCategoryTag) {
  const ws = workspaceId != null ? String(workspaceId).trim() : '';
  if (!env?.DB || !ws) return [];
  const modeSlug = String(mode || 'agent').trim();
  const tag = String(intentCategoryTag || '').trim();
  if (!tag) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT COALESCE(tool_name, tool_key) AS tool_name
       FROM agentsam_tools
       WHERE intent_category_tags = ?
         AND COALESCE(is_active, 1) = 1
         AND COALESCE(is_degraded, 0) = 0
         AND (
           COALESCE(is_global, 1) = 1
           OR workspace_scope IS NULL OR trim(workspace_scope) IN ('', '[]')
           OR workspace_scope LIKE '%"*"%'
           OR (? != '' AND instr(COALESCE(workspace_scope, ''), ?) > 0)
         )
         AND modes_json LIKE ?`,
    )
      .bind(tag, ws, ws, `%${modeSlug}%`)
      .all();
    return (results || []).map((r) => String(r.tool_name || '').trim()).filter(Boolean);
  } catch (e) {
    console.warn('[capability-tools] getCapabilityTools', e?.message ?? e);
    return [];
  }
}
