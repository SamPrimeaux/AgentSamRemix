/**
 * Shared active-theme payload builder for GET /api/themes/active and dashboard bootstrap.
 */
import { buildActiveThemeApiPayload } from './active.js';
import { getCachedActiveThemePayload, putCachedActiveThemePayload } from './cache.js';
import { resolveDashboardUserThemeRow, resolveTenantIdForCmsThemeOps } from './resolve.js';
import { fallbackSystemTenantId } from '../../../identity/users/tenant.js';

/**
 * @param {any} env
 * @param {{
 *   themeRow: Record<string, unknown> | null,
 *   resolved: { row?: Record<string, unknown> | null, resolved_from?: string },
 *   workspaceId?: string | null,
 *   projectId?: string | null,
 *   authUser?: { id?: string } | null,
 *   cache?: boolean,
 * }} args
 */
export async function buildResolvedActiveThemeApiPayload(env, args) {
  let themeRow = args.themeRow;
  if (!themeRow && env?.DB) {
    themeRow = await env.DB.prepare(
      `SELECT * FROM cms_themes WHERE is_system = 1 AND slug = 'dark' LIMIT 1`,
    ).first();
  }

  if (typeof args.hydrateCssVars === 'function') await args.hydrateCssVars(env, themeRow);

  const payload =
    buildActiveThemeApiPayload(themeRow) ||
    ({
      name: 'dark',
      slug: 'dark',
      is_dark: true,
      data: {},
      theme_channel: 'live',
    });

  payload.resolved_from = args.resolved?.resolved_from ?? 'none';
  const ws = args.workspaceId != null ? String(args.workspaceId).trim() : '';
  const proj = args.projectId != null ? String(args.projectId).trim() : '';
  if (ws) payload.workspace_id = ws;
  if (proj) payload.project_id = proj;

  if (args.cache !== false && args.authUser?.id) {
    await putCachedActiveThemePayload(env, ws || null, args.authUser.id, proj || null, payload);
  }

  return payload;
}

/**
 * Dashboard bootstrap theme — KV first, then D1 (same semantics as GET /api/themes/active).
 * @param {any} env
 * @param {Record<string, unknown> | null | undefined} authUser
 * @param {string | null | undefined} workspaceId
 * @param {{ cache?: boolean, hydrateCssVars?: Function }} [adapters]
 */
export async function resolveDashboardBootstrapTheme(env, authUser, _workspaceId, adapters = {}) {
  const uid = authUser?.id != null ? String(authUser.id).trim() : '';

  try {
    const cached = await getCachedActiveThemePayload(env, null, uid, null);
    if (cached) {
      cached.theme_channel = cached.theme_channel || 'live';
      cached.cache_hit = 'kv';
      return cached;
    }

    if (!env?.DB) {
      return {
        name: 'dark',
        slug: 'dark',
        is_dark: true,
        data: {},
        theme_channel: 'live',
        resolved_from: 'no_db',
      };
    }

    const tenantId = await resolveTenantIdForCmsThemeOps(env, authUser, null);
    const resolved = await resolveDashboardUserThemeRow(env, { tenantId, authUser });

    return await buildResolvedActiveThemeApiPayload(env, {
      themeRow: resolved.row,
      resolved,
      workspaceId: null,
      projectId: null,
      authUser,
      cache: adapters.cache !== false,
      hydrateCssVars: adapters.hydrateCssVars,
    });
  } catch {
    return {
      name: 'dark',
      slug: 'dark',
      is_dark: true,
      data: {},
      theme_channel: 'live',
      resolved_from: 'default',
    };
  }
}


/** Resolve the authenticated dashboard user's tenant, with the platform tenant as legacy fallback. */
export async function resolveDashboardThemeTenantId(env, authUser) {
  return (await resolveTenantIdForCmsThemeOps(env, authUser, null)) || fallbackSystemTenantId(env);
}

/** Shared dashboard appearance payload used by HTTP and bootstrap callers. */
export async function resolveDashboardThemePayload(env, authUser, adapters = {}) {
  const cache = adapters.cache !== false;
  const tenantId = await resolveDashboardThemeTenantId(env, authUser);
  const tid = String(tenantId || '').trim();
  const uid = String(authUser?.id || '').trim();

  if (cache && uid) {
    const cached = await getCachedActiveThemePayload(env, null, uid, null);
    if (cached) {
      cached.theme_channel = cached.theme_channel || 'live';
      cached.cache_hit = 'kv';
      return { tenantId: tid, resolved: null, payload: cached };
    }
  }

  const resolved = await resolveDashboardUserThemeRow(env, { tenantId: tid || null, authUser });
  const payload = await buildResolvedActiveThemeApiPayload(env, {
    themeRow: resolved.row,
    resolved,
    workspaceId: null,
    projectId: null,
    authUser,
    cache,
    hydrateCssVars: adapters.hydrateCssVars,
  });
  return { tenantId: tid, resolved, payload };
}
