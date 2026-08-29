/**
 * In-app Agent Sam — minimal tool spine (one functional lane).
 * Replaces 128-tool OAuth parity for dashboard agent chat until each tool is proven.
 * Execution: main worker dispatchByToolCode (never MCP host proxy).
 */
import {
  EXECUTABLE_HANDLER_TYPES,
  loadExecutableHandlerTypes,
  rowMatchesMode,
  rowMatchesWorkspaceScope,
  rowWithinRiskCap,
  validateHandlerConfigForExecution,
} from './agentsam-tools-catalog.js';
import { parseHandlerConfig } from '../../backend/credentials/resolver.js';
import { mapCatalogRowsToMcpParityAgentTools } from './in-app-mcp-oauth-parity.js';

/** Curated in-app bundle for read-only / ask lane. Agent/debug use OAuth parity catalog. */
export const IN_APP_AGENT_SPINE_TOOL_KEYS = Object.freeze([
  'agentsam_repo_intelligence',
  'agentsam_repo_context',
  'agentsam_github_tree',
  'agentsam_github_read',
  'agentsam_github_read_many',
  'agentsam_github_search',
  'agentsam_github_repo_list',
  'agentsam_d1_query',
]);

export const IN_APP_AGENT_SPINE_TOOL_LIMIT = IN_APP_AGENT_SPINE_TOOL_KEYS.length;

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{ userId?: string, tenantId?: string, workspaceId?: string, isSuperadmin?: boolean }} runtimeCtx
 * @param {{ outputLimit?: number, modeSlug?: string, riskLevelMax?: string|null, extraToolKeys?: string[] }} opts
 */
export async function selectInAppAgentSpineToolsForAgentChat(db, runtimeCtx, opts = {}) {
  const ws = trim(runtimeCtx?.workspaceId);
  const outputLimit = Math.max(
    1,
    Math.min(
      IN_APP_AGENT_SPINE_TOOL_LIMIT + (opts.extraToolKeys?.length || 0),
      Number(opts.outputLimit) || IN_APP_AGENT_SPINE_TOOL_LIMIT,
    ),
  );

  if (!db || !ws) {
    return { rows: [], source: 'in_app_agent_spine', tool_count: 0 };
  }

  const keyOrder = [
    ...IN_APP_AGENT_SPINE_TOOL_KEYS,
    ...(Array.isArray(opts.extraToolKeys) ? opts.extraToolKeys.map((k) => trim(k).toLowerCase()) : []),
  ].filter(Boolean);
  const uniqueKeys = [...new Set(keyOrder)];
  if (!uniqueKeys.length) {
    return { rows: [], source: 'in_app_agent_spine', tool_count: 0 };
  }

  const placeholders = uniqueKeys.map(() => '?').join(',');
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
         AND lower(tool_key) IN (${placeholders})
         AND (
           COALESCE(is_global, 1) = 1
           OR workspace_scope IS NULL
           OR trim(workspace_scope) IN ('', '[]')
           OR workspace_scope LIKE '%"*"%'
           OR workspace_scope LIKE ('%' || ? || '%')
         )`,
    )
      .bind(...uniqueKeys, ws)
      .all();
    catalogRows = results || [];
  } catch (e) {
    console.warn('[in-app-agent-spine] catalog query', e?.message ?? e);
    return { rows: [], source: 'in_app_agent_spine', tool_count: 0 };
  }

  const byKey = new Map();
  for (const row of catalogRows) {
    const key = trim(row.tool_key).toLowerCase();
    if (key) byKey.set(key, row);
  }

  const env = { DB: db };
  const executableTypes = await loadExecutableHandlerTypes(env);
  const out = [];
  for (const key of uniqueKeys) {
    const row = byKey.get(key);
    if (!row) {
      console.warn('[in-app-agent-spine] missing_catalog_row', key);
      continue;
    }
    if (!rowMatchesWorkspaceScope(row, ws)) continue;
    if (!rowMatchesMode(row, opts.modeSlug)) continue;
    if (!rowWithinRiskCap(row, opts.riskLevelMax)) continue;

    const cfg = parseHandlerConfig(row.handler_config);
    const v = validateHandlerConfigForExecution(row, cfg, executableTypes || EXECUTABLE_HANDLER_TYPES);
    if (!v.ok) {
      console.warn('[in-app-agent-spine] skip_invalid', key, v.error);
      continue;
    }
    out.push(mapCatalogRowsToMcpParityAgentTools([row])[0]);
    if (out.length >= outputLimit) break;
  }

  return { rows: out, source: 'in_app_agent_spine', tool_count: out.length };
}
