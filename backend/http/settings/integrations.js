/**
 * Settings-scoped integration APIs: /api/settings/integrations/*
 */
import { jsonResponse } from '../agentsam/shared.js';
import { fetchAuthUserTenantId, fallbackSystemTenantId } from '../../identity/users/tenant.js';
import { handleIntegrationsRequest } from '../../../src/api/integrations.js';
import {
  upsertIntegrationByokKey,
  integrationSlugToByokProvider,
} from '../../../src/core/integration-byok-sync.js';
import { resolveCanonicalUserId } from '../../identity/users/canonical-id.js';
import { catalogSlugForRegistry, expandConnectedSlugs } from '../../../src/core/integration-slug-aliases.js';
import { listGmailTokenRowsForUser } from '../../../src/core/gmail-user-tokens.js';

function resolveTenantId(env, authUser) {
  if (authUser?.tenant_id && String(authUser.tenant_id).trim()) {
    return String(authUser.tenant_id).trim();
  }
  return null;
}

async function resolveTenantIdOrFetch(env, authUser) {
  let tid = resolveTenantId(env, authUser);
  if (tid) return tid;
  if (authUser?.id && env?.DB) {
    tid = await fetchAuthUserTenantId(env, authUser.id);
    if (tid) return tid;
  }
  if (env?.TENANT_ID) return String(env.TENANT_ID).trim();
  return fallbackSystemTenantId(env);
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function legacyMapForUser(DB, userEmail) {
  const map = new Map();
  if (!DB || !userEmail) return map;
  const candidates = [
    'SELECT LOWER(provider_key) AS k, is_connected, last_used FROM user_integrations WHERE LOWER(COALESCE(user_email, email, user_id)) = LOWER(?)',
    'SELECT LOWER(provider) AS k, is_connected, last_used FROM user_integrations WHERE LOWER(COALESCE(user_email, email, user_id)) = LOWER(?)',
  ];
  for (const sql of candidates) {
    try {
      const { results } = await DB.prepare(sql).bind(userEmail).all();
      for (const r of results || []) {
        if (r?.k) map.set(String(r.k), r);
      }
      if (map.size) return map;
    } catch {
      /* try next */
    }
  }
  return map;
}

async function getConnectedIntegrations(env, authUser) {
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const tenantId = await resolveTenantIdOrFetch(env, authUser);
  const email = String(authUser.email || authUser.id || '').trim();

  let rows = [];
  try {
    const res = await env.DB.prepare(
      `SELECT r.*,
              c.id AS catalog_row_id,
              c.name AS catalog_name,
              c.slug AS catalog_slug,
              c.category AS catalog_category,
              c.auth_type AS catalog_auth_type,
              c.oauth_authorize_url,
              c.oauth_scopes_default,
              c.oauth_scopes_available,
              c.api_key_label,
              c.api_key_placeholder,
              c.docs_url,
              c.icon_slug,
              c.icon_url,
              c.description AS catalog_description,
              c.sort_order AS catalog_sort_order,
              c.is_active AS catalog_is_active
       FROM integration_registry r
       LEFT JOIN integration_catalog c ON c.slug = CASE r.provider_key
         WHEN 'cloudflare_oauth' THEN 'cloudflare'
         WHEN 'supabase_oauth' THEN 'supabase'
         ELSE r.provider_key
       END
       WHERE r.tenant_id = ?
         AND COALESCE(r.is_enabled, 1) = 1
       ORDER BY COALESCE(r.sort_order, 50) ASC, r.display_name ASC`,
    )
      .bind(tenantId)
      .all();
    rows = res?.results || [];
  } catch (e) {
    console.warn('[settings-integrations] connected query failed', e?.message || e);
    return jsonResponse({ error: e?.message ?? String(e), items: [] }, 500);
  }

  const legacy = await legacyMapForUser(env.DB, email);
  const userId = await resolveCanonicalUserId(String(authUser?.id || '').trim(), env);
  const tokProviders = new Set();
  const byokProviders = new Set();
  /** @type {{ present: boolean, accountId: string|null, display: string|null, expired: boolean, invalidIdentifier: boolean }|null} */
  let cfOauthHealth = null;
  if (userId && env.DB) {
    const tokenUserKeys = [userId];
    if (email && email.toLowerCase() !== userId.toLowerCase()) tokenUserKeys.push(email);
    for (const key of tokenUserKeys) {
      try {
        const tr = await env.DB.prepare(
          `SELECT DISTINCT lower(provider) AS p FROM user_oauth_tokens WHERE user_id = ?`,
        )
          .bind(key)
          .all();
        for (const r of tr.results || []) {
          if (r?.p) tokProviders.add(String(r.p).toLowerCase());
        }
      } catch {
        /* ignore */
      }
    }
    try {
      const { looksLikeCfAccountId } = await import('../../../src/core/cf-token-account.js');
      const oauthCf = await env.DB.prepare(
        `SELECT account_identifier, account_display, metadata_json, expires_at, updated_at
         FROM user_oauth_tokens
         WHERE user_id = ? AND lower(provider) = 'cloudflare'
         ORDER BY updated_at DESC LIMIT 1`,
      )
        .bind(userId)
        .first();
      if (oauthCf) {
        const nowSec = Math.floor(Date.now() / 1000);
        const exp = oauthCf.expires_at != null ? Number(oauthCf.expires_at) : null;
        const expired = Number.isFinite(exp) && exp > 0 && exp < nowSec;
        let accountId = null;
        const fromTok = String(oauthCf.account_identifier || '').trim();
        if (looksLikeCfAccountId(fromTok)) accountId = fromTok;
        if (!accountId && oauthCf.metadata_json) {
          try {
            const meta = JSON.parse(String(oauthCf.metadata_json));
            const mid = String(meta?.cloudflare_account_id || meta?.account_id || '').trim();
            if (looksLikeCfAccountId(mid)) accountId = mid;
          } catch {
            /* ignore */
          }
        }
        cfOauthHealth = {
          present: true,
          accountId,
          display: oauthCf.account_display != null ? String(oauthCf.account_display) : null,
          expired,
          invalidIdentifier: !accountId,
        };
      } else {
        cfOauthHealth = {
          present: false,
          accountId: null,
          display: null,
          expired: false,
          invalidIdentifier: false,
        };
      }
    } catch {
      /* ignore */
    }
    try {
      const tenantIdForKeys = await resolveTenantIdOrFetch(env, authUser);
      const { listConfiguredByokProviderSlugs } = await import(
        '../../credentials/user-secret-store.js'
      );
      for (const p of await listConfiguredByokProviderSlugs(env, {
        userId,
        tenantId: tenantIdForKeys,
      })) {
        byokProviders.add(p);
        if (p === 'google') byokProviders.add('google_ai');
      }
    } catch {
      /* ignore */
    }
  }
  const items = rows.map((row) => {
    const slug = String(row.provider_key || '').toLowerCase();
    const leg = legacy.get(slug) || legacy.get(String(row.catalog_slug || '').toLowerCase());
    const catalog =
      row.catalog_row_id || row.catalog_slug
        ? {
            id: row.catalog_row_id,
            name: row.catalog_name || row.display_name,
            slug: row.catalog_slug || catalogSlugForRegistry(row.provider_key),
            category: row.catalog_category || row.category,
            auth_type: row.catalog_auth_type || row.auth_type,
            oauth_authorize_url: row.oauth_authorize_url,
            oauth_scopes_default: parseJson(row.oauth_scopes_default, []),
            oauth_scopes_available: parseJson(row.oauth_scopes_available, []),
            api_key_label: row.api_key_label,
            api_key_placeholder: row.api_key_placeholder,
            docs_url: row.docs_url,
            icon_slug: row.icon_slug,
            icon_url: row.icon_url,
            description: row.catalog_description,
            sort_order: row.catalog_sort_order,
            is_active: row.catalog_is_active,
          }
        : null;

    const cfg = parseJson(row.config_json, {});
    const connection = {
      id: row.id,
      tenant_id: row.tenant_id,
      provider_key: row.provider_key,
      display_name: row.display_name,
      category: row.category,
      auth_type: row.auth_type,
      status: row.status,
      scopes_json: parseJson(row.scopes_json, []),
      config_json: cfg,
      account_display: row.account_display,
      secret_binding_name: row.secret_binding_name,
      last_sync_at: row.last_sync_at,
      last_health_check_at: row.last_health_check_at,
      last_health_latency_ms: row.last_health_latency_ms,
      last_health_status: row.last_health_status,
      is_enabled: row.is_enabled,
      sort_order: row.sort_order,
      updated_at: row.updated_at,
    };

    const pk = slug;
    let derived_status = String(row.status || 'disconnected').toLowerCase();
    if (pk === 'supabase_oauth' && (tokProviders.has('supabase_management') || tokProviders.has('supabase'))) {
      derived_status = 'connected';
    } else if (pk === 'github' && tokProviders.has('github')) {
      derived_status = 'connected';
    } else if (pk === 'google_drive' && tokProviders.has('google_drive')) {
      derived_status = 'connected';
    } else if (
      (pk === 'google_gmail' || pk === 'gmail') &&
      (tokProviders.has('google_gmail') || tokProviders.has('gmail'))
    ) {
      derived_status = 'connected';
    } else if (pk === 'cloudflare_oauth' && tokProviders.has('cloudflare')) {
      // Row present is not enough: expired tokens / "Cloudflare" app-name identifiers need reconnect.
      if (cfOauthHealth?.expired || cfOauthHealth?.invalidIdentifier) {
        derived_status = 'auth_expired';
      } else {
        derived_status = 'connected';
      }
    } else if (['anthropic', 'openai', 'resend', 'google_ai', 'cursor'].includes(pk)) {
      const byokSlug = integrationSlugToByokProvider(pk);
      if (
        tokProviders.has(pk) ||
        byokProviders.has(pk) ||
        (byokSlug && byokProviders.has(byokSlug))
      ) {
        derived_status = 'connected';
      }
    } else if (pk === 'cloudflare_r2' && env.R2) {
      derived_status = 'available';
    } else if (pk === 'mcp_servers') {
      derived_status = tokProviders.size > 0 ? derived_status : 'available';
    } else if (pk === 'local_tunnel' && String(row.status || '').toLowerCase() === 'connected') {
      derived_status = 'connected';
    }

    const regStatus = String(row.status || '').toLowerCase();
    let integrationError;
    if (regStatus === 'auth_expired' || derived_status === 'auth_expired') {
      integrationError = 'token_expired';
    } else if (pk === 'local_tunnel' && regStatus === 'degraded') {
      integrationError = 'tunnel_unreachable';
    }

    const lastVerified =
      typeof cfg.last_verified_at === 'number' && Number.isFinite(cfg.last_verified_at)
        ? cfg.last_verified_at < 1e12
          ? cfg.last_verified_at * 1000
          : cfg.last_verified_at
        : undefined;

    let lastVerifiedMs = lastVerified;
    if (pk === 'local_tunnel' && row.last_health_check_at) {
      const healthMs = Date.parse(String(row.last_health_check_at));
      if (Number.isFinite(healthMs)) {
        lastVerifiedMs = Math.max(lastVerifiedMs ?? 0, healthMs) || undefined;
      }
    }

    const integration_status = {
      connected: derived_status === 'connected',
      slug: pk,
      account_display: row.account_display ? String(row.account_display) : undefined,
      last_verified_at: lastVerifiedMs,
      error: integrationError,
    };

    return {
      catalog,
      connection: { ...connection, status: derived_status },
      integration_status,
      legacy: leg
        ? { is_connected: leg.is_connected, last_used: leg.last_used }
        : null,
      derived_status,
      iam_hosted:
        String(row.catalog_category || '').toLowerCase() === 'iam_hosted' ||
        ['agentsam', 'autodidact'].includes(slug),
    };
  });

  const gmailTemplateRow =
    rows.find((r) => String(r.provider_key || '').toLowerCase() === 'google_gmail') ||
    rows.find((r) => String(r.catalog_slug || '').toLowerCase() === 'gmail');
  const gmailTokens = userId ? await listGmailTokenRowsForUser(env, authUser) : [];
  const withoutGmailRegistry = items.filter((item) => {
    const pk = String(item.connection?.provider_key || '').toLowerCase();
    return pk !== 'google_gmail' && pk !== 'gmail';
  });

  for (const tok of gmailTokens) {
    const acct = String(tok.account_identifier || '').trim();
    if (!acct) continue;
    const catalog =
      gmailTemplateRow?.catalog_row_id || gmailTemplateRow?.catalog_slug
        ? {
            id: gmailTemplateRow.catalog_row_id,
            name: gmailTemplateRow.catalog_name || 'Gmail',
            slug: gmailTemplateRow.catalog_slug || 'gmail',
            category: gmailTemplateRow.catalog_category || 'communication',
            auth_type: gmailTemplateRow.catalog_auth_type || 'oauth',
            oauth_authorize_url: gmailTemplateRow.oauth_authorize_url,
            oauth_scopes_default: parseJson(gmailTemplateRow.oauth_scopes_default, []),
            oauth_scopes_available: parseJson(gmailTemplateRow.oauth_scopes_available, []),
            api_key_label: gmailTemplateRow.api_key_label,
            api_key_placeholder: gmailTemplateRow.api_key_placeholder,
            docs_url: gmailTemplateRow.docs_url,
            icon_slug: gmailTemplateRow.icon_slug || 'gmail',
            icon_url: gmailTemplateRow.icon_url,
            description: gmailTemplateRow.catalog_description,
            sort_order: gmailTemplateRow.catalog_sort_order,
            is_active: gmailTemplateRow.catalog_is_active,
          }
        : {
            name: 'Gmail',
            slug: 'gmail',
            category: 'communication',
            auth_type: 'oauth',
            icon_slug: 'gmail',
          };
    withoutGmailRegistry.push({
      catalog,
      connection: {
        id: `gmail_acct_${acct.replace(/[^a-z0-9@._-]+/gi, '_')}`,
        tenant_id: tenantId,
        provider_key: 'google_gmail',
        display_name: 'Gmail',
        category: 'communication',
        auth_type: 'oauth',
        status: 'connected',
        scopes_json: tok.scope ? String(tok.scope).split(/\s+/).filter(Boolean) : [],
        config_json: {},
        account_display: acct,
        secret_binding_name: null,
        last_sync_at: tok.updated_at || null,
        last_health_check_at: null,
        last_health_latency_ms: null,
        last_health_status: null,
        is_enabled: 1,
        sort_order: gmailTemplateRow?.sort_order ?? 25,
        updated_at: tok.updated_at || null,
      },
      integration_status: {
        connected: true,
        slug: 'google_gmail',
        account_display: acct,
        last_verified_at: tok.updated_at
          ? (Number(tok.updated_at) < 1e12 ? Number(tok.updated_at) * 1000 : Number(tok.updated_at))
          : undefined,
      },
      legacy: null,
      derived_status: 'connected',
      iam_hosted: false,
    });
  }

  const finalItems = withoutGmailRegistry;

  // Enrich Cloudflare with real CF account id (hex) — not au_* and not display name.
  if (userId && env.DB) {
    try {
      const { looksLikeCfAccountId } = await import('../../../src/core/cf-token-account.js');
      const { readUserCfStackSettings } = await import(
        '../../../src/core/account-cloudflare-context.js',
      );
      const stack = await readUserCfStackSettings(env, userId);
      let cfAccountId = cfOauthHealth?.accountId || null;
      const fromSettings = String(stack?.cf_account_id || '').trim();
      if (!cfAccountId && looksLikeCfAccountId(fromSettings)) cfAccountId = fromSettings;

      for (const item of finalItems) {
        const pk = String(item.connection?.provider_key || '').toLowerCase();
        if (pk !== 'cloudflare_oauth' && pk !== 'cloudflare') continue;
        item.connection = {
          ...item.connection,
          account_identifier: cfAccountId || item.connection?.account_identifier || null,
          cloudflare_account_id: cfAccountId,
          account_display:
            item.connection?.account_display ||
            cfOauthHealth?.display ||
            (cfAccountId ? 'Cloudflare account' : null),
        };
        if (item.integration_status && typeof item.integration_status === 'object') {
          item.integration_status = {
            ...item.integration_status,
            cloudflare_account_id: cfAccountId,
            oauth_token_present: Boolean(cfOauthHealth?.present),
            reconnect_required: Boolean(
              cfOauthHealth?.expired || cfOauthHealth?.invalidIdentifier,
            ),
          };
        }
      }
    } catch (e) {
      console.warn('[settings-integrations] cf account enrich failed', e?.message || e);
    }
  }

  return jsonResponse({
    tenant_id: tenantId,
    items: finalItems,
    connected_slugs: expandConnectedSlugs(
      finalItems
        .filter((i) => i.integration_status?.connected)
        .map((i) => String(i.connection?.provider_key || '').toLowerCase())
        .filter(Boolean),
    ),
  });
}

async function pingCustomEndpoint(endpointUrl, bearerToken) {
  const base = endpointUrl.replace(/\/$/, '');
  const candidates = [`${base}/health`, `${base}/`, base];
  const headers = { Accept: 'application/json, text/plain, */*' };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  let lastErr = 'Unreachable';
  for (const url of candidates) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal }).finally(() => clearTimeout(t));
      if (res.ok || res.status === 401 || res.status === 405) {
        return { ok: true, status: res.status, url };
      }
      lastErr = `${res.status} ${res.statusText}`;
    } catch (e) {
      lastErr = e?.message || String(e);
    }
  }
  return { ok: false, error: lastErr };
}

