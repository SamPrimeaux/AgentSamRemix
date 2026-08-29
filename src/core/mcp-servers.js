/**
 * Resolve MCP server metadata for a tool row and update health on agentsam_mcp_servers.
 *
 * Order: tool.server_id → tool.server_key → tenant/workspace scoped active server → tool.mcp_service_url.
 * Does not remove mcp_service_url fallback.
 */

function trim(v) {
  if (v == null) return '';
  return String(v).trim();
}

function parseHandlerConfigServerKey(toolRow) {
  const raw = toolRow?.handler_config;
  if (raw == null) return '';
  try {
    const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return trim(cfg?.server_key);
  } catch {
    return '';
  }
}

function parseHandlerConfigMcpUrl(toolRow) {
  const direct = trim(toolRow?.mcp_service_url);
  if (direct) return direct;
  const raw = toolRow?.handler_config;
  if (raw == null) return '';
  try {
    const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return trim(cfg?.mcp_service_url);
  } catch {
    return '';
  }
}

/**
 * @param {any} env
 * @param {{ tenantId?: string|null, workspaceId?: string|null }} context
 * @param {object|null} toolRow agentsam_tools row
 * @returns {Promise<{ url: string, source: string, serverRow: object|null }>}
 */
export async function resolveMcpServerForTool(env, context, toolRow) {
  const fallbackUrl = parseHandlerConfigMcpUrl(toolRow);
  const tenantId = trim(context?.tenantId);
  const workspaceId = trim(context?.workspaceId);

  if (!env?.DB) {
    return { url: fallbackUrl, source: fallbackUrl ? 'tool.mcp_service_url' : 'none', serverRow: null };
  }

  const serverId = trim(toolRow?.server_id);
  if (serverId) {
    try {
      const row = await env.DB.prepare(`SELECT * FROM agentsam_mcp_servers WHERE id = ? AND COALESCE(is_active,1)=1 LIMIT 1`)
        .bind(serverId)
        .first();
      if (row?.url) {
        return { url: String(row.url), source: 'agentsam_mcp_servers.id', serverRow: row };
      }
    } catch (_) {}
  }

  const serverKey = trim(toolRow?.server_key) || parseHandlerConfigServerKey(toolRow);
  if (serverKey) {
    try {
      const row = await env.DB.prepare(
        `SELECT * FROM agentsam_mcp_servers WHERE server_key = ? AND COALESCE(is_active,1)=1 LIMIT 1`,
      )
        .bind(serverKey)
        .first();
      if (row?.url) {
        return { url: String(row.url), source: 'agentsam_mcp_servers.server_key', serverRow: row };
      }
    } catch (_) {}
  }

  if (tenantId || workspaceId) {
    try {
      const row = await env.DB.prepare(
        `SELECT * FROM agentsam_mcp_servers
         WHERE COALESCE(is_active,1)=1
           AND (
             (?1 != '' AND tenant_id = ?1 AND (workspace_id IS NULL OR workspace_id = '' OR workspace_id = ?2))
             OR (?2 != '' AND workspace_id = ?2)
           )
         ORDER BY (CASE WHEN workspace_id = ?2 AND ?2 != '' THEN 0 ELSE 1 END)
         LIMIT 1`,
      )
        .bind(tenantId, workspaceId)
        .first();
      if (row?.url) {
        return { url: String(row.url), source: 'agentsam_mcp_servers.scoped', serverRow: row };
      }
    } catch (_) {}
  }

  if (fallbackUrl) {
    try {
      const row = await env.DB.prepare(
        `SELECT * FROM agentsam_mcp_servers
         WHERE trim(url) = ? AND COALESCE(is_active, 1) = 1
         LIMIT 1`,
      )
        .bind(fallbackUrl)
        .first();
      if (row?.url) {
        return { url: String(row.url), source: 'agentsam_mcp_servers.url', serverRow: row };
      }
    } catch (_) {}
    return { url: fallbackUrl, source: 'tool.mcp_service_url', serverRow: null };
  }

  return { url: '', source: 'none', serverRow: null };
}

/**
 * @param {any} env
 * @param {string} serverIdOrKey
 * @param {string} status
 */
export async function updateMcpServerHealth(env, serverIdOrKey, status) {
  if (!env?.DB) return;
  const id = trim(serverIdOrKey);
  const st = trim(status) || 'unknown';
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare(
      `UPDATE agentsam_mcp_servers SET health_status = ?, last_health_at = ?, updated_at = ?
       WHERE id = ? OR server_key = ?`,
    )
      .bind(st, now, now, id, id)
      .run();
  } catch (e) {
    console.warn('[updateMcpServerHealth]', e?.message ?? e);
  }
}
