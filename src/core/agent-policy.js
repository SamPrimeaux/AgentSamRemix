/**
 * Agent Sam tool allowlist/risk/approval policy.
 *
 * Mutable user/workspace policy loading is owned by backend/identity/permissions.
 * This legacy-root module remains only until its MCP/catalog dependencies are peeled.
 */

import { loadAgentsamToolPolicyKeySet } from './agentsam-tool-policy-keys.js';
import { expandToolKeyAliases, resolveCatalogDispatchToolKey } from './catalog-tool-key-resolve.js';
import { normalizeAutoRunMode } from '../../backend/identity/permissions/user-policy.js';

const RISK_ORDER = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

function riskRank(level) {
  const k = String(level || 'low').toLowerCase();
  return RISK_ORDER[k] ?? 1;
}

function trimId(v) {
  if (v == null) return '';
  return String(v).trim();
}

function tenantMatchesRow(actorTenant, rowTenant) {
  const r = trimId(rowTenant);
  if (!r) return true;
  const a = trimId(actorTenant);
  if (!a) return false;
  return r === a;
}

/**
 * All tool_key values allowed for this actor on this workspace (visibility for model tool list).
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{ userId?: string, workspaceId?: string, tenantId?: string|null, personUuid?: string|null }} scope
 * @returns {Promise<Set<string>>}
 */
