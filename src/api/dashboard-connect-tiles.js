/**
 * Unified connect tiles for /dashboard/home and /dashboard/settings/workspace.
 * Reads integration_registry + integration_catalog; derives live OAuth status from tokens.
 */
import { jsonResponse, fetchAuthUserTenantId, fallbackSystemTenantId } from '../core/auth.js';
import { resolveIntegrationUserId } from '../../backend/identity/oauth/integration-user-id.js';
import { loadIntegrationConnectCatalog } from '../core/integration-connect-catalog.js';
import { mapConnectTileRow } from '../../backend/integrations/connect-tile.js';

export { mapConnectTileRow } from '../../backend/integrations/connect-tile.js';

async function resolveTenantIdOrFetch(env, authUser) {
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

async function loadRegistryRows(db, tenantId, surface) {
  const flagCol = surface === 'workspace' ? 'show_on_workspace' : 'show_on_home';
  const sqlWithFlags = `
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
      AND COALESCE(r.${flagCol}, 0) = 1
    ORDER BY COALESCE(r.sort_order, c.sort_order, 50) ASC, r.display_name ASC`;

  const sqlFallback = `
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
      AND lower(r.provider_key) IN (
        'github', 'cloudflare_oauth', 'google_drive', 'supabase_oauth',
        'openai', 'anthropic', 'resend', 'cloudflare_r2', 'local_tunnel', 'google_ai'
      )
    ORDER BY COALESCE(r.sort_order, c.sort_order, 50) ASC, r.display_name ASC`;

  try {
    const { results } = await db.prepare(sqlWithFlags).bind(tenantId).all();
    return results || [];
  } catch {
    const { results } = await db.prepare(sqlFallback).bind(tenantId).all();
    let rows = results || [];
    if (surface === 'home') {
      rows = rows.filter((r) =>
        ['github', 'cloudflare_oauth', 'google_drive', 'supabase_oauth'].includes(
          String(r.provider_key || '').toLowerCase(),
        ),
      );
    }
    return rows;
  }
}

async function tokenProviders(db, userId, tenantId) {
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
  return { tok, byok };
}

export async function loadConnectTiles(env, authUser, surface = 'home') {
  if (!env?.DB) return [];
  const tenantId = await resolveTenantIdOrFetch(env, authUser);
  if (!tenantId) return [];
  const userId = await resolveIntegrationUserId(env, authUser);
  const { tok, byok } = await tokenProviders(env.DB, userId, tenantId);
  const rows = await loadRegistryRows(env.DB, tenantId, surface);
  return rows.map((row) => mapConnectTileRow(row, tok, byok, env));
}

export async function handleConnectTilesApi(request, env, authUser, method) {
  if (!env?.DB) return jsonResponse({ ok: false, error: 'db_unavailable' }, 503);
  const url = new URL(request.url);
  const surface = url.searchParams.get('surface') === 'workspace' ? 'workspace' : 'home';
  const tenantId = await resolveTenantIdOrFetch(env, authUser);

  if (method === 'GET') {
    const returnTo =
      surface === 'workspace' ? '/dashboard/settings/workspace' : '/dashboard/home';
    const catalog = await loadIntegrationConnectCatalog(env, authUser, { returnTo });

    if (surface === 'home') {
      return jsonResponse({
        ok: true,
        surface,
        tiles: catalog.connected,
        catalog_available: catalog.available,
        connected_slugs: catalog.connected.map((t) => t.connect_slug),
        updated_at: catalog.updated_at,
      });
    }

    const tiles = await loadConnectTiles(env, authUser, surface);
    return jsonResponse({
      ok: true,
      surface,
      tiles,
      catalog_available: catalog.available,
      connected_slugs: tiles.filter((t) => t.connected).map((t) => t.connect_slug),
      updated_at: new Date().toISOString(),
    });
  }

  if (method === 'PUT') {
    const body = await request.json().catch(() => ({}));
    const items = Array.isArray(body.tiles) ? body.tiles : [];
    if (!items.length) return jsonResponse({ ok: false, error: 'tiles_required' }, 400);
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i] || {};
      const providerKey = String(it.provider_key || '').trim();
      if (!providerKey) continue;
      const sortOrder = Number.isFinite(Number(it.sort_order)) ? Number(it.sort_order) : (i + 1) * 10;
      const showHome = it.show_on_home === false || it.show_on_home === 0 ? 0 : 1;
      const showWs = it.show_on_workspace === false || it.show_on_workspace === 0 ? 0 : 1;
      const scaleRaw = Number(it.icon_scale);
      const iconScale = Number.isFinite(scaleRaw) ? Math.min(1.2, Math.max(0.5, scaleRaw)) : 1;
      const iconBg = it.icon_bg != null && String(it.icon_bg).trim() ? String(it.icon_bg).trim() : null;
      const customIcon =
        it.custom_icon_url != null && String(it.custom_icon_url).trim()
          ? String(it.custom_icon_url).trim()
          : null;
      try {
        await env.DB.prepare(
          `UPDATE integration_registry
           SET sort_order = ?, show_on_home = ?, show_on_workspace = ?,
               icon_scale = ?, icon_bg = ?, custom_icon_url = ?, updated_at = datetime('now')
           WHERE tenant_id = ? AND provider_key = ?`,
        )
          .bind(sortOrder, showHome, showWs, iconScale, iconBg, customIcon, tenantId, providerKey)
          .run();
      } catch {
        try {
          await env.DB.prepare(
            `UPDATE integration_registry
             SET sort_order = ?, show_on_home = ?, show_on_workspace = ?, updated_at = datetime('now')
             WHERE tenant_id = ? AND provider_key = ?`,
          )
            .bind(sortOrder, showHome, showWs, tenantId, providerKey)
            .run();
        } catch {
          await env.DB.prepare(
            `UPDATE integration_registry SET sort_order = ?, updated_at = datetime('now')
             WHERE tenant_id = ? AND provider_key = ?`,
          )
            .bind(sortOrder, tenantId, providerKey)
            .run();
        }
      }
    }
    const tiles = await loadConnectTiles(env, authUser, surface);
    return jsonResponse({ ok: true, surface, tiles });
  }

  return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
}
