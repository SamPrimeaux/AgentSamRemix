/**
 * Agent hub connectors catalog — same spine as Settings → Integrations (integration_registry + catalog).
 * Used by mobile ContextHub Connectors directory and optional in-app tool enablement.
 */
import { jsonResponse } from '../agentsam/shared.js';
import { fetchAuthUserTenantId, fallbackSystemTenantId } from '../../identity/users/tenant.js';
import { resolveIntegrationUserId } from '../../integrations/user-id.js';
import { catalogSlugForRegistry } from '../../integrations/slug-aliases.js';
import { mapConnectTileRow } from '../../integrations/connect-tile.js';
import {
  AGENT_HUB_REGISTRY_KEYS,
  connectorKindForProvider,
} from '../../integrations/connectors-hub-helpers.js';
import { resolveIntegrationIconUrl } from '../../integrations/brand-avatars.js';

export { AGENT_HUB_REGISTRY_KEYS, connectorKindForProvider };

const OAUTH_PROVIDER_ALIASES = {
  cloudflare_oauth: ['cloudflare'],
  supabase_oauth: ['supabase_management', 'supabase'],
  google_gmail: ['google_gmail', 'gmail'],
  gmail: ['google_gmail', 'gmail'],
  github: ['github'],
  google_drive: ['google_drive'],
};

/**
 * @param {object} env
 * @param {object} authUser
 */
async function resolveCatalogTenantId(env, authUser) {
  if (authUser?.tenant_id && String(authUser.tenant_id).trim()) {
    return String(authUser.tenant_id).trim();
  }
  if (authUser?.id && env?.DB) {
    const tid = await fetchAuthUserTenantId(env, authUser.id);
    if (tid) return tid;
  }
  if (env?.TENANT_ID) return String(env.TENANT_ID).trim();
  return fallbackSystemTenantId(env);
}

async function loadTokenProviders(env, db, userId, tenantId) {
  const tok = new Set();
  const byok = new Set();
  if (!userId || !db) return { tok, byok };
  try {
    const tr = await db
      .prepare(`SELECT DISTINCT lower(provider) AS p FROM user_oauth_tokens WHERE user_id = ?`)
      .bind(userId)
      .all();
    for (const r of tr.results || []) {
      if (r?.p) tok.add(String(r.p).toLowerCase());
    }
  } catch {
    /* ignore */
  }
  try {
    const { listConfiguredByokProviderSlugs } = await import(
      '../../credentials/user-secret-store.js'
    );
    for (const p of await listConfiguredByokProviderSlugs(env, { userId, tenantId })) {
      byok.add(p);
      if (p === 'google') byok.add('google_ai');
    }
  } catch {
    /* ignore */
  }
  return { tok, byok };
}

async function loadAgentHubRegistryRows(db, tenantId, keys) {
  if (!db || !keys.length) return [];
  const placeholders = keys.map(() => '?').join(', ');
  const sql = `
    SELECT r.*,
           c.name AS catalog_name,
           c.slug AS catalog_slug,
           c.category AS catalog_category,
           c.icon_slug,
           c.icon_url AS catalog_icon_url,
           c.auth_type AS catalog_auth_type,
           c.sort_order AS catalog_sort_order
    FROM integration_registry r
    LEFT JOIN integration_catalog c ON c.slug = CASE r.provider_key
      WHEN 'cloudflare_oauth' THEN 'cloudflare'
      WHEN 'supabase_oauth' THEN 'supabase'
      ELSE r.provider_key
    END
    WHERE r.tenant_id = ?
      AND COALESCE(r.is_enabled, 1) = 1
      AND lower(r.provider_key) IN (${placeholders})
    ORDER BY COALESCE(r.sort_order, c.sort_order, 50) ASC, r.display_name ASC`;
  const binds = [tenantId, ...keys.map((k) => String(k).toLowerCase())];
  const { results } = await db.prepare(sql).bind(...binds).all();
  return results || [];
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} providerKey
 */