export async function collectAllowlistToolKeysForScope(db, scope) {
  const out = new Set();
  const ws = trimId(scope?.workspaceId);
  const uid = trimId(scope?.userId);
  const tid = trimId(scope?.tenantId);
  const pid = trimId(scope?.personUuid);
  if (!db || !ws) return out;
  try {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT tool_key FROM agentsam_mcp_allowlist
         WHERE workspace_id = ?
           AND COALESCE(is_allowed, 1) = 1
           AND (
             (user_id = ? AND trim(user_id) != '')
             OR (person_uuid = ? AND trim(person_uuid) != '')
             OR (tenant_id = ? AND trim(tenant_id) != '')
           )
           AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)`,
      )
      .bind(ws, uid, pid, tid, tid || '')
      .all();
    for (const r of results || []) {
      const k = trimId(r?.tool_key);
      if (k) out.add(k);
    }
  } catch (_) {}
  return out;
}

export async function findMcpAllowlistMatch(db, scope, toolKey) {
  const name = trimId(toolKey);
  const uid = trimId(scope?.userId);
  const ws = trimId(scope?.workspaceId);
  const tid = trimId(scope?.tenantId);
  const pid = trimId(scope?.personUuid);
  if (!db || !name || !ws) return { matched: false, path: null };

  const tryHit = async (sql, binds, path) => {
    try {
      const hit = await db.prepare(sql).bind(...binds).first();
      return hit ? { matched: true, path } : { matched: false, path: null };
    } catch {
      return { matched: false, path: null };
    }
  };

  if (uid) {
    const a = await tryHit(
      `SELECT 1 FROM agentsam_mcp_allowlist
       WHERE user_id = ? AND workspace_id = ? AND tool_key = ?
         AND COALESCE(is_allowed, 1) = 1
         AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)
       LIMIT 1`,
      [uid, ws, name, tid || ''],
      'allowlist_user_workspace_tool',
    );
    if (a.matched) return a;
  }

  if (pid) {
    const b = await tryHit(
      `SELECT 1 FROM agentsam_mcp_allowlist
       WHERE person_uuid = ? AND workspace_id = ? AND tool_key = ?
         AND COALESCE(is_allowed, 1) = 1
         AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)
       LIMIT 1`,
      [pid, ws, name, tid || ''],
      'allowlist_person_workspace_tool',
    );
    if (b.matched) return b;
  }

  if (tid) {
    const c = await tryHit(
      `SELECT 1 FROM agentsam_mcp_allowlist
       WHERE tenant_id = ? AND workspace_id = ? AND tool_key = ?
         AND COALESCE(is_allowed, 1) = 1
       LIMIT 1`,
      [tid, ws, name],
      'allowlist_tenant_workspace_tool',
    );
    if (c.matched) return c;
  }

  return { matched: false, path: null };
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{ userId?: string, workspaceId?: string, tenantId?: string|null }} scope
 */
export async function mcpAllowlistRowCount(db, scope) {
  const uid = trimId(scope?.userId);
  const ws = trimId(scope?.workspaceId);
  const tid = trimId(scope?.tenantId);
  if (!db || !ws) return 0;
  try {
    if (uid) {
      const r = await db.prepare(
        `SELECT COUNT(*) AS c FROM agentsam_mcp_allowlist
         WHERE workspace_id = ? AND (tenant_id IS NULL OR tenant_id = '' OR tenant_id = ?)
           AND (user_id = ? OR person_uuid IS NOT NULL OR tenant_id IS NOT NULL)`,
      )
        .bind(ws, tid || '', uid)
        .first();
      const n = Number(r?.c || 0) || 0;
      if (n > 0) return n;
    }
    if (tid) {
      const r2 = await db.prepare(
        `SELECT COUNT(*) AS c FROM agentsam_mcp_allowlist WHERE workspace_id = ? AND tenant_id = ?`,
      )
        .bind(ws, tid)
        .first();
      return Number(r2?.c || 0) || 0;
    }
    return 0;
  } catch (_) {
    return 0;
  }
}

/**
 * @param {string} toolKey
 * @param {object} scope
 * @param {string|null} pathTried
 * @param {string} reason
 */
export function logMcpPolicyDenial(toolKey, scope, pathTried, reason) {
  try {
    console.warn(
      '[agent_policy] mcp_allowlist_denied',
      JSON.stringify({
        tool_key: toolKey,
        tenant_id: trimId(scope?.tenantId) || null,
        workspace_id: trimId(scope?.workspaceId) || null,
        user_id_present: !!trimId(scope?.userId),
        person_uuid_present: !!trimId(scope?.personUuid),
        allowlist_path_attempted: pathTried,
        reason,
      }),
    );
  } catch (_) {}
}

/**
 * @param {any} env
 * @param {object} policy
 * @param {{ userId?: string|null, workspaceId?: string|null, tenantId?: string|null, personUuid?: string|null, hasPlatformPolicyGrant?: boolean, mayUsePrivilegedTerminal?: boolean }} scope
 * @param {string} toolName
 * @param {object|null} mcpRow
 */
function policySetHasTool(policySet, toolName) {
  if (!policySet?.size) return false;
  const aliases = expandToolKeyAliases(toolName);
  for (const a of aliases) {
    if (policySet.has(a)) return true;
  }
  for (const k of policySet) {
    for (const a of expandToolKeyAliases(k)) {
      if (aliases.has(a)) return true;
    }
  }
  return false;
}

export async function isToolAllowedByAllowlist(env, policy, scope, toolName, mcpRow, opts = {}) {
  if (!policy || Number(policy.require_allowlist_for_mcp || 0) !== 1) {
    return { allowed: true, reason: null, path: null };
  }
  const name = trimId(toolName);
  if (!name) return { allowed: false, reason: 'missing_tool', path: null };
  const canonical = resolveCatalogDispatchToolKey(name) || name;

  // D1 baseline (agentsam_tool_policy_keys.builtin_safe_allowlist) then per-user
  // agentsam_mcp_allowlist rows — gated by agentsam_user_policy.require_allowlist_for_mcp.
  const baselineSafe = await loadAgentsamToolPolicyKeySet(env, 'builtin_safe_allowlist');
  if (policySetHasTool(baselineSafe, name)) {
    return { allowed: true, reason: 'baseline_builtin', path: 'baseline_builtin' };
  }

  try {
    const { isOAuthMcpParityToolAllowed } = await import('./in-app-mcp-oauth-parity.js');
    if (await isOAuthMcpParityToolAllowed(env, name, scope)) {
      return { allowed: true, reason: 'oauth_mcp_parity', path: 'oauth_mcp_parity' };
    }
    if (canonical !== name && (await isOAuthMcpParityToolAllowed(env, canonical, scope))) {
      return { allowed: true, reason: 'oauth_mcp_parity', path: 'oauth_mcp_parity' };
    }
  } catch (_) {}

  const ws = trimId(scope?.workspaceId);
  const tid = trimId(scope?.tenantId);
  if (!ws || !tid) {
    logMcpPolicyDenial(name, scope, null, 'missing_workspace_or_tenant_for_allowlist');
    return { allowed: false, reason: 'tool not in allowlist', path: null };
  }

  const pinnedAllowlist =
    scope?.allowlistKeySet instanceof Set
      ? scope.allowlistKeySet
      : scope?.allowlist_key_set instanceof Set
        ? scope.allowlist_key_set
        : null;
  if (pinnedAllowlist?.size && policySetHasTool(pinnedAllowlist, name)) {
    return { allowed: true, reason: null, path: 'allowlist_user_workspace_tool' };
  }

  for (const alias of expandToolKeyAliases(name)) {
    const { matched, path } = await findMcpAllowlistMatch(env?.DB, scope, alias);
    if (matched) return { allowed: true, reason: null, path };
  }

  const rowActive =
    mcpRow && Number(mcpRow.enabled ?? mcpRow.is_active ?? 0) === 1;
  const n = await mcpAllowlistRowCount(env?.DB, scope);
  if (n === 0 && rowActive && tenantMatchesRow(tid, mcpRow.tenant_id)) {
    const rw = trimId(mcpRow.workspace_id);
    if (!rw || rw === ws) {
      return { allowed: true, reason: null, path: 'workspace_mcp_registry_fallback' };
    }
  }

  if (rowActive && tenantMatchesRow(tid, mcpRow.tenant_id)) {
    const rw = trimId(mcpRow.workspace_id);
    if (!rw || rw === ws) {
      return { allowed: true, reason: null, path: 'scoped_mcp_tool_row' };
    }
  }

  logMcpPolicyDenial(name, scope, null, 'no_allowlist_or_mcp_match');
  return { allowed: false, reason: 'tool not in allowlist', path: null };
}

export function isToolAllowedByPolicyRisk(policy, inferredRisk) {
  const max = riskRank(policy?.tool_risk_level_max || 'high');
  const r = riskRank(inferredRisk);
  return r <= max;
}

/** True when isToolAllowedByAllowlist matched an explicit agentsam_mcp_allowlist row. */
export function isExplicitUserMcpAllowlistPath(path) {
  const p = trimId(path);
  return p === 'allowlist_user_workspace_tool' ||
    p === 'allowlist_person_workspace_tool' ||
    p === 'allowlist_tenant_workspace_tool';
}

/**
 * agentsam_user_policy.auto_run_mode + optional agentsam_mcp_allowlist grant.
 * @param {object|null|undefined} row agentsam_tools row
 * @param {boolean} policyRiskOk
 * @param {boolean} [modeRequiresApproval] legacy gate when auto_run_mode is not auto/allowlist
 * @param {{
 *   autoRunMode?: string|null,
 *   policy?: { auto_run_mode?: string|null }|null,
 *   allowlistMatched?: boolean,
 *   allowlistPath?: string|null,
 * }} [opts]
 */
export function requiresApprovalForTool(row, policyRiskOk, modeRequiresApproval, opts = {}) {
  if (!row || Number(row.requires_approval || 0) !== 1) return false;
  if (!policyRiskOk) return false;

  const autoRun = normalizeAutoRunMode(opts.autoRunMode ?? opts.policy?.auto_run_mode);
  const allowlistMatched =
    opts.allowlistMatched === true ||
    isExplicitUserMcpAllowlistPath(opts.allowlistPath);
  if (autoRun === 'allowlist' && allowlistMatched) return false;

  return modeRequiresApproval !== false;
}

export function isSubagentToolName(toolName) {
  const t = String(toolName || '').toLowerCase();
  return t === 'agentsam_run_agent' || t.startsWith('agentsam_spawn') || t.includes('subagent');
}
