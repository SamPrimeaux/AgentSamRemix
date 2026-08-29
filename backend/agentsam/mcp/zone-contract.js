/**
 * MCP zone structural contract — slugs, ids, state parse/map.
 * No D1 writes, no HTTP, no tool execution.
 */

export const MCP_ZONE_SLUGS = ['engineer', 'architect', 'cms', 'specialist'];
const MCP_ZONE_SLUG_SET = new Set(MCP_ZONE_SLUGS);

/** @param {string} raw */
export function normalizeMcpZoneSlug(raw) {
  const s = String(raw || 'specialist')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  return MCP_ZONE_SLUG_SET.has(s) ? s : 'specialist';
}

/**
 * Normalize a user/container slug (alphanumeric workspace tags). Rejects MCP role facet names.
 * @param {string | null | undefined} raw
 */
export function normalizeSandboxContainerSlug(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 64);
  if (!s || MCP_ZONE_SLUG_SET.has(s)) return null;
  // Auth user id fragments (au_871d… → 871d920d1233cbd1) are not sandbox cwd tags.
  if (/^[a-f0-9]{12,32}$/.test(s)) return null;
  return s;
}

/** @param {string} zoneSlug @param {string} tenantId */
export function resolveMcpZoneWorkspaceId(zoneSlug, tenantId) {
  const z = normalizeMcpZoneSlug(zoneSlug);
  const t = String(tenantId || 'platform')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .slice(0, 48);
  return `ws_mcp_${z}_${t}`;
}

/** @param {string} zoneSlug @param {string} tenantId */
export function resolveMcpZoneConversationId(zoneSlug, tenantId) {
  const z = normalizeMcpZoneSlug(zoneSlug);
  const t = String(tenantId || 'platform')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .slice(0, 80);
  return `mcpconv_${z}_${t}`;
}

/** @param {unknown} raw */
export function parseMcpZoneStateJson(raw) {
  if (raw == null || raw === '') return {};
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}

/** Map workspace_state row → UI session shape. */
export function mapZoneStateToSession(row, zoneSlug) {
  const st = parseMcpZoneStateJson(row?.state_json);
  const convId = String(row?.conversation_id || st.conversation_id || '').trim();
  const messages = Array.isArray(st.messages) ? st.messages : [];
  return {
    id: convId || resolveMcpZoneConversationId(zoneSlug, st.tenant_id || row?.tenant_id),
    agent_id: normalizeMcpZoneSlug(zoneSlug),
    workspace_id: String(row?.workspace_id || '').trim() || null,
    status: String(st.status || 'idle'),
    current_task: st.current_task ?? null,
    progress_pct: Number(st.progress_pct) || 0,
    cost_usd: Number(st.cost_usd) || 0,
    tool_calls_count: Number(st.tool_calls_count) || 0,
    last_activity: st.last_activity ?? (row?.updated_at ? String(row.updated_at) : null),
    updated_at: row?.updated_at != null ? Number(row.updated_at) : null,
    messages_json: JSON.stringify(messages),
    panel: st.panel || 'mcp_zone',
    spawn_job_id: st.spawn_job_id ?? null,
    master_run_id: st.master_run_id ?? null,
  };
}

export function isMcpZoneSlug(raw) {
  return MCP_ZONE_SLUG_SET.has(normalizeMcpZoneSlug(raw));
}