async function saveCustomMcp(env, authUser, request) {
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const display_name = String(body.display_name || '').trim();
  let endpoint_url = String(body.endpoint_url || '').trim();
  const auth_type = String(body.auth_type || 'none').toLowerCase();
  const bearer_token = String(body.bearer_token || '').trim();

  if (!display_name) return jsonResponse({ error: 'display_name required' }, 400);
  if (!endpoint_url.startsWith('https://')) {
    return jsonResponse({ error: 'endpoint_url must start with https://' }, 400);
  }
  if (auth_type === 'bearer' && !bearer_token) {
    return jsonResponse({ error: 'bearer_token required for bearer auth' }, 400);
  }

  const ping = await pingCustomEndpoint(endpoint_url, auth_type === 'bearer' ? bearer_token : '');
  if (!ping.ok) {
    return jsonResponse({ error: `Endpoint did not respond: ${ping.error}` }, 400);
  }

  const tenantId = await resolveTenantIdOrFetch(env, authUser);
  const slug = `custom_mcp_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const mcpId = `mcp_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

  try {
    await env.DB.prepare(
      `INSERT INTO mcp_services (id, service_name, endpoint_url, service_type, is_active, health_status)
       VALUES (?, ?, ?, 'custom_mcp', 1, 'unverified')`,
    )
      .bind(mcpId, display_name, endpoint_url)
      .run();
  } catch (e) {
    console.warn('[settings-integrations] mcp_services insert', e?.message || e);
    return jsonResponse({ error: 'Could not save MCP service' }, 500);
  }

  if (auth_type === 'bearer' && bearer_token) {
    const userId = await resolveCanonicalUserId(String(authUser?.id || '').trim(), env);
    if (!userId) return jsonResponse({ error: 'User id required' }, 400);
    try {
      await upsertIntegrationByokKey(env, authUser, slug, bearer_token, {
        validate: false,
        allowUnknownSlug: true,
        label: `${display_name} bearer`,
        triggeredBy: 'custom_mcp',
        source: 'custom_mcp',
      });
    } catch (e) {
      console.warn('[settings-integrations] BYOK bearer save', e?.message || e);
      return jsonResponse({ error: 'Could not save bearer token' }, 500);
    }
  }

  const rid = `int_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  try {
    await env.DB.prepare(
      `INSERT INTO integration_registry
        (id, tenant_id, provider_key, display_name, category, auth_type, status, scopes_json, config_json, account_display, sort_order, updated_at)
       VALUES (?, ?, ?, ?, 'other', ?, 'connected', '[]', ?, ?, 200, datetime('now'))
       ON CONFLICT(tenant_id, provider_key) DO UPDATE SET
         display_name = excluded.display_name,
         auth_type = excluded.auth_type,
         status = 'connected',
         config_json = excluded.config_json,
         account_display = excluded.account_display,
         updated_at = datetime('now')`,
    )
      .bind(
        rid,
        tenantId,
        slug,
        display_name,
        auth_type === 'oauth' ? 'oauth2' : auth_type === 'bearer' ? 'api_key' : 'none',
        JSON.stringify({ mcp_service_id: mcpId, endpoint_url, auth_type }),
        display_name,
      )
      .run();
  } catch (e) {
    console.warn('[settings-integrations] integration_registry insert', e?.message || e);
    return jsonResponse({ error: 'Could not save integration registry row' }, 500);
  }

  return jsonResponse({
    ok: true,
    provider_key: slug,
    mcp_service_id: mcpId,
  });
}

async function listCustomMcp(env, authUser) {
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const tenantId = await resolveTenantIdOrFetch(env, authUser);
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, provider_key, display_name, status, config_json, account_display, updated_at
       FROM integration_registry
       WHERE tenant_id = ?
         AND provider_key LIKE 'custom_mcp_%'
       ORDER BY updated_at DESC`,
    )
      .bind(tenantId)
      .all();
    return jsonResponse({ items: results || [] });
  } catch (e) {
    return jsonResponse({ error: e?.message ?? String(e), items: [] }, 500);
  }
}

