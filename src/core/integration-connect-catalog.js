/**
 * Catalog-driven integration connect spine.
 * integration_catalog is source of truth for available apps; registry holds per-tenant state.
 */
import { resolveIntegrationIconUrl } from './integration-brand-avatars.js';
import { registrySlugForCatalog } from './integration-slug-aliases.js';
import { MCP_CANONICAL_CLIENT_ID } from '../api/mcp-oauth-shared.js';

const MCP_OAUTH_BASE =
  `https://mcp.inneranimalmedia.com/api/oauth/authorize?client_id=${MCP_CANONICAL_CLIENT_ID}`;

function normalizeSlug(slug) {
  return String(slug || '')
    .trim()
    .toLowerCase();
}

function slugNorm(slug) {
  return normalizeSlug(slug).replace(/-/g, '_');
}

/** Catalog slug → token provider keys checked for "connected". */
export function providerKeysForCatalogSlug(catalogSlug) {
  const s = slugNorm(catalogSlug);
  const aliases = {
    cloudflare: ['cloudflare', 'cloudflare_oauth'],
    supabase: ['supabase', 'supabase_oauth', 'supabase_management'],
    google_drive: ['google_drive'],
    gmail: ['gmail', 'google_gmail'],
    google_calendar: ['google_calendar'],
    google_ai: ['google_ai', 'google'],
    github: ['github'],
    anthropic: ['anthropic'],
    openai: ['openai'],
    resend: ['resend'],
    cursor: ['cursor'],
    stripe: ['stripe'],
    mcp: ['inneranimalmedia-mcp-server', 'mcp_servers'],
    custom_mcp: ['mcp_servers'],
    agentsam: ['agentsam'],
    autodidact: ['autodidact'],
  };
  if (aliases[s]) return aliases[s];
  const registry = registrySlugForCatalog(s);
  return [s, registry, registry.replace(/_/g, '-')];
}

export function isCatalogConnectable(catalogRow) {
  if (!catalogRow) return false;
  if (Number(catalogRow.is_active) === 0) return false;
  const authType = String(catalogRow.auth_type || '').toLowerCase();
  const category = String(catalogRow.category || '').toLowerCase();
  if (category === 'iam_hosted' && authType === 'none') return false;
  return true;
}

/**
 * @param {object} catalogRow
 * @param {string} [returnTo]
 */
export function buildCatalogConnectUrl(catalogRow, returnTo = '/dashboard/home') {
  if (!isCatalogConnectable(catalogRow)) return null;
  const slug = String(catalogRow.slug || '').trim();
  const s = slugNorm(slug);
  const authType = String(catalogRow.auth_type || '').toLowerCase();
  const rt = encodeURIComponent(returnTo);

  if (s === 'gmail' || s === 'google_gmail') {
    return `/api/integrations/gmail/connect?return_to=${rt}`;
  }
  if (
    s === 'mcp' ||
    s === 'custom_mcp' ||
    s === 'inneranimalmedia_mcp' ||
    slug === 'inneranimalmedia-mcp'
  ) {
    return `${MCP_OAUTH_BASE}&return_to=${rt}`;
  }

  if (authType === 'api_key') return null;

  return `/api/integrations/${encodeURIComponent(slug)}/connect?return_to=${rt}`;
}

export function deriveCatalogConnected(catalogRow, tok, byok, env, registryRow) {
  const keys = providerKeysForCatalogSlug(catalogRow?.slug);
  for (const k of keys) {
    const pk = String(k || '').toLowerCase();
    if (tok.has(pk) || byok.has(pk)) return 'connected';
  }
  const s = slugNorm(catalogRow?.slug);
  if (s === 'cloudflare' && tok.has('cloudflare')) return 'connected';
  if (s === 'supabase' && (tok.has('supabase') || tok.has('supabase_management'))) return 'connected';
  if (s === 'google_drive' && tok.has('google_drive')) return 'connected';
  if (s === 'gmail' && (tok.has('gmail') || tok.has('google_gmail'))) return 'connected';
  if (s === 'google_ai' && (tok.has('google_ai') || byok.has('google_ai') || byok.has('google'))) {
    return 'connected';
  }
  if (s === 'github' && tok.has('github')) return 'connected';
  if (['anthropic', 'openai', 'resend', 'cursor'].includes(s)) {
    if (tok.has(s) || byok.has(s)) return 'connected';
  }
  if (s === 'cloudflare_r2' && env?.R2) return 'available';
  const regStatus = String(registryRow?.status || '').toLowerCase();
  if (regStatus === 'connected' || regStatus === 'available') return regStatus;
  return 'disconnected';
}

/**
 * @param {object} catalogRow
 * @param {object|null} registryRow
 * @param {Set<string>} tok
 * @param {Set<string>} byok
 * @param {object} env
 * @param {string} [returnTo]
 */
