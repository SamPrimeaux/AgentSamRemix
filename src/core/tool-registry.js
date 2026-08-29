/**
 * agentsam_tools-only capability tool selection (workspace_scope JSON).
 */

/** @typedef {'browser'|'monaco'|'excalidraw'|'d1'|'terminal'|'github'} CapabilityFamily */

function parseJsonField(raw, fallback = null) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function toolMatchesFamily(toolName, category, family) {
  const n = String(toolName || '').toLowerCase();
  const c = String(category || '').toLowerCase();
  if (family === 'browser') {
    return (
      c.includes('browser') ||
      n.startsWith('browser_') ||
      n === 'playwright_screenshot' ||
      n.startsWith('playwright_') ||
      n.startsWith('cdt_')
    );
  }
  if (family === 'excalidraw') {
    return n.startsWith('excalidraw_') || c.includes('excalidraw') || c.includes('draw');
  }
  if (family === 'monaco') {
    return (
      c.includes('code') ||
      c.includes('file') ||
      c.includes('workspace') ||
      n.startsWith('workspace_') ||
      n.includes('file') ||
      n.includes('monaco')
    );
  }
  if (family === 'd1') {
    return n.startsWith('d1_') || c.includes('d1') || c.includes('sql') || c.includes('database');
  }
  if (family === 'terminal') {
    return (
      n === 'terminal_execute' ||
      n === 'run_command' ||
      n === 'bash' ||
      n.startsWith('terminal_') ||
      c.includes('terminal')
    );
  }
  if (family === 'github') {
    return n.startsWith('github_') || c.includes('github');
  }
  return false;
}

/**
 * @param {{ workspace_id?: string|null, tenant_id?: string|null, user_id?: string|null }} row
 * @param {{ workspaceId: string, tenantId: string, userId: string }} scope
 */
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
 * @param {CapabilityFamily} capabilityFamily
 */
export async function loadAvailableToolsForCapability(env, tenantId, workspaceId, userId, capabilityFamily) {
  if (!env?.DB) return [];

  const scope = {
    workspaceId: String(workspaceId || '').trim(),
    tenantId: String(tenantId || '').trim(),
    userId: String(userId || '').trim(),
  };

  /** @type {Map<string, Record<string, unknown>>} */
  const byName = new Map();

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
      if (!toolName || !toolMatchesFamily(toolName, row.tool_category, capabilityFamily)) continue;
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
    console.warn('[tool-registry] agentsam_tools', e?.message ?? e);
  }

  return out.sort((a, b) => String(a.tool_name).localeCompare(String(b.tool_name)));
}

/**
 * @param {string} toolName
 * @param {Record<string, unknown>|null} row
 */
export function toolRequiresApproval(toolName, row) {
  const n = String(toolName || '');
  if (/d1_write|worker_deploy|terminal_execute|run_command|\bbash\b|r2_write|r2_delete|github_(push|merge|commit|pr)|delete_|agentsam_run_agent/i.test(n)) {
    return true;
  }
  if (row && row.requires_approval) return true;
  const risk = String(row?.risk_level || 'low').toLowerCase();
  if (risk === 'high' || risk === 'critical') return true;
  return false;
}

/**
 * Trusted-origin browser read tools may bypass registry approval flags.
 * @param {string} toolName
 */
export function isTrustedBrowserReadTool(toolName) {
  const n = String(toolName || '');
  return (
    n === 'browser_navigate' ||
    n === 'browser_content' ||
    n === 'playwright_screenshot' ||
    n === 'browser_screenshot'
  );
}
