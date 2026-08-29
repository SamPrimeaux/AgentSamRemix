/**
 * OAuth MCP tools/list — resolve allowlisted keys to agentsam_tools catalog rows (SSOT only).
 */
import {
  inputSchemaFromAgentsamToolRow,
  loadAgentsamToolRow,
} from './agentsam-tools-catalog.js';
import { isAgentsamD1CfSqlFaceTool } from './d1-query-tool-contract.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} publicKey — OAuth allowlist / token key (e.g. agentsam_d1_query)
 */
async function resolveOAuthCatalogToolRow(db, publicKey) {
  const k = trim(publicKey);
  if (!k || !db) return null;
  return loadAgentsamToolRow({ DB: db }, k);
}

const OPERATOR_TERMINAL_TOOLS = new Set(['agentsam_terminal_remote']);

/**
 * Build tools/list for OAuth sessions (ChatGPT). Uses agentsam_tools + canonical input schemas.
 *
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string[]} tokenAllowedTools
 * @param {string} oauthClientId
 * @param {{ isPlatformOperator?: boolean }} [opts]
 */
export async function buildOAuthToolsList(db, tokenAllowedTools, oauthClientId, opts = {}) {
  if (!Array.isArray(tokenAllowedTools) || tokenAllowedTools.length === 0) {
    return [];
  }

  const { results: catalogRows } = await db
    .prepare(
      `SELECT tool_key FROM agentsam_mcp_oauth_tool_allowlist
        WHERE client_id = ? AND COALESCE(is_active, 1) = 1`,
    )
    .bind(oauthClientId)
    .all();

  const catalogSet = new Set((catalogRows || []).map((r) => String(r.tool_key || '').toLowerCase()));
  const isOp = opts.isPlatformOperator === true;
  const eligible = tokenAllowedTools.filter((key) => {
    const k = String(key || '').toLowerCase();
    if (!catalogSet.has(k)) return false;
    if (!isOp && OPERATOR_TERMINAL_TOOLS.has(k)) return false;
    return true;
  });
  if (!eligible.length) return [];

  const settled = await Promise.allSettled(
    eligible.map((key) => resolveOAuthCatalogToolRow(db, key)),
  );

  const tools = [];
  for (let i = 0; i < settled.length; i++) {
    const { status, value } = settled[i];
    if (status !== 'fulfilled' || !value) continue;

    const row = value;
    const mcpName = trim(eligible[i]) || trim(row.tool_key);
    if (!mcpName) continue;

    const inputSchema = inputSchemaFromAgentsamToolRow(row);
    if (!isAgentsamD1CfSqlFaceTool(mcpName) && !isAgentsamD1CfSqlFaceTool(row.tool_key)) {
      delete inputSchema.required;
    }

    tools.push({
      name: mcpName,
      description: [trim(row.display_name), trim(row.description), trim(row.tool_name)]
        .filter(Boolean)
        .join(' — ')
        .slice(0, 4000) || mcpName,
      inputSchema,
      ...(row.risk_level && row.risk_level !== 'low'
        ? { annotations: { riskLevel: row.risk_level } }
        : {}),
    });
  }

  return tools;
}
