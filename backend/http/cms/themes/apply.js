import { httpJsonResponse as jsonResponse } from '../../responses.js';
import { fallbackSystemTenantId } from '../../../identity/users/tenant.js';
import { userCanAccessWorkspace } from '../../../identity/workspace/access.js';
import { buildResolvedActiveThemeApiPayload, resolveDashboardThemePayload } from '../../../services/cms/theme/payload.js';
import { invalidateCachedActiveThemePayload } from '../../../services/cms/theme/cache.js';
import {
  mirrorWorkspaceCmsThemeSlug,
  setDashboardUserThemePreference,
  upsertCmsThemePreferenceRow,
} from '../../../services/cms/theme/preferences.js';
import { resolveActiveCmsThemeRow, resolveTenantIdForCmsThemeOps } from '../../../services/cms/theme/resolve.js';
import { tenantCanReadCmsTheme } from '../../../services/cms/theme/ownership.js';
import { readCmsThemeById, readCmsThemeBySlug } from '../../../services/cms/theme/repository.js';
import {
  broadcastWorkspaceThemeCollab,
  hydrateCmsThemeCssVarsFromR2,
} from '../../../services/cms/adapters/cloudflare/theme.js';

export async function handleCmsThemeApplyRoute({ pathLower, request, env, authUser }) {
  if (pathLower !== '/api/themes/apply' || request.method.toUpperCase() !== 'POST') return null;

  const body = await request.json().catch(() => ({}));
  const themeId = body.theme_id != null ? String(body.theme_id).trim() : '';
  const themeSlugIn = body.theme_slug != null ? String(body.theme_slug).trim() : '';
  const scopeRaw = String(body.scope || 'user_global').toLowerCase().trim();
  const scope = scopeRaw === 'workspace' || scopeRaw === 'project' ? scopeRaw : 'user_global';

  let themeRow = themeId ? await readCmsThemeById(env, themeId) : null;
  if (!themeRow && themeSlugIn) themeRow = await readCmsThemeBySlug(env, themeSlugIn);
  if (!themeRow?.slug) return jsonResponse({ error: 'Theme not found' }, 404);

  const workspaceId =
    body.workspace_id != null && String(body.workspace_id).trim() !== ''
      ? String(body.workspace_id).trim()
      : '';
  const projectId =
    body.project_id != null && String(body.project_id).trim() !== ''
      ? String(body.project_id).trim()
      : '';

  if (scope === 'workspace' || scope === 'project') {
    if (!workspaceId) return jsonResponse({ error: 'workspace_id required for this scope' }, 400);
    if (!(await userCanAccessWorkspace(env, authUser, workspaceId))) {
      return jsonResponse({ error: 'Not allowed for this workspace' }, 403);
    }
  }
  if (scope === 'project' && !projectId) {
    return jsonResponse({ error: 'project_id required for project scope' }, 400);
  }

  const tenantId =
    (await resolveTenantIdForCmsThemeOps(
      env,
      authUser,
      scope === 'user_global' ? null : workspaceId || null,
    )) || fallbackSystemTenantId(env);
  const tid = String(tenantId || '').trim();
  const uid = String(authUser.id || '').trim();
  if (!tenantCanReadCmsTheme(themeRow, tid)) return jsonResponse({ error: 'Forbidden' }, 403);

  const slug = String(themeRow.slug).trim();
  if (scope === 'user_global') {
    await setDashboardUserThemePreference(env, {
      tenantId: tid,
      userId: uid,
      themeSlug: slug,
      themeCmsRowId: themeRow?.id != null ? String(themeRow.id) : null,
    });
    await invalidateCachedActiveThemePayload(env, null, uid);
    const { payload } = await resolveDashboardThemePayload(env, authUser, {
      cache: true,
      hydrateCssVars: hydrateCmsThemeCssVarsFromR2,
    });
    return jsonResponse(payload);
  }

  const prefId =
    scope === 'project'
      ? `tp_pr_${tid}_${workspaceId}_${projectId}`
      : `tp_ws_${tid}_${workspaceId}`;
  await upsertCmsThemePreferenceRow(env, {
    prefId,
    tenantId: tid,
    scope,
    workspaceId,
    projectId: scope === 'project' ? projectId : null,
    userId: null,
    themeSlug: slug,
    themeCmsRowId: themeRow?.id != null ? String(themeRow.id) : null,
  });
  if (scope === 'workspace') await mirrorWorkspaceCmsThemeSlug(env, workspaceId, slug);

  let resolved;
  try {
    resolved = await resolveActiveCmsThemeRow(env, {
      tenantId: tid,
      authUser,
      workspaceId,
      projectId: scope === 'project' ? projectId : null,
    });
  } catch (error) {
    console.warn('[themes/apply] resolveActiveCmsThemeRow', error?.message ?? error);
    resolved = { row: themeRow, resolved_from: 'apply' };
  }

  await invalidateCachedActiveThemePayload(env, workspaceId, uid);
  const payload = await buildResolvedActiveThemeApiPayload(env, {
    themeRow: resolved.row || themeRow,
    resolved,
    workspaceId,
    projectId: scope === 'project' ? projectId : null,
    authUser,
    cache: true,
    hydrateCssVars: hydrateCmsThemeCssVarsFromR2,
  });
  await broadcastWorkspaceThemeCollab(env, workspaceId, payload);
  return jsonResponse(payload);
}
