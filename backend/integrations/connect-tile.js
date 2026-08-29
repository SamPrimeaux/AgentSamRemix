import { catalogSlugForRegistry } from './slug-aliases.js';
import { resolveIntegrationIconUrl } from './brand-avatars.js';

function connectSlugForProvider(providerKey) {
  const pk = String(providerKey || '').toLowerCase();
  if (pk === 'cloudflare_oauth') return 'cloudflare';
  if (pk === 'supabase_oauth') return 'supabase';
  return pk;
}

function connectPathForSlug(slug) {
  const s = String(slug || '').toLowerCase();
  if (s === 'cloudflare') return '/api/integrations/cloudflare/connect';
  if (s === 'github') return '/api/integrations/github/connect';
  if (s === 'google_drive') return '/api/integrations/google_drive/connect';
  if (s === 'supabase') return '/api/integrations/supabase/connect';
  return `/api/integrations/${encodeURIComponent(s)}/connect`;
}

function deriveConnected(providerKey, rowStatus, tok, byok, env) {
  const pk = String(providerKey || '').toLowerCase();
  let status = String(rowStatus || 'disconnected').toLowerCase();
  if (pk === 'supabase_oauth' && (tok.has('supabase_management') || tok.has('supabase'))) {
    status = 'connected';
  } else if (pk === 'github' && tok.has('github')) status = 'connected';
  else if (pk === 'google_drive' && tok.has('google_drive')) status = 'connected';
  else if (pk === 'cloudflare_oauth' && tok.has('cloudflare')) status = 'connected';
  else if (['anthropic', 'openai', 'resend', 'google_ai', 'cursor'].includes(pk)) {
    if (tok.has(pk) || byok.has(pk)) status = 'connected';
  } else if (pk === 'cloudflare_r2' && env?.R2) status = 'available';
  else if (pk === 'local_tunnel' && status === 'connected') status = 'connected';
  return status;
}

/**
 * @param {Record<string, unknown>} row
 * @param {Set<string>} tok
 * @param {Set<string>} byok
 * @param {Record<string, unknown>} env
 */
export function mapConnectTileRow(row, tok, byok, env) {
  const providerKey = String(row.provider_key || '');
  const slug = connectSlugForProvider(providerKey);
  const status = deriveConnected(providerKey, row.status, tok, byok, env);
  const connected = status === 'connected' || status === 'available';
  let issue = null;
  const regStatus = String(row.status || '').toLowerCase();
  if (regStatus === 'auth_expired') issue = 'error';
  else if (String(providerKey).toLowerCase() === 'local_tunnel' && regStatus === 'degraded') {
    issue = 'warning';
  }

  return {
    id: String(row.id || providerKey),
    provider_key: providerKey,
    connect_slug: slug,
    catalog_slug: row.catalog_slug || catalogSlugForRegistry(providerKey),
    title: String(row.display_name || row.catalog_name || providerKey),
    icon_slug: row.icon_slug || catalogSlugForRegistry(providerKey),
    icon_url: resolveIntegrationIconUrl(
      providerKey,
      row.catalog_icon_url,
      row.catalog_slug || catalogSlugForRegistry(providerKey),
      row.custom_icon_url,
    ),
    custom_icon_url: row.custom_icon_url ? String(row.custom_icon_url) : null,
    icon_scale: (() => {
      const v = Number(row.icon_scale);
      return Number.isFinite(v) ? Math.min(1.2, Math.max(0.5, v)) : 1;
    })(),
    icon_bg: row.icon_bg != null && String(row.icon_bg).trim() ? String(row.icon_bg).trim() : null,
    category: row.catalog_category || row.category || 'other',
    auth_type: row.catalog_auth_type || row.auth_type || 'oauth2',
    status,
    connected,
    issue,
    account_display: row.account_display ? String(row.account_display) : null,
    sort_order: Number(row.sort_order ?? row.catalog_sort_order) || 50,
    connect_url: connectPathForSlug(slug),
    settings_path: '/dashboard/settings/integrations',
    show_on_home: Number(row.show_on_home) === 1,
    show_on_workspace: Number(row.show_on_workspace) === 1,
  };
}
