/**
 * Pure bootstrap derivation — policy/role/flag inputs → materialized snapshot fields.
 * Authority lives in agentsam_user_policy, membership, governance tables — not here.
 */

import { DEFAULT_USER_POLICY } from '../../identity/index.js';
import { jsonStable } from './contract.js';

/**
 * @param {Record<string, unknown>} policy from loadAgentSamUserPolicy (or partial in tests)
 */
export function deriveCapabilitiesFromPolicy(policy = {}) {
  const p = { ...DEFAULT_USER_POLICY, ...policy };
  return {
    can_run_pty: Number(p.can_run_pty) === 1,
    mcp_tools_protection: Number(p.mcp_tools_protection) !== 0,
    file_deletion_protection: Number(p.file_deletion_protection) !== 0,
    external_file_protection: Number(p.external_file_protection) !== 0,
    require_allowlist_for_mcp: Number(p.require_allowlist_for_mcp) === 1,
    tool_risk_level_max: String(p.tool_risk_level_max),
    allow_subagent_spawn: Number(p.allow_subagent_spawn) === 1,
    allow_fanout_execution: Number(p.allow_fanout_execution) === 1,
    max_tool_chain_depth: Number(p.max_tool_chain_depth) || DEFAULT_USER_POLICY.max_tool_chain_depth,
    max_spawn_depth: Number(p.max_spawn_depth) || DEFAULT_USER_POLICY.max_spawn_depth,
  };
}

/**
 * @param {Array<{ role_id?: string, role_name?: string, workspace_id?: string, tenant_id?: string }>} rows
 */
export function deriveGovernanceRolesFromRows(rows = []) {
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const roleId = r?.role_id != null ? String(r.role_id).trim() : '';
    if (!roleId || seen.has(roleId)) continue;
    seen.add(roleId);
    out.push({
      role_id: roleId,
      role_name: r?.role_name != null ? String(r.role_name) : roleId,
      workspace_id: r?.workspace_id != null ? String(r.workspace_id) : '',
      tenant_id: r?.tenant_id != null ? String(r.tenant_id) : '',
    });
  }
  return out;
}

/**
 * @param {{
 *   capabilities?: Record<string, unknown>,
 *   governanceRoles?: unknown[],
 *   policyVersion?: number,
 * }} p
 */
export function materializeBootstrapJson(p = {}) {
  return {
    capabilities_json: jsonStable(p.capabilities ?? {}),
    governance_roles_json: JSON.stringify(p.governanceRoles ?? []),
    policy_version: Number(p.policyVersion) || 1,
  };
}
