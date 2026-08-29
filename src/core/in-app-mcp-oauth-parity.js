/**
 * In-app Agent Sam ↔ MCP OAuth tool parity (Claude.ai / ChatGPT / Cursor).
 * tools/list: all agentsam_tools.oauth_visible (same as MCP buildOAuthMcpToolsListFromAgentsamTools).
 * tools/call: iam_mcp_inneranimalmedia allowlist gate only (same as MCP enforceOAuthToolGuards).
 * Execution stays on main worker via dispatchByToolCode (never proxy through MCP host).
 */
import { MCP_CANONICAL_CLIENT_ID } from '../api/mcp-oauth-shared.js';
import {
  inputSchemaFromAgentsamToolRow,
  rowMatchesWorkspaceScope,
} from './agentsam-tools-catalog.js';
import { collectAllowlistToolKeysForScope } from './agent-policy.js';
import {
  expandOAuthAllowlistKeysToCatalogKeys,
  loadCatalogToolRowForDispatch,
  resolveCatalogDispatchToolKey,
} from './catalog-tool-key-resolve.js';

export const IN_APP_MCP_OAUTH_CLIENT_ID = MCP_CANONICAL_CLIENT_ID;
/**
 * Absolute safety clamp for MCP OAuth tools/list only — not an in-app menu SSOT.
 * In-app resolveRuntimeProfile / agent chat must pass agentsam_tool_profiles.max_tools as outputLimit.
 * @deprecated Prefer caller-supplied outputLimit from D1 profile.max_tools.
 */
export const IN_APP_MCP_PARITY_TOOL_LIMIT = 256;

const OPERATOR_ONLY_OAUTH_TOOLS = new Set(['agentsam_terminal_remote']);

/** Legacy OAuth allowlist aliases (MCP mcp-oauth-allowlist-merge.js). */
export const OAUTH_EMAIL_TOOL_ALIASES = Object.freeze({
  agentsam_email_send: 'agentsam_send_email',
});

function trim(v) {
  return v == null ? '' : String(v).trim();
}

export function normalizeOAuthAllowlistKey(key) {
  const k = trim(key).toLowerCase();
  if (!k) return '';
  return OAUTH_EMAIL_TOOL_ALIASES[k] || k;
}

