/**
 * OAuth MCP × agentsam_user_policy / agentsam_mcp_allowlist intersection.
 * External clients: when require_allowlist_for_mcp = 1, only tools on BOTH
 * agentsam_mcp_oauth_tool_allowlist AND the user's personal allowlist apply.
 */
import {
  findMcpAllowlistMatch,
  isToolAllowedByPolicyRisk,
} from './agent-policy.js';
import { loadAgentSamUserPolicy } from '../../backend/identity/index.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/** External OAuth comms tools — always on token allowlist when on client catalog (ChatGPT discovery). */
const PLATFORM_OAUTH_COMMS_TOOL_KEYS = new Set(['agentsam_notify', 'agentsam_send_email']);

const OAUTH_EMAIL_TOOL_ALIASES = {
  agentsam_email_send: 'agentsam_send_email',
};

function normalizeOAuthToolKey(key) {
  const k = trim(key).toLowerCase();
  return OAUTH_EMAIL_TOOL_ALIASES[k] || k;
}

/**
 * Strict allowlist for OAuth — no workspace registry fallback when user policy requires allowlist.
 * @param {any} env
 * @param {object} policy
 * @param {{ userId: string, workspaceId: string, tenantId?: string, personUuid?: string }} scope
 * @param {string} toolKey
 */
export async function isOAuthUserToolAllowed(env, policy, scope, toolKey) {
  const name = trim(toolKey);
  if (!name) return { allowed: false, reason: 'missing_tool' };

  const role = String(scope.membershipRole || scope.membership_role || '').trim().toLowerCase();
  if (role === 'owner') {
    return { allowed: true, reason: 'workspace_owner' };
  }

  if (!policy || Number(policy.require_allowlist_for_mcp || 0) !== 1) {
    return { allowed: true, reason: 'allowlist_not_required' };
  }

  const ws = trim(scope.workspaceId);
  const uid = trim(scope.userId);
  if (!ws || !uid) {
    return { allowed: false, reason: 'missing_actor_scope' };
  }

  const { matched, path } = await findMcpAllowlistMatch(env?.DB, scope, name);
  if (matched) return { allowed: true, reason: null, path };

  return { allowed: false, reason: 'tool not in user allowlist', path };
}

/**
 * Filter OAuth client catalog keys by user/workspace policy.
 * @param {any} env
 * @param {{ userId: string, workspaceId: string, tenantId?: string, personUuid?: string, clientId?: string }} scope
 * @param {string[]} oauthToolKeys
 * @returns {Promise<{ keys: string[], policy: object, requireAllowlist: boolean }>}
 */
export async function filterOAuthToolKeysForUser(env, scope, oauthToolKeys) {
  const keys = (oauthToolKeys || []).map((k) => normalizeOAuthToolKey(k)).filter(Boolean);
  const oauthSet = new Set(keys);
  const policy = await loadAgentSamUserPolicy(env, scope.userId, scope.workspaceId);
  const requireAllowlist = Number(policy.require_allowlist_for_mcp || 0) === 1;

  if (!requireAllowlist) {
    return { keys, policy, requireAllowlist: false };
  }

  const out = [];
  for (const toolKey of keys) {
    const allow = await isOAuthUserToolAllowed(env, policy, scope, toolKey);
    if (allow.allowed) out.push(toolKey);
  }
  for (const comms of PLATFORM_OAUTH_COMMS_TOOL_KEYS) {
    if (oauthSet.has(comms) && !out.includes(comms)) out.push(comms);
  }
  return { keys: out, policy, requireAllowlist: true };
}

/**
 * Load tool risk from registry for policy risk cap at runtime (IAM paths).
 * @param {any} env
 * @param {string} toolKey
 */
export async function loadMcpToolRiskLevel(env, toolKey) {
  if (!env?.DB || !toolKey) return 'low';
  try {
    const row = await env.DB.prepare(
      `SELECT risk_level FROM agentsam_tools
        WHERE tool_key = ? AND COALESCE(is_active, 1) = 1
        LIMIT 1`,
    )
      .bind(trim(toolKey))
      .first();
    return trim(row?.risk_level) || 'low';
  } catch {
    return 'low';
  }
}

export function isToolRiskAllowedByPolicy(policy, riskLevel) {
  return isToolAllowedByPolicyRisk(policy, riskLevel);
}
