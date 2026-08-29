// guard-dup-allow: backend/browser domain peel from src/core (residual closeout)
/**
 * Browser capability tool listing from agentsam_tools (workspace_scope aware).
 */

function parseJsonField(raw, fallback = null) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function toolMatchesBrowserFamily(toolName, category) {
  const n = String(toolName || '').toLowerCase();
  const c = String(category || '').toLowerCase();
  return (
    c.includes('browser') ||
    n.startsWith('browser_') ||
    n === 'playwright_screenshot' ||
    n.startsWith('playwright_') ||
    n.startsWith('cdt_')
  );
}

function rowMatchesWorkspaceScope(row, workspaceId) {
  const ws = String(workspaceId || '').trim();
  const scope = parseJsonField(row.workspace_scope, ['*']);
  const arr = Array.isArray(scope) ? scope : ['*'];
  if (arr.includes('*')) return true;
  if (!ws) return false;
  return arr.some((x) => String(x || '').trim() === ws);
}

/**
 * @param {any} env
 * @param {string} tenantId
 * @param {string} workspaceId
 * @param {string} userId
 */
export async function loadAvailableToolsForCapability(env, tenantId, workspaceId, userId) {
  void tenantId;
  void userId;
  if (!env?.DB) return [];

  const scope = {
    workspaceId: String(workspaceId || '').trim(),
  };

  const out = [];
  try {
    const { results: tRows } = await env.DB.prepare(
      `SELECT tool_name, tool_key, tool_category, handler_type, risk_level, requires_approval,
              input_schema, schema_hint, handler_config, workspace_scope, is_active, is_degraded
         FROM agentsam_tools
        WHERE COALESCE(is_active, 1) = 1 AND COALESCE(is_degraded, 0) = 0`,
    ).all();
    for (const row of tRows || []) {
      const toolName = String(row.tool_name || row.tool_key || '').trim();
      if (!toolName || !toolMatchesBrowserFamily(toolName, row.tool_category)) continue;
      if (!rowMatchesWorkspaceScope(row, scope.workspaceId)) continue;
      out.push({
        tool_name: toolName,
        tool_category: String(row.tool_category || '').trim() || null,
        handler_type: String(row.handler_type || '').trim(),
        risk_level: String(row.risk_level || 'low').trim(),
        requires_approval: Number(row.requires_approval) === 1,
        input_schema: parseJsonField(row.input_schema, {}),
        schema_hint: row.schema_hint != null ? String(row.schema_hint) : null,
        handler_config: parseJsonField(row.handler_config, {}),
      });
    }
  } catch (e) {
    console.warn('[browser/capture/tool-registry] agentsam_tools', e?.message ?? e);
  }

  return out.sort((a, b) => String(a.tool_name).localeCompare(String(b.tool_name)));
}

export function isTrustedBrowserReadTool(toolName) {
  const n = String(toolName || '');
  return (
    n === 'browser_navigate' ||
    n === 'browser_content' ||
    n === 'playwright_screenshot' ||
    n === 'browser_screenshot' ||
    n === 'cdt_take_screenshot'
  );
}