/** Live OAuth surface allowlist (same SSOT as MCP worker tools/call). */
export async function loadLiveOAuthToolAllowlistKeys(env, clientId = IN_APP_MCP_OAUTH_CLIENT_ID) {
  if (!env?.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT tool_key FROM agentsam_mcp_oauth_tool_allowlist
       WHERE client_id = ?
         AND COALESCE(is_active, 1) = 1
       ORDER BY COALESCE(sort_order, 50) ASC, tool_key ASC`,
    )
      .bind(trim(clientId) || IN_APP_MCP_OAUTH_CLIENT_ID)
      .all();
    return (results || [])
      .map((r) => normalizeOAuthAllowlistKey(r?.tool_key))
      .filter(Boolean);
  } catch (e) {
    console.warn('[in-app-mcp-oauth-parity] loadLiveOAuthToolAllowlistKeys', e?.message ?? e);
    return [];
  }
}

/**
 * Call-time allowlist keys (mirrors MCP mergeLiveOAuthAllowlistTools / resolveOAuthAllowlistKeys).
 * @param {any} env
 * @param {{ userId?: string, workspaceId?: string, tenantId?: string, personUuid?: string, hasPlatformPolicyGrant?: boolean }} scope
 */
export async function collectInAppOAuthMcpToolKeys(env, scope, opts = {}) {
  const liveKeys = await loadLiveOAuthToolAllowlistKeys(env);
  const liveSet = new Set(liveKeys);
  if (!liveSet.size) return liveSet;

  if (opts.hasPlatformPolicyGrant === true || scope?.hasPlatformPolicyGrant === true) {
    return liveSet;
  }

  const uid = trim(scope?.userId);
  if (uid) {
    try {
      const grant = await env.DB.prepare(
        `SELECT 1 FROM agentsam_mcp_oauth_user_client_allowlist
         WHERE user_id = ? AND COALESCE(is_active, 1) = 1
         LIMIT 1`,
      )
        .bind(uid)
        .first();
      if (grant) {
        return liveSet;
      }
    } catch (_) {}
  }

  const workspaceAllow = await collectAllowlistToolKeysForScope(env?.DB, scope);
  if (!workspaceAllow.size) {
    return liveSet;
  }

  const merged = new Set();
  for (const k of liveSet) {
    if (workspaceAllow.has(k)) merged.add(k);
  }
  return merged.size ? merged : liveSet;
}

/** MCP OAuth public tool names use tool_key (not branded tool_name). */
export function mapCatalogRowsToMcpParityAgentTools(rows) {
  return (rows || []).map((r) => {
    const key = trim(r.tool_key) || trim(r.tool_name);
    const desc =
      trim(r.description) || trim(r.display_name) || trim(r.tool_name) || key;
    return {
      name: key,
      description: desc.slice(0, 4000),
      input_schema: inputSchemaFromAgentsamToolRow(r),
      tool_category: trim(r.tool_category) || 'builtin',
      requires_approval: Number(r.requires_approval || 0) === 1,
      tool_key: key,
      tool_name: trim(r.tool_name) || key,
      capability_key: trim(r.capability_key),
      caller_policy: r.caller_policy != null ? r.caller_policy : null,
    };
  });
}

function dedupeMcpParityToolsByName(tools) {
  const out = [];
  const seen = new Set();
  for (const t of tools || []) {
    const key = trim(t?.name || t?.tool_key).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * In-app tools/list — mirrors MCP buildOAuthMcpToolsListFromAgentsamTools (no allowlist at list time).
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{ userId?: string, tenantId?: string, workspaceId?: string, personUuid?: string, mayUsePrivilegedTerminal?: boolean, hasPlatformPolicyGrant?: boolean }} runtimeCtx
 * @param {{ outputLimit?: number, modeSlug?: string, mayUsePrivilegedTerminal?: boolean, hasPlatformPolicyGrant?: boolean }} opts
 */
export async function selectOAuthMcpParityToolsForAgentChat(db, runtimeCtx, opts = {}) {
  const ws = trim(runtimeCtx?.workspaceId);
  // Caller must pass D1 profile / route cap. Missing → fail closed (no invent 256 dump).
  const requested = Number(opts.outputLimit);
  const outputLimit =
    Number.isFinite(requested) && requested >= 0 ? Math.floor(requested) : 0;
  const mayUsePrivilegedTerminal =
    opts.mayUsePrivilegedTerminal === true || runtimeCtx?.mayUsePrivilegedTerminal === true;

  if (!db || !ws || outputLimit <= 0) {
    return { rows: [], source: 'oauth_mcp_parity', tool_count: 0 };
  }

  let catalogRows = [];
  try {
    const { results } = await db.prepare(
      `SELECT tool_key, tool_name, display_name, tool_category, description,
              input_schema, handler_config, capability_key, risk_level, requires_approval,
              modes_json, workspace_scope, handler_type, is_degraded, mcp_service_url, sort_priority,
              caller_policy
       FROM agentsam_tools
       WHERE COALESCE(is_active, 1) = 1
         AND COALESCE(is_degraded, 0) = 0
         AND COALESCE(oauth_visible, 0) = 1
         AND (
           COALESCE(is_global, 1) = 1
           OR workspace_scope IS NULL
           OR trim(workspace_scope) IN ('', '[]')
           OR workspace_scope LIKE '%"*"%'
           OR workspace_scope LIKE ('%' || ? || '%')
         )
       ORDER BY COALESCE(sort_priority, 50) ASC, tool_key ASC`,
    )
      .bind(ws)
      .all();
    catalogRows = results || [];
  } catch (e) {
    console.warn('[in-app-mcp-oauth-parity] catalog query', e?.message ?? e);
    return { rows: [], source: 'oauth_mcp_parity', tool_count: 0 };
  }

  const mapped = [];
  for (const row of catalogRows) {
    const key = trim(row.tool_key).toLowerCase();
    if (!key) continue;
    if (!mayUsePrivilegedTerminal && OPERATOR_ONLY_OAUTH_TOOLS.has(key)) continue;
    if (!rowMatchesWorkspaceScope(row, ws)) continue;
    mapped.push(mapCatalogRowsToMcpParityAgentTools([row])[0]);
  }

  const deduped = dedupeMcpParityToolsByName(mapped);
  const rows = deduped.slice(0, outputLimit);

  console.info(
    '[in-app-mcp-oauth-parity] selected',
    JSON.stringify({
      workspace_id: ws,
      oauth_visible_candidates: catalogRows.length,
      selected: rows.length,
      list_policy: 'oauth_visible_only',
    }),
  );

  return { rows, source: 'oauth_mcp_parity', tool_count: rows.length };
}

/**
 * Call-time gate: oauth_visible + allowlist (MCP tools/call parity).
 * Superadmin: any oauth_visible catalog tool (MCP allowed_tools = null).
 * @param {any} env
 * @param {string} toolKey
 * @param {{ mayUsePrivilegedTerminal?: boolean, hasPlatformPolicyGrant?: boolean, userId?: string, workspaceId?: string, tenantId?: string, personUuid?: string }} scope
 */
export async function isOAuthMcpParityToolAllowed(env, toolKey, scope = {}) {
  const raw = trim(toolKey);
  if (!raw || !env?.DB) return false;

  const row = await loadCatalogToolRowForDispatch(env, raw);
  if (!row || Number(row.is_active ?? 1) !== 1 || Number(row.oauth_visible) !== 1) {
    return false;
  }

  const resolvedKey = trim(row.tool_key).toLowerCase() || resolveCatalogDispatchToolKey(raw).toLowerCase();
  const aliases = new Set([raw.toLowerCase(), resolvedKey, resolveCatalogDispatchToolKey(raw).toLowerCase()]);

  if (!scope.mayUsePrivilegedTerminal && OPERATOR_ONLY_OAUTH_TOOLS.has(resolvedKey)) {
    return false;
  }

  if (scope.hasPlatformPolicyGrant === true) {
    return true;
  }

  const allowed = await collectInAppOAuthMcpToolKeys(env, scope, {
    hasPlatformPolicyGrant: scope.hasPlatformPolicyGrant === true,
  });
  const expanded = await expandOAuthAllowlistKeysToCatalogKeys(env, allowed);
  for (const a of aliases) {
    if (expanded.has(a)) return true;
  }
  return false;
}
