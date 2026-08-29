/**
 * Action-aware MCP tool authorization (actor + action + tool + workspace + risk).
 */

import { assertActorContext } from './runtime-actor.js';
import { loadAgentsamToolRow } from './agentsam-tools-catalog.js';
import {
  isToolAllowedByAllowlist,
  isToolAllowedByPolicyRisk,
  isExplicitUserMcpAllowlistPath,
  requiresApprovalForTool,
} from './agent-policy.js';
import { loadAgentSamUserPolicy } from '../../backend/identity/index.js';

function trim(v) {
  if (v == null) return '';
  return String(v).trim();
}

/**
 * @param {string|null|undefined} path
 * @returns {'user_allowlist'|'workspace_policy'|'policy_source_workspace'|'tool_default'}
 */
function policySourceFromAllowlistPath(path) {
  const p = trim(path);
  if (!p || p === 'baseline_builtin') return 'tool_default';
  if (p.startsWith('allowlist_')) return 'user_allowlist';
  if (p === 'superadmin_scoped_mcp_tool' || p === 'allowlist_tenant_workspace_tool') {
    return 'policy_source_workspace';
  }
  if (p === 'workspace_mcp_registry_fallback' || p === 'scoped_mcp_tool_row') return 'workspace_policy';
  return 'tool_default';
}

/**
 * @param {any} env
 * @param {{
 *   actor: Record<string, unknown>,
 *   toolKey: string,
 *   actionType?: string | null,
 *   resourceType?: string | null,
 *   resourceId?: string | null,
 *   riskLevel?: string | null,
 *   inputJson?: unknown,
 * }} input
 * @returns {Promise<{ decision: {
 *   allowed: boolean,
 *   requiresApproval: boolean,
 *   denialCode: string | null,
 *   policySource: string | null,
 *   maxTimeoutMs: number,
 * }, mcpRow: object | null }>}
 */
export async function authorizeMcpTool(env, input) {
  const toolKey = trim(input?.toolKey);
  const actor = input?.actor;
  const maxDefault = 30000;

  const deny = (code, partial = {}) => ({
    decision: {
      allowed: false,
      requiresApproval: false,
      denialCode: code,
      policySource: partial.policySource ?? null,
      maxTimeoutMs: partial.maxTimeoutMs ?? maxDefault,
    },
    mcpRow: null,
  });

  try {
    assertActorContext(actor);
  } catch {
    return deny('ACTOR_CONTEXT_MISSING');
  }

  if (!toolKey) {
    return deny('MCP_TOOL_NOT_REGISTERED');
  }

  if (!env?.DB) {
    return deny('ACTOR_CONTEXT_MISSING');
  }

  const scope = {
    userId: actor.userId,
    tenantId: actor.tenantId,
    workspaceId: actor.workspaceId,
    personUuid: actor.personUuid,
  };

  const catalogRow = await loadAgentsamToolRow(env, toolKey);
  if (!catalogRow) {
    return deny('MCP_TOOL_NOT_REGISTERED');
  }
  const mcpRow = { ...catalogRow, enabled: Number(catalogRow.is_active ?? 1) };

  const policy = await loadAgentSamUserPolicy(env, actor.userId, actor.workspaceId);
  const effectiveRisk = trim(input.riskLevel) || trim(mcpRow.risk_level) || 'low';
  const policyRiskOk = isToolAllowedByPolicyRisk(policy, effectiveRisk);
  if (!policyRiskOk) {
    return deny('MCP_RISK_DENIED', { policySource: 'policy_source_workspace' });
  }

  const allow = await isToolAllowedByAllowlist(env, policy, scope, toolKey, mcpRow);
  if (!allow.allowed) {
    return deny('MCP_ALLOWLIST_DENIED', { policySource: null });
  }

  const policySource = Number(policy.require_allowlist_for_mcp || 0) === 1
    ? policySourceFromAllowlistPath(allow.path)
    : 'tool_default';

  const allowlistMatched =
    Number(policy.require_allowlist_for_mcp || 0) === 1 &&
    isExplicitUserMcpAllowlistPath(allow.path);
  const requiresApproval = requiresApprovalForTool(mcpRow, policyRiskOk, true, {
    policy,
    allowlistMatched,
    allowlistPath: allow.path,
  });

  let timeoutSec = Math.max(1, Math.floor(Number(mcpRow.timeout_seconds) || 30));
  if (
    toolKey === 'agentsam_terminal_sandbox' ||
    toolKey === 'agentsam_container_exec'
  ) {
    timeoutSec = Math.max(timeoutSec, 120);
  }
  const maxTimeoutMs = Math.min(600_000, timeoutSec * 1000);

  return {
    decision: {
      allowed: true,
      requiresApproval,
      denialCode: null,
      policySource,
      maxTimeoutMs,
    },
    mcpRow,
  };
}