export async function countToolsForProvider(db, providerKey) {
  if (!db) return { count: 0, preview: [] };
  const pk = String(providerKey || '').trim().toLowerCase();

  if (pk === 'inneranimalmedia-mcp-server' || pk === 'iam_mcp_platform' || pk === 'mcp_servers') {
    const r = await db
      .prepare(
        `SELECT tool_key, COALESCE(tool_name, tool_key) AS label, description
         FROM agentsam_tools
         WHERE COALESCE(is_active, 1) = 1 AND COALESCE(oauth_visible, 0) = 1
         ORDER BY COALESCE(tool_name, tool_key)
         LIMIT 120`,
      )
      .all()
      .catch(() => ({ results: [] }));
    const rows = r?.results || [];
    return {
      count: rows.length,
      preview: rows.slice(0, 8).map((row) => ({
        key: String(row.tool_key || ''),
        label: String(row.label || row.tool_key || ''),
        description: row.description ? String(row.description).slice(0, 160) : null,
      })),
    };
  }

  if (pk === 'web_search') {
    return {
      count: 1,
      preview: [{ key: 'search_web', label: 'Web search', description: 'Tavily open-web discovery' }],
    };
  }

  let where = `COALESCE(is_active, 1) = 1 AND (`;
  const binds = [];
  if (pk === 'github') {
    where += `tool_key LIKE 'agentsam_github%' OR tool_key LIKE 'github_%' OR lower(tool_category) = 'github'`;
  } else if (pk === 'cloudflare_oauth' || pk === 'cloudflare') {
    where += `tool_key LIKE 'agentsam_cf%' OR tool_key LIKE 'cloudflare_%' OR lower(tool_category) IN ('cloudflare', 'r2', 'storage')`;
  } else if (pk === 'google_drive') {
    where += `tool_key LIKE '%drive%' OR lower(tool_category) = 'integrations'`;
  } else if (pk === 'google_gmail' || pk === 'gmail') {
    where += `tool_key LIKE '%gmail%' OR tool_key LIKE '%mail%'`;
  } else if (pk === 'supabase_oauth' || pk === 'supabase') {
    where += `tool_key LIKE '%supabase%' OR tool_key LIKE 'agentsam_pg%'`;
  } else if (pk === 'stripe') {
    where += `tool_key LIKE 'stripe_%' OR lower(tool_category) = 'payment'`;
  } else {
    where += `lower(tool_category) = 'integrations'`;
  }
  where += ')';

  const r = await db
    .prepare(
      `SELECT tool_key, COALESCE(tool_name, tool_key) AS label, description
       FROM agentsam_tools WHERE ${where}
       ORDER BY COALESCE(tool_name, tool_key) LIMIT 120`,
    )
    .bind(...binds)
    .all()
    .catch(() => ({ results: [] }));
  const rows = r?.results || [];
  return {
    count: rows.length,
    preview: rows.slice(0, 8).map((row) => ({
      key: String(row.tool_key || ''),
      label: String(row.label || row.tool_key || ''),
      description: row.description ? String(row.description).slice(0, 160) : null,
    })),
  };
}

/**
 * @param {string} providerKey
 * @param {string} [returnTo]
 */
export function connectUrlForAgentHub(providerKey, returnTo = '/dashboard/agent') {
  const pk = String(providerKey || '').trim().toLowerCase();
  const rt = encodeURIComponent(returnTo);
  if (pk === 'github') return `/api/oauth/github/start?return_to=${rt}`;
  if (pk === 'google_drive') return `/api/oauth/google/start?connectDrive=1&return_to=${rt}`;
  if (pk === 'google_gmail' || pk === 'gmail') {
    return `/api/integrations/gmail/connect?return_to=${rt}`;
  }
  if (pk === 'cloudflare_oauth' || pk === 'cloudflare') {
    return `/api/oauth/cloudflare/start?return_to=${rt}`;
  }
  if (pk === 'supabase_oauth' || pk === 'supabase') {
    return `/api/oauth/supabase/start?return_to=${rt}`;
  }
  if (pk === 'mcp_servers') return `/dashboard/settings?section=integrations&focus=mcp_servers`;
  if (pk === 'stripe') return `/api/oauth/stripe/start?return_to=${rt}`;
  const slug = catalogSlugForRegistry(pk);
  return `/api/integrations/${encodeURIComponent(slug || pk)}/connect?return_to=${rt}`;
}

