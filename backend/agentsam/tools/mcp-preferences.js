/**
 * MCP OAuth consent + settings — tool groups and four-option preferences.
 * Enforcement at runtime is unchanged (row presence + oauth catalog); this module
 * only decides which tool_key rows to upsert/delete in agentsam_mcp_allowlist.
 */

/** @typedef {'deny' | 'read' | 'ask' | 'allow'} McpToolPreference */

export const MCP_TOOL_PREFERENCES = /** @type {const} */ (['deny', 'read', 'ask', 'allow']);

const GROUP_LABELS = {
  discovery: 'Discovery',
  database: 'Database & D1',
  storage: 'Storage (R2)',
  github: 'GitHub',
  memory: 'Memory & knowledge',
  search: 'Search & RAG',
  agent: 'Agent & planning',
  integrations: 'Integrations',
  write: 'Write & mutations',
  general: 'General tools',
  mcp: 'MCP tools',
  other: 'Other tools',
};

function trim(v) {
  return v == null ? '' : String(v).trim();
}

export function normalizeMcpToolGroupKey(raw, accessClass) {
  const k = trim(raw).toLowerCase();
  if (k) return k.replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').slice(0, 48);
  return accessClass === 'write' ? 'write' : 'general';
}

export function mcpToolGroupLabel(groupKey) {
  return GROUP_LABELS[groupKey] || groupKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * @param {Array<{ tool_key: string, label?: string, access_class?: string, tool_category?: string, risk_level?: string, requires_approval?: boolean }>} tools
 */
export function groupMcpToolsForPreferences(tools) {
  const map = new Map();
  for (const t of tools || []) {
    const tool_key = trim(t.tool_key);
    if (!tool_key) continue;
    const access_class = trim(t.access_class).toLowerCase() === 'write' ? 'write' : 'read';
    const group_key = normalizeMcpToolGroupKey(t.tool_category, access_class);
    if (!map.has(group_key)) {
      map.set(group_key, {
        group_key,
        label: mcpToolGroupLabel(group_key),
        tools: [],
        read_count: 0,
        write_count: 0,
      });
    }
    const g = map.get(group_key);
    g.tools.push({
      tool_key,
      label: trim(t.label) || tool_key,
      access_class,
      risk_level: trim(t.risk_level) || 'low',
      requires_approval: Boolean(t.requires_approval),
    });
    if (access_class === 'write') g.write_count += 1;
    else g.read_count += 1;
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Safe defaults when user does not expand "Review tool permissions".
 * @param {ReturnType<typeof groupMcpToolsForPreferences>} groups
 * @param {{ hasAgentScope?: boolean }} opts
 * @returns {Record<string, McpToolPreference>}
 */
export function buildSafeDefaultMcpGroupPreferences(groups, opts = {}) {
  const hasAgent = Boolean(opts.hasAgentScope);
  /** @type {Record<string, McpToolPreference>} */
  const out = {};
  for (const g of groups) {
    if (g.write_count > 0 && !hasAgent) out[g.group_key] = 'deny';
    else if (g.write_count > 0) out[g.group_key] = 'read';
    else out[g.group_key] = 'read';
  }
  return out;
}

/**
 * @param {Array<{ tool_key: string, access_class?: string }>} groupTools
 * @param {McpToolPreference} preference
 */
export function expandGroupPreferenceToToolKeys(groupTools, preference) {
  if (preference === 'deny') return [];
  const tools = groupTools || [];
  if (preference === 'read') {
    return tools.filter((t) => trim(t.access_class) !== 'write').map((t) => t.tool_key);
  }
  return tools.map((t) => t.tool_key);
}

/**
 * Infer group-level preference from existing allowlist rows.
 * @param {Array<{ tool_key: string, access_class?: string }>} groupTools
 * @param {Set<string>} allowedKeys
 */
export function inferGroupPreferenceFromAllowlist(groupTools, allowedKeys) {
  const tools = groupTools || [];
  const allowed = tools.filter((t) => allowedKeys.has(t.tool_key));
  if (!allowed.length) return 'deny';
  const writeTools = tools.filter((t) => trim(t.access_class) === 'write');
  const allowedWrite = allowed.filter((t) => trim(t.access_class) === 'write');
  if (writeTools.length && allowedWrite.length === writeTools.length && allowed.length === tools.length) {
    return 'allow';
  }
  if (allowed.length === tools.length) return 'ask';
  if (allowedWrite.length === 0 && allowed.length > 0) return 'read';
  if (allowedWrite.length > 0 && allowedWrite.length < writeTools.length) return 'ask';
  return 'read';
}

/**
 * @param {any} env
 * @param {{ userId: string, workspaceId: string, tenantId?: string, catalogTools: Array<{ tool_key: string, access_class?: string }>, groupPreferences: Record<string, string> }} input
 */
export async function persistMcpAllowlistFromGroupPreferences(env, input) {
  if (!env?.DB) throw new Error('database_not_configured');
  const userId = trim(input.userId);
  const workspaceId = trim(input.workspaceId);
  if (!userId || !workspaceId) throw new Error('missing_actor_scope');

  const groups = groupMcpToolsForPreferences(input.catalogTools);
  const prefs = input.groupPreferences || {};
  const catalogKeys = new Set((input.catalogTools || []).map((t) => trim(t.tool_key)).filter(Boolean));

  /** @type {Map<string, McpToolPreference>} */
  const toolPref = new Map();
  for (const g of groups) {
    const prefRaw = trim(prefs[g.group_key]).toLowerCase();
    const pref = MCP_TOOL_PREFERENCES.includes(prefRaw) ? prefRaw : 'deny';
    for (const key of expandGroupPreferenceToToolKeys(g.tools, pref)) {
      if (catalogKeys.has(key)) toolPref.set(key, pref === 'deny' ? 'deny' : pref);
    }
  }

  const keepKeys = [...toolPref.keys()].filter((k) => toolPref.get(k) !== 'deny');

  if (catalogKeys.size) {
    const ph = [...catalogKeys].map(() => '?').join(',');
    await env.DB.prepare(
      `DELETE FROM agentsam_mcp_allowlist
        WHERE user_id = ? AND workspace_id = ? AND tool_key IN (${ph})`,
    )
      .bind(userId, workspaceId, ...catalogKeys)
      .run();
  }

  for (const tool_key of keepKeys) {
    const preference = toolPref.get(tool_key) || 'allow';
    const id = `mal_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    try {
      await env.DB.prepare(
        `INSERT INTO agentsam_mcp_allowlist (id, user_id, workspace_id, tool_key, preference, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, workspace_id, tool_key) DO UPDATE SET
           preference = excluded.preference,
           notes = excluded.notes`,
      )
        .bind(id, userId, workspaceId, tool_key, preference, null)
        .run();
    } catch (e) {
      if (!String(e?.message || '').includes('no such column')) throw e;
      await env.DB.prepare(
        `INSERT INTO agentsam_mcp_allowlist (id, user_id, workspace_id, tool_key, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, workspace_id, tool_key) DO NOTHING`,
      )
        .bind(id, userId, workspaceId, tool_key)
        .run();
    }
  }

  return { saved: keepKeys.length, groups: groups.length };
}
