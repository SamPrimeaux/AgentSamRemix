import { jsonResponse } from '../../core/auth.js';
import {
  getCmsThemeForWorkspace,
  listCmsThemesForWorkspace,
} from '../../../backend/services/cms/theme/catalog.js';
import { invalidateCachedActiveThemePayload } from '../../../backend/services/cms/theme/cache.js';
import { saveCmsSiteThemeOverrides } from '../../core/agentsam/cms/theme/overrides.js';
import { upsertCmsThemePreferenceRow } from '../../../backend/services/cms/theme/preferences.js';
import { invalidateCmsBootstrap } from '../../core/cms-edit-safety.js';

export async function handleCmsThemeRoutes(state) {
  const { path, method, request, env, ctx, authUser, tenantId, workspaceId, cmsScope } = state;
  if (path === '/api/cms/themes' && method === 'GET') {
    try { return jsonResponse({ themes: await listCmsThemesForWorkspace(env, workspaceId, 100) }); }
    catch (e) { return jsonResponse({ error: e.message }, 500); }
  }
  if (path === '/api/cms/theme-vars' && method === 'PATCH') {
    let body = {};
    try { body = await request.json(); } catch { return jsonResponse({ error: 'invalid JSON' }, 400); }
    const projectSlug = String(body.project_slug || body.site || '').trim();
    if (!projectSlug) return jsonResponse({ error: 'project_slug required' }, 400);
    if (!cmsScope.allowedSlugs.has(projectSlug)) return jsonResponse({ error: 'CMS_SITE_NOT_ALLOWED', project_slug: projectSlug }, 403);
    if (!body.vars || typeof body.vars !== 'object' || Array.isArray(body.vars)) return jsonResponse({ error: 'vars object required' }, 400);
    try {
      const saved = await saveCmsSiteThemeOverrides(env, { tenantId, workspaceId, projectSlug, vars: body.vars, updatedBy: authUser.id });
      if (!saved.ok) return jsonResponse({ error: saved.error }, 400);
      invalidateCmsBootstrap(env, ctx, workspaceId, projectSlug);
      return jsonResponse({ success: true, project_slug: projectSlug, vars: saved.vars });
    } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }
  if (path === '/api/cms/themes/activate' && method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    const themeKey = String(body.theme_id || body.slug || body.theme_slug || '').trim();
    const projectSlug = String(body.project_slug || '').trim() || null;
    if (!themeKey) return jsonResponse({ error: 'theme_id_or_slug_required' }, 400);
    try {
      const theme = await getCmsThemeForWorkspace(env, workspaceId, themeKey);
      if (!theme?.id) return jsonResponse({ error: 'Theme not found' }, 404);
      await upsertCmsThemePreferenceRow(env, {
        prefId: `pref_${Date.now().toString(36)}`,
        tenantId,
        scope: 'workspace',
        workspaceId,
        projectId: null,
        userId: null,
        themeSlug: String(body.theme_slug || body.slug || theme.slug || '').trim(),
        themeCmsRowId: String(theme.id),
      });
      await invalidateCachedActiveThemePayload(env, workspaceId, authUser.id);
      if (projectSlug) invalidateCmsBootstrap(env, ctx, workspaceId, projectSlug);
      return jsonResponse({ success: true, theme_id: theme.id, slug: theme.slug || null });
    } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }
  return null;
}