export function mapCatalogConnectOption(catalogRow, registryRow, tok, byok, env, returnTo) {
  const slug = String(catalogRow.slug || '').trim();
  const providerKey = registryRow?.provider_key
    ? String(registryRow.provider_key)
    : registrySlugForCatalog(slug);
  const status = deriveCatalogConnected(catalogRow, tok, byok, env, registryRow);
  const connected = status === 'connected' || status === 'available';
  const authType = String(catalogRow.auth_type || 'oauth').toLowerCase();

  return {
    id: String(catalogRow.id || slug),
    provider_key: providerKey,
    connect_slug: slug,
    catalog_slug: slug,
    title: String(catalogRow.name || slug),
    icon_slug: String(catalogRow.icon_slug || slug),
    icon_url: resolveIntegrationIconUrl(
      providerKey,
      catalogRow.icon_url,
      slug,
      registryRow?.custom_icon_url,
    ),
    custom_icon_url: registryRow?.custom_icon_url ? String(registryRow.custom_icon_url) : null,
    category: String(catalogRow.category || 'integrations'),
    auth_type: authType,
    status,
    connected,
    connectable: isCatalogConnectable(catalogRow),
    connect_url: buildCatalogConnectUrl(catalogRow, returnTo),
    api_key_label: catalogRow.api_key_label ? String(catalogRow.api_key_label) : null,
    description: catalogRow.description ? String(catalogRow.description) : null,
    sort_order: Number(catalogRow.sort_order) || 50,
    settings_path: '/dashboard/settings/integrations',
  };
}

/**
 * @param {object} env
 * @param {object} authUser
 * @param {{ returnTo?: string }} [opts]
 */
export async function loadIntegrationConnectCatalog(env, authUser, opts = {}) {
  if (!env?.DB) return { connected: [], available: [] };
  const returnTo = opts.returnTo || '/dashboard/home';

  const { resolveIntegrationUserId } = await import('../../backend/identity/oauth/integration-user-id.js');
  const { fetchAuthUserTenantId, fallbackSystemTenantId } = await import('./auth.js');

  let tenantId = authUser?.tenant_id ? String(authUser.tenant_id).trim() : '';
  if (!tenantId && authUser?.id) {
    tenantId = (await fetchAuthUserTenantId(env, authUser.id)) || '';
  }
  if (!tenantId) tenantId = env.TENANT_ID ? String(env.TENANT_ID).trim() : fallbackSystemTenantId(env);

  const userId = await resolveIntegrationUserId(env, authUser);
  const tok = new Set();
  const byok = new Set();

  if (userId) {
    try {
      const tr = await env.DB.prepare(
        `SELECT DISTINCT lower(provider) AS p FROM user_oauth_tokens WHERE user_id = ?`,
      )
        .bind(userId)
        .all();
      for (const r of tr.results || []) {
        if (r?.p) tok.add(String(r.p).toLowerCase());
      }
    } catch {
      /* */
    }
    try {
      const { listConfiguredByokProviderSlugs } = await import(
        '../../backend/credentials/user-secret-store.js'
      );
      for (const p of await listConfiguredByokProviderSlugs(env, { userId, tenantId })) {
        byok.add(p);
        if (p === 'google') byok.add('google_ai');
      }
    } catch {
      /* */
    }
  }

  let catalogRows = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM integration_catalog
       WHERE COALESCE(is_active, 1) = 1
       ORDER BY COALESCE(sort_order, 999) ASC, name ASC`,
    ).all();
    catalogRows = results || [];
  } catch {
    catalogRows = [];
  }

  let registryRows = [];
  if (tenantId) {
    try {
      const { results } = await env.DB.prepare(
        `SELECT * FROM integration_registry WHERE tenant_id = ?`,
      )
        .bind(tenantId)
        .all();
      registryRows = results || [];
    } catch {
      registryRows = [];
    }
  }

  const regByProvider = new Map(
    registryRows.map((r) => [String(r.provider_key || '').toLowerCase(), r]),
  );
  const regByCatalog = new Map();
  for (const r of registryRows) {
    const pk = String(r.provider_key || '').toLowerCase();
    regByCatalog.set(pk, r);
    const cat = registrySlugForCatalog(pk);
    if (cat !== pk) regByCatalog.set(cat, r);
  }

  const connected = [];
  const available = [];

  for (const cat of catalogRows) {
    const slug = String(cat.slug || '').trim();
    const keys = providerKeysForCatalogSlug(slug);
    let registryRow = null;
    for (const k of keys) {
      registryRow = regByProvider.get(String(k).toLowerCase()) || regByCatalog.get(String(k).toLowerCase());
      if (registryRow) break;
    }
    const option = mapCatalogConnectOption(cat, registryRow, tok, byok, env, returnTo);
    if (!option.connectable && !option.connected) continue;
    if (option.connected) connected.push(option);
    else if (option.connectable) available.push(option);
  }

  return { connected, available, updated_at: new Date().toISOString() };
}
