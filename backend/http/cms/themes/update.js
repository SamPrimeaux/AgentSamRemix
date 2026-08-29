import { httpJsonResponse as jsonResponse } from '../../responses.js';
import { userCanAccessWorkspace } from '../../../identity/workspace/access.js';
import { buildResolvedActiveThemeApiPayload, resolveDashboardThemePayload, resolveDashboardThemeTenantId } from '../../../services/cms/theme/payload.js';
import { invalidateCachedActiveThemePayload } from '../../../services/cms/theme/cache.js';
import {
  setDashboardUserThemePreference,
  setWorkspaceCmsThemePreferenceAndResolve,
} from '../../../services/cms/theme/preferences.js';
import { resolveTenantIdForCmsThemeOps } from '../../../services/cms/theme/resolve.js';
import { normalizeCatalogThemeRow } from '../../../services/cms/theme/preview-model.js';
import {
  forkSharedCmsThemeForTenant,
  isSharedCmsTheme,
  tenantCanMutateCmsTheme,
  tenantCanReadCmsTheme,
} from '../../../services/cms/theme/ownership.js';
import { buildThemeRowUpdateFromBody } from '../../../services/cms/theme/update.js';
import { normalizeThemeSlug } from '../../../services/cms/theme/create.js';
import {
  archiveTenantCmsTheme,
  findCmsThemeSlugConflict,
  readCmsThemeById,
  readCmsThemeBySlug,
  updateTenantCmsTheme,
} from '../../../services/cms/theme/repository.js';
import {
  broadcastWorkspaceThemeCollab,
  hydrateCmsThemeCssVarsFromR2,
} from '../../../services/cms/adapters/cloudflare/theme.js';

export async function handleCmsThemeUpdateRoute({ pathLower, request, env, authUser }) {
  if (request.method.toUpperCase() !== 'POST') return null;

  if (pathLower === '/api/themes/update') {
    const body = await request.json().catch(() => ({}));
    const tid = String((await resolveDashboardThemeTenantId(env, authUser)) || '').trim();
    const uid = String(authUser.id || '').trim();
    const themeId = body.theme_id != null ? String(body.theme_id).trim() : '';
    const slugIn = body.slug != null ? String(body.slug).trim() : '';

    let sourceRow = themeId ? await readCmsThemeById(env, themeId) : null;
    if (!sourceRow && slugIn) sourceRow = await readCmsThemeBySlug(env, slugIn);
    if (!sourceRow?.id) return jsonResponse({ error: 'Theme not found' }, 404);
    if (!tenantCanReadCmsTheme(sourceRow, tid)) return jsonResponse({ error: 'Forbidden' }, 403);

    const forkedFromShared = isSharedCmsTheme(sourceRow);
    let row = sourceRow;
    let forkCreated = false;
    let mutationBody = body;
    if (forkedFromShared) {
      const fork = await forkSharedCmsThemeForTenant(env, sourceRow, tid, slugIn);
      row = fork.row;
      forkCreated = fork.forked;
      mutationBody = { ...body, slug: String(row.slug || '').trim() };
    } else if (!tenantCanMutateCmsTheme(row, tid)) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    const workspaceId =
      body.workspace_id != null && String(body.workspace_id).trim() !== ''
        ? String(body.workspace_id).trim()
        : '';
    const applyToWorkspace =
      body.apply_to_workspace === true || body.apply_to_workspace === 1 || body.apply_to_workspace === '1';
    if (applyToWorkspace) {
      if (!workspaceId) return jsonResponse({ error: 'workspace_id required for workspace apply' }, 400);
      if (!(await userCanAccessWorkspace(env, authUser, workspaceId))) {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }
    }

    const patch = buildThemeRowUpdateFromBody(row, mutationBody);
    const rowId = String(row.id);
    const desiredSlug = normalizeThemeSlug(patch.slug || String(row.slug || ''));
    if (!desiredSlug) return jsonResponse({ error: 'slug required' }, 400);

    if (desiredSlug !== String(row.slug || '').trim()) {
      const conflict = await findCmsThemeSlugConflict(env, desiredSlug, rowId);
      if (conflict?.id) {
        return jsonResponse({ error: `Theme slug "${desiredSlug}" is already in use` }, 409);
      }
    }

    const updated = await updateTenantCmsTheme(env, {
      rowId,
      tenantId: tid,
      desiredSlug,
      patch,
    });
    if (!updated) return jsonResponse({ error: 'Theme update failed' }, 500);

    const normalized = normalizeCatalogThemeRow(updated);
    const out = {
      theme: normalized,
      forked: forkedFromShared,
      fork_created: forkCreated,
      source_theme_id: forkedFromShared ? String(sourceRow.id) : null,
    };

    const applyToUser = body.apply_to_user === true || body.apply_to_user === 1 || body.apply_to_user === '1';
    if (applyToUser) {
      await setDashboardUserThemePreference(env, {
        tenantId: tid,
        userId: uid,
        themeSlug: String(updated.slug),
        themeCmsRowId: rowId,
      });
      await invalidateCachedActiveThemePayload(env, null, uid);
      const { payload } = await resolveDashboardThemePayload(env, authUser, {
        cache: true,
        hydrateCssVars: hydrateCmsThemeCssVarsFromR2,
      });
      out.active_theme = payload;
    } else if (applyToWorkspace) {
      const workspaceTenantId =
        (await resolveTenantIdForCmsThemeOps(env, authUser, workspaceId)) || tid;
      const resolved = await setWorkspaceCmsThemePreferenceAndResolve(
        env,
        authUser,
        String(workspaceTenantId),
        workspaceId,
        String(updated.slug),
      );
      await invalidateCachedActiveThemePayload(env, workspaceId, uid);
      const payload = await buildResolvedActiveThemeApiPayload(env, {
        themeRow: resolved.row || updated,
        resolved,
        workspaceId,
        projectId: null,
        authUser,
        cache: true,
        hydrateCssVars: hydrateCmsThemeCssVarsFromR2,
      });
      out.active_theme = payload;
      await broadcastWorkspaceThemeCollab(env, workspaceId, payload);
    }

    return jsonResponse(out);
  }

  if (pathLower === '/api/themes/delete') {
    const tid = String((await resolveDashboardThemeTenantId(env, authUser)) || '').trim();
    const body = await request.json().catch(() => ({}));
    const themeId = body.theme_id != null ? String(body.theme_id).trim() : '';
    const slugIn = body.slug != null ? String(body.slug).trim() : '';
    let row = themeId ? await readCmsThemeById(env, themeId) : null;
    if (!row && slugIn) row = await readCmsThemeBySlug(env, slugIn);
    if (!row?.id) return jsonResponse({ error: 'Theme not found' }, 404);
    if (!tenantCanMutateCmsTheme(row, tid)) {
      return jsonResponse({ error: 'Only your custom themes can be deleted' }, 403);
    }

    await archiveTenantCmsTheme(env, { themeId: String(row.id), tenantId: tid });
    return jsonResponse({ ok: true, theme_id: String(row.id), slug: String(row.slug) });
  }

  return null;
}
