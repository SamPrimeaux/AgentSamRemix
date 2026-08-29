/**
 * agentsam_tools catalog writes (SSOT). OAuth visibility via oauth_visible column.
 */

import { loadAgentsamToolRow } from './agentsam-tools-catalog.js';

function trim(v) {
  if (v == null) return '';
  return String(v).trim();
}

/**
 * @deprecated Mirror removed — catalog row is SSOT.
 * @param {any} env
 * @param {string} toolIdentifier
 * @returns {Promise<{ ok: boolean, tool_key?: string, error?: string }>}
 */
export async function syncAgentsamMcpToolMirrorFromCatalog(env, toolIdentifier) {
  const catalog = await loadAgentsamToolRow(env, toolIdentifier);
  if (!catalog) {
    return { ok: false, error: `agentsam_tools not found: ${toolIdentifier}` };
  }
  const toolKey = trim(catalog.tool_key || catalog.tool_name);
  return { ok: true, tool_key: toolKey };
}

/**
 * Apply catalog field updates to agentsam_tools.
 * @param {any} env
 * @param {string} toolIdentifier
 * @param {Record<string, unknown>} patch
 */
export async function patchAgentsamToolCatalogAndMirror(env, toolIdentifier, patch) {
  const row = await loadAgentsamToolRow(env, toolIdentifier);
  if (!row) return { ok: false, error: 'Tool not found in agentsam_tools' };
  if (!env?.DB) return { ok: false, error: 'DB binding missing' };

  const sets = [];
  const binds = [];
  const allowed = [
    'tool_category',
    'mcp_service_url',
    'description',
    'input_schema',
    'requires_approval',
    'handler_config',
    'handler_type',
    'risk_level',
    'modes_json',
    'is_active',
    'is_degraded',
    'oauth_visible',
  ];

  for (const col of allowed) {
    if (patch[col] == null) continue;
    let val = patch[col];
    if (col === 'input_schema' || col === 'handler_config' || col === 'modes_json') {
      val = typeof val === 'string' ? val : JSON.stringify(val);
    }
    if (col === 'requires_approval' || col === 'is_active' || col === 'is_degraded' || col === 'oauth_visible') {
      const n = Number(val);
      val = Number.isFinite(n) ? n : val ? 1 : 0;
    }
    sets.push(`${col} = ?`);
    binds.push(val);
  }

  if (!sets.length) return { ok: false, error: 'No allowed fields to update' };

  sets.push('updated_at = unixepoch()');
  const key = trim(row.tool_key || row.tool_name);
  binds.push(key, key, key);

  await env.DB.prepare(
    `UPDATE agentsam_tools SET ${sets.join(', ')}
     WHERE tool_key = ? OR tool_name = ? OR tool_code = ?`,
  )
    .bind(...binds)
    .run();

  const updated = await loadAgentsamToolRow(env, key);
  return { ok: true, tool: updated };
}
