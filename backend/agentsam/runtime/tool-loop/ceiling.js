import { loadAgentsamToolRow } from '../../../../src/core/agentsam-tools-catalog.js';

/**
 * Mode-ceiling allow check: agentsam_tools.modes_json must include execution mode.
 * @param {any} env
 * @param {string} mode
 * @param {string} toolName
 */
export async function assertToolAllowedByMode(env, mode, toolName) {
  const name = String(toolName || '').trim();
  if (!name) return { ok: false, reason: 'tool_name_required' };
  const m = String(mode || 'agent').trim().toLowerCase() || 'agent';
  try {
    const { toolAllowsExecutionMode } = await import('../../../../src/core/mode-tool-ceiling.js');
    const row = await loadAgentsamToolRow(env, name);
    if (!row) return { ok: true, reason: 'no_catalog_row' };
    if (!toolAllowsExecutionMode(row.modes_json, m)) {
      return { ok: false, reason: 'mode_ceiling', mode: m, tool: name };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[tool-host] assertToolAllowedByMode', e?.message ?? e);
    return { ok: true, reason: 'ceiling_check_error' };
  }
}