/**
 * @param {object} env
 * @param {object} authUser
 * @param {{ returnTo?: string, workspaceId?: string|null }} [opts]
 */
export async function loadAgentHubConnectorsCatalog(env, authUser, opts = {}) {
  const returnTo = opts.returnTo || '/dashboard/agent';
  const userId = await resolveIntegrationUserId(env, authUser);

  /** @type {import('@cloudflare/workers-types').D1Database|null} */
  const db = env?.DB || null;
  const tenantId = await resolveCatalogTenantId(env, authUser);
  const { tok, byok } = await loadTokenProviders(env, db, userId, tenantId);
  const registryKeys = AGENT_HUB_REGISTRY_KEYS.filter((k) => k !== 'gmail');
  const registryRows = tenantId
    ? await loadAgentHubRegistryRows(db, tenantId, registryKeys)
    : [];
  const rowByKey = new Map(
    registryRows.map((r) => [String(r.provider_key || '').toLowerCase(), r]),
  );

  /** @type {object[]} */
  const rows = [];

  for (const key of registryKeys) {
    const reg = rowByKey.get(key);
    if (!reg && key !== 'google_gmail') continue;
    const pk = key;
    const tile = reg
      ? mapConnectTileRow(reg, tok, byok, env)
      : {
          id: pk,
          provider_key: pk,
          connect_slug: catalogSlugForRegistry(pk),
          title: pk.replace(/_/g, ' '),
          icon_slug: catalogSlugForRegistry(pk),
          category: 'integrations',
          status: 'disconnected',
          connected: false,
          connect_url: connectUrlForAgentHub(pk, returnTo),
        };
    const tools = await countToolsForProvider(db, pk);
    rows.push({
      id: String(tile.id || pk),
      provider_key: pk,
      connect_slug: tile.connect_slug || catalogSlugForRegistry(pk),
      catalog_slug: tile.catalog_slug || catalogSlugForRegistry(pk),
      title: tile.title || pk,
      icon_slug: tile.icon_slug || catalogSlugForRegistry(pk),
      icon_url: resolveIntegrationIconUrl(
        pk,
        reg?.catalog_icon_url ?? null,
        tile.catalog_slug || catalogSlugForRegistry(pk),
        reg?.custom_icon_url ?? tile.custom_icon_url ?? null,
      ),
      category: tile.category || 'integrations',
      kind: connectorKindForProvider(pk),
      status: tile.status || 'disconnected',
      connected: !!tile.connected,
      issue: tile.issue || null,
      account_display: tile.account_display || null,
      tool_count: tools.count,
      tools_preview: tools.preview,
      connect_url: connectUrlForAgentHub(pk, returnTo),
      settings_path: '/dashboard/settings/integrations',
      oauth_scopes: [],
    });
  }

  const mcpTools = await countToolsForProvider(db, 'inneranimalmedia-mcp-server');
  rows.unshift({
    id: 'inneranimalmedia-mcp-server',
    provider_key: 'inneranimalmedia-mcp-server',
    connect_slug: 'inneranimalmedia-mcp',
    catalog_slug: 'mcp',
    title: 'inneranimalmedia-mcp-server',
    icon_slug: 'mcp',
    icon_url: resolveIntegrationIconUrl('inneranimalmedia-mcp-server', null, 'mcp'),
    category: 'mcp',
    kind: 'mcp_remote',
    status: 'connected',
    connected: true,
    issue: null,
    account_display: 'mcp.inneranimalmedia.com',
    tool_count: mcpTools.count,
    tools_preview: mcpTools.preview,
    connect_url: connectUrlForAgentHub('inneranimalmedia-mcp-server', returnTo),
    settings_path: '/dashboard/settings/integrations',
    oauth_scopes: [],
    note: 'Same OAuth tool catalog as Cursor, Claude, and ChatGPT MCP clients.',
  });
  rows.push({
    id: 'web_search',
    provider_key: 'web_search',
    connect_slug: 'web_search',
    catalog_slug: 'web_search',
    title: 'Web search',
    icon_slug: 'globe',
    category: 'capability',
    kind: 'capability',
    status: env?.TAVILY_API_KEY ? 'available' : 'disconnected',
    connected: !!env?.TAVILY_API_KEY,
    issue: env?.TAVILY_API_KEY ? null : 'warning',
    account_display: env?.TAVILY_API_KEY ? 'Tavily' : 'Platform key required',
    tool_count: 1,
    tools_preview: [{ key: 'search_web', label: 'search_web', description: 'Public web discovery via Tavily' }],
    connect_url: null,
    settings_path: '/dashboard/settings/integrations',
    oauth_scopes: [],
  });

  const deduped = [];
  const seen = new Set();
  for (const row of rows) {
    const k = String(row.provider_key || '').toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(row);
  }

  return {
    ok: true,
    connectors: deduped,
    connected_count: deduped.filter((c) => c.connected).length,
    workspace_id: opts.workspaceId || null,
    fresh_session_defaults: {
      exec_lane: 'remote',
      tool_access_mode: 'auto',
      enabled_connectors: [],
      assume_mac_local: false,
    },
    updated_at: new Date().toISOString(),
  };
}

