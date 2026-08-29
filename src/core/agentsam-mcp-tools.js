/**
 * Scoped resolution for agentsam_tools — workspace_scope JSON / is_global.
 */

/** @typedef {{ userId?: string|null, tenantId?: string|null, workspaceId?: string|null, personUuid?: string|null }} McpRuntimeScope */

export const AGENTSAM_TOOLS_WORKSPACE_SCOPE_SQL = `
  (
    COALESCE(is_global, 1) = 1
    OR workspace_scope IS NULL OR trim(workspace_scope) IN ('', '[]')
    OR workspace_scope LIKE '%"*"%'
    OR (? != '' AND instr(COALESCE(workspace_scope, ''), ?) > 0)
  )`;

function trimOrEmpty(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
}

/**
 * Single tool row scoped to workspace.
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {McpRuntimeScope} runtimeCtx
 * @param {string} toolIdentifier tool_key or tool_name
 */
export async function selectAgentsamMcpToolRow(db, runtimeCtx, toolIdentifier) {
  const name = String(toolIdentifier || '').trim();
  if (!name || !db) return null;

  const workspaceId = trimOrEmpty(runtimeCtx?.workspaceId);

  const sql = `
SELECT *
FROM agentsam_tools
WHERE COALESCE(is_active, 1) = 1
  AND COALESCE(is_degraded, 0) = 0
  AND ${AGENTSAM_TOOLS_WORKSPACE_SCOPE_SQL}
  AND (
    tool_key = ?
    OR tool_name = ?
    OR COALESCE(tool_name, tool_key) = ?
  )
ORDER BY
  COALESCE(sort_priority, 50) ASC,
  updated_at DESC
LIMIT 1`;

  try {
    return await db.prepare(sql)
      .bind(workspaceId, workspaceId, name, name, name)
      .first();
  } catch (e) {
    console.warn('[selectAgentsamMcpToolRow]', e?.message ?? e);
    return null;
  }
}

/**
 * MCP tools bound to remote server_key values (e.g. cloudflare-docs from agentsam_prompt_routes.mcp_template).
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {McpRuntimeScope} runtimeCtx
 * @param {string[]} serverKeys
 * @param {number} [limit]
 */
export async function listAgentsamMcpToolsForServerKeys(db, runtimeCtx, serverKeys, limit = 48) {
  const keys = [...new Set((serverKeys || []).map((k) => String(k || '').trim()).filter(Boolean))];
  const lim = Math.max(1, Math.min(200, Number(limit) || 48));
  if (!db || !keys.length) return [];

  const workspaceId = trimOrEmpty(runtimeCtx?.workspaceId);
  const placeholders = keys.map(() => '?').join(',');

  const sql = `
SELECT COALESCE(m.tool_name, m.tool_key) AS tool_name, m.tool_key, m.description, m.input_schema, m.tool_category,
       m.requires_approval, json_extract(m.handler_config, '$.server_key') AS server_key, m.mcp_service_url,
       m.id AS agentsam_tools_id, m.risk_level,
       s.url AS server_url
FROM agentsam_tools m
LEFT JOIN agentsam_mcp_servers s
  ON s.server_key = json_extract(m.handler_config, '$.server_key') AND COALESCE(s.is_active, 1) = 1
WHERE COALESCE(m.is_active, 1) = 1
  AND COALESCE(m.is_degraded, 0) = 0
  AND json_extract(m.handler_config, '$.server_key') IN (${placeholders})
  AND ${AGENTSAM_TOOLS_WORKSPACE_SCOPE_SQL}
ORDER BY COALESCE(m.sort_priority, 50) ASC, COALESCE(m.tool_name, m.tool_key) ASC
LIMIT ?`;

  try {
    const { results } = await db
      .prepare(sql)
      .bind(...keys, workspaceId, workspaceId, lim)
      .all();
    return Array.isArray(results) ? results : [];
  } catch (e) {
    console.warn('[listAgentsamMcpToolsForServerKeys]', e?.message ?? e);
    return [];
  }
}

/**
 * Tool catalog slice for the chat agent (respects workspace_scope).
 */
export async function selectAgentsamMcpToolsList(db, runtimeCtx, limit = 20) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 20));
  if (!db) return [];

  const workspaceId = trimOrEmpty(runtimeCtx?.workspaceId);

  const sql = `
SELECT COALESCE(tool_name, tool_key) AS tool_name, description, input_schema, tool_category, requires_approval
FROM agentsam_tools
WHERE COALESCE(is_active, 1) = 1
  AND COALESCE(is_degraded, 0) = 0
  AND ${AGENTSAM_TOOLS_WORKSPACE_SCOPE_SQL}
ORDER BY COALESCE(tool_name, tool_key) ASC
LIMIT ?`;

  try {
    const { results } = await db.prepare(sql)
      .bind(workspaceId, workspaceId, lim)
      .all();
    return Array.isArray(results) ? results : [];
  } catch (e) {
    console.warn('[selectAgentsamMcpToolsList]', e?.message ?? e);
    return [];
  }
}
