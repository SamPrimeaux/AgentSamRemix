import { httpJsonResponse as jsonResponse } from '../../responses.js';
import { listCmsThemeCatalog } from '../../../services/cms/theme/catalog.js';
import { normalizeCatalogThemeRow } from '../../../services/cms/theme/preview-model.js';
import {
  resolveDashboardThemePayload,
  resolveDashboardThemeTenantId,
} from '../../../services/cms/theme/payload.js';
import { readCmsThemeById, readCmsThemeBySlug } from '../../../services/cms/theme/repository.js';
import { tenantCanReadCmsTheme } from '../../../services/cms/theme/ownership.js';
import { hydrateCmsThemeCssVarsFromR2 } from '../../../services/cms/adapters/cloudflare/theme.js';

export async function handleCmsThemeReadRoute({ pathLower, request, url, env, authUser }) {
  if (request.method.toUpperCase() !== 'GET') return null;

  if (pathLower === '/api/themes') {
    const tenantId = await resolveDashboardThemeTenantId(env, authUser);
    const themes = await listCmsThemeCatalog(env, tenantId);
    return jsonResponse({ themes });
  }

  if (pathLower === '/api/user/preferences') {
    try {
      const { resolved, payload } = await resolveDashboardThemePayload(env, authUser, {
        cache: false,
        hydrateCssVars: hydrateCmsThemeCssVarsFromR2,
      });
      return jsonResponse({
        theme_preset: payload?.slug || 'dark',
        theme: payload?.slug || 'dark',
        workspace_id: null,
        resolved_from: resolved?.resolved_from || payload?.resolved_from || 'default',
      });
    } catch (error) {
      console.warn('[user/preferences]', error?.message ?? error);
      return jsonResponse({
        theme_preset: 'dark',
        theme: 'dark',
        workspace_id: null,
        resolved_from: 'default',
      });
    }
  }

  if (pathLower === '/api/themes/active') {
    try {
      const { payload } = await resolveDashboardThemePayload(env, authUser, {
        cache: true,
        hydrateCssVars: hydrateCmsThemeCssVarsFromR2,
      });
      return jsonResponse(payload);
    } catch (error) {
      console.warn('[themes/active]', error?.message ?? error);
      return jsonResponse({
        name: 'dark',
        slug: 'dark',
        is_dark: true,
        data: {},
        workspace_id: null,
        theme_channel: 'live',
        resolved_from: 'default',
      });
    }
  }

  if (pathLower === '/api/themes/detail') {
    const tid = String((await resolveDashboardThemeTenantId(env, authUser)) || '').trim();
    const themeId = url.searchParams.get('theme_id')?.trim() || '';
    const slug = url.searchParams.get('slug')?.trim() || '';
    let row = themeId ? await readCmsThemeById(env, themeId) : null;
    if (!row && slug) row = await readCmsThemeBySlug(env, slug);
    if (!row) return jsonResponse({ error: 'Theme not found' }, 404);
    if (!tenantCanReadCmsTheme(row, tid)) return jsonResponse({ error: 'Forbidden' }, 403);
    return jsonResponse({ theme: normalizeCatalogThemeRow(row) });
  }

  return null;
}