/**
 * @param {Request} request
 * @param {object} env
 * @param {object} authUser
 */
export async function handleConnectorsCatalogApi(request, env, authUser) {
  if (!authUser) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  const url = new URL(request.url);
  const returnTo = url.searchParams.get('return_to') || '/dashboard/agent';
  const workspaceId = url.searchParams.get('workspace_id') || null;
  const catalog = await loadAgentHubConnectorsCatalog(env, authUser, { returnTo, workspaceId });
  return jsonResponse(catalog);
}

/**
 * @param {Request} request
 * @param {object} env
 * @param {object} authUser
 * @param {string} providerKey
 */
export async function handleConnectorToolsApi(request, env, authUser, providerKey) {
  if (!authUser) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  const pk = String(providerKey || '').trim().toLowerCase();
  const db = env?.DB;
  if (!db) return jsonResponse({ ok: false, error: 'db_unavailable' }, 503);

  let sql = `SELECT tool_key, COALESCE(tool_name, tool_key) AS label, description,
                    COALESCE(is_active, 1) AS enabled, COALESCE(oauth_visible, 0) AS oauth_visible
             FROM agentsam_tools WHERE COALESCE(is_active, 1) = 1`;
  if (pk === 'inneranimalmedia-mcp-server' || pk === 'mcp_servers') {
    sql += ' AND COALESCE(oauth_visible, 0) = 1';
  } else if (pk === 'github') {
    sql += ` AND (tool_key LIKE 'agentsam_github%' OR tool_key LIKE 'github_%')`;
  } else if (pk === 'cloudflare_oauth' || pk === 'cloudflare') {
    sql += ` AND (tool_key LIKE 'agentsam_cf%' OR tool_key LIKE 'cloudflare_%' OR lower(tool_category) IN ('cloudflare','r2','storage'))`;
  } else if (pk === 'google_drive') {
    sql += ` AND tool_key LIKE '%drive%'`;
  } else if (pk === 'google_gmail' || pk === 'gmail') {
    sql += ` AND (tool_key LIKE '%gmail%' OR tool_key LIKE '%mail%')`;
  } else if (pk === 'supabase_oauth' || pk === 'supabase') {
    sql += ` AND (tool_key LIKE '%supabase%' OR tool_key LIKE 'agentsam_pg%')`;
  } else if (pk === 'web_search') {
    return jsonResponse({
      ok: true,
      provider_key: pk,
      tools: [{ tool_key: 'search_web', label: 'Web search', description: 'Tavily', enabled: 1, oauth_visible: 0 }],
    });
  } else {
    sql += ` AND lower(tool_category) = 'integrations'`;
  }
  sql += ' ORDER BY COALESCE(tool_name, tool_key) LIMIT 200';

  const r = await db.prepare(sql).all().catch(() => ({ results: [] }));
  return jsonResponse({
    ok: true,
    provider_key: pk,
    tools: (r?.results || []).map((row) => ({
      tool_key: String(row.tool_key || ''),
      label: String(row.label || row.tool_key || ''),
      description: row.description ? String(row.description) : null,
      enabled: Number(row.enabled) === 1,
      oauth_visible: Number(row.oauth_visible) === 1,
    })),
  });
}