/**
 * @returns {Promise<Response|null>}
 */
export async function handleSettingsIntegrationsRoutes(request, env, ctx, authUser, url, pathLower, method) {
  if (!pathLower.startsWith('/api/settings/integrations')) return null;

  if (pathLower === '/api/settings/integrations/connected' && method === 'GET') {
    return getConnectedIntegrations(env, authUser);
  }

  const testMatch = pathLower.match(/^\/api\/settings\/integrations\/([^/]+)\/test$/);
  if (testMatch && method === 'POST') {
    const slug = decodeURIComponent(testMatch[1] || '').trim();
    if (!slug) return jsonResponse({ error: 'slug required' }, 400);
    const innerUrl = new URL(request.url);
    innerUrl.pathname = `/api/integrations/${encodeURIComponent(slug)}/test`;
    const inner = new Request(innerUrl.toString(), {
      method: 'POST',
      headers: request.headers,
    });
    return handleIntegrationsRequest(inner, env, ctx, authUser);
  }

  if (pathLower === '/api/settings/integrations/custom-mcp' && method === 'POST') {
    return saveCustomMcp(env, authUser, request);
  }

  if (pathLower === '/api/settings/integrations/custom' && method === 'GET') {
    return listCustomMcp(env, authUser);
  }

  return null;
}
