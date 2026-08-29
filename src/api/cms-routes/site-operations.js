import { jsonResponse } from '../../core/auth.js';
import { buildCmsBootstrap } from '../../core/agentsam/cms/bootstrap/index.js';
import { cmsAssetToLegacyRow, listCmsCollectionAssets } from '../../core/agentsam/cms/assets/index.js';
import { buildCmsPageUrls } from '../../core/agentsam/cms/preview/index.js';
import { resolveActiveCmsThemeRow } from '../../../backend/services/cms/theme/resolve.js';
import { CMS_DEFAULT_R2_BUCKET } from '../../core/agentsam/cms/adapters/cloudflare/storage.js';
import { hydrateCmsSectionRows } from '../../core/agentsam/cms/adapters/cloudflare/section-artifacts.js';
import { getCmsDraftCache } from '../../core/cms-kv-cache.js';
import { maybeSpawnCmsSessionHandoff } from '../../core/cms-spawn-bridge.js';
import {
  listCmsSitesForScope, resolveCmsWorkspaceContext, sortSitesForWorkspace,
} from '../../core/cms-workspace-resolve.js';
import { listSiteShellPartsMeta, publishSiteShellPart, readSiteShellPart, writeSiteShellDraft } from '../../../backend/cms/public-site/site-shell.js';
import { resolveCmsSiteConfig } from '../../core/cms-site-config.js';
import { resolveCmsTenantByProjectSlug } from '../../core/cms-tenant-resolve.js';
import { resolveCmsSitePublicDomain } from '../../core/cms-public-domain.js';
import { upsertCmsSiteProjectContext } from '../../core/cms-project-context.js';

export async function handleCmsSiteOperationRoutes(state) {
  const {
    path, method, url, request, env, ctx, authUser, authTenantId, tenantId, workspaceId,
    cmsScope, assetScope, assetStore, requestCache, explicitProjectSlug, siteConfig, host,
  } = state;
  if (path === '/api/cms/tenants' && method === 'GET') {
    try {
      const sites = await listCmsSitesForScope(env, { tenantId: authTenantId, workspaceId });
      const websites = sites.map((s) => ({
        slug: s.slug,
        name: s.name || s.slug,
        domain: s.domain || null,
        page_count: s.page_count ?? 0,
        url: s.domain ? `https://${s.domain}` : null,
      }));
      return jsonResponse({ tenants: websites, websites });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }



  if (path === '/api/cms/collection-assets' && method === 'GET') {
    const collectionId = String(url.searchParams.get('collection_id') || '').trim();
    try {
      const result = await listCmsCollectionAssets(assetScope, collectionId || null, assetStore);
      return jsonResponse({
        assets: result.assets.map((item) => ({
          collection_id: item.collection_id,
          asset_id: item.asset_id,
          order_index: item.order_index,
          added_at: item.added_at,
          ...cmsAssetToLegacyRow(item.asset),
        })),
      });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  if (path === '/api/cms/websites' && method === 'GET') {
    try {
      const wsCtx = await resolveCmsWorkspaceContext(env, request, authUser, requestCache);
      const sorted = await sortSitesForWorkspace(env, wsCtx.sites || [], {
        primarySlug: wsCtx.project_slug,
        workspaceSlug: wsCtx.workspace_slug,
        workspaceId: wsCtx.workspace_id,
      });
      return jsonResponse({
        primary_project_slug: wsCtx.project_slug || null,
        workspace_slug: wsCtx.workspace_slug || null,
        websites: sorted.map((s) => ({
          slug: s.slug,
          name: s.name || s.slug,
          domain: s.domain || null,
          page_count: s.page_count ?? 0,
          updated_at: s.updated_at || null,
          source: s.source || null,
          url: s.domain ? `https://${s.domain}` : null,
        })),
      });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  if (path === '/api/cms/spawn-handoff' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid JSON' }, 400);
    }
    const turnCount = Number(body.turn_count ?? body.turnCount ?? 0);
    const parentRunId = String(body.parent_run_id ?? body.parentRunId ?? '').trim();
    const parentSessionId = String(body.parent_session_id ?? body.parentSessionId ?? '').trim();
    const pageId = String(body.page_id ?? body.pageId ?? '').trim();
    const goal =
      String(body.goal || '').trim() ||
      (pageId ? `Continue CMS edit for page ${pageId}` : 'Continue CMS edit session');
    const handoff = await maybeSpawnCmsSessionHandoff(env, ctx, {
      userId: authUser.id,
      workspaceId,
      tenantId,
      parentRunId: parentRunId || `cms_${pageId || 'studio'}_${Date.now().toString(36)}`,
      parentSessionId: parentSessionId || `cms_session_${pageId || 'studio'}`,
      turnCount,
      goal,
      messages: body.messages || [],
    });
    return jsonResponse({ ok: true, ...handoff });
  }



  const siteShellPublishMatch = path.match(/^\/api\/cms\/site-shell\/([^/]+)\/publish$/);
  if (siteShellPublishMatch && method === 'POST') {
    const partId = siteShellPublishMatch[1];
    const projectSlug =
      url.searchParams.get('project_slug') ||
      url.searchParams.get('site') ||
      explicitProjectSlug ||
      siteConfig.project_slug;
    const slug = String(projectSlug || '').trim();
    if (!slug || !cmsScope.allowedSlugs.has(slug)) {
      return jsonResponse({ error: 'CMS_SITE_NOT_ALLOWED', project_slug: slug || null }, 403);
    }
    try {
      const part = await publishSiteShellPart(env, slug, partId);
      return jsonResponse({ ok: true, part });
    } catch (e) {
      const msg = e?.message || 'publish_failed';
      const status = msg === 'no_shell_draft' ? 409 : msg === 'site_shell_part_not_found' ? 404 : 500;
      return jsonResponse({ error: msg }, status);
    }
  }

  const siteShellPartMatch = path.match(/^\/api\/cms\/site-shell\/([^/]+)$/);
  if (siteShellPartMatch) {
    const partId = siteShellPartMatch[1];
    const projectSlug =
      url.searchParams.get('project_slug') ||
      url.searchParams.get('site') ||
      explicitProjectSlug ||
      siteConfig.project_slug;
    const slug = String(projectSlug || '').trim();
    if (!slug || !cmsScope.allowedSlugs.has(slug)) {
      return jsonResponse({ error: 'CMS_SITE_NOT_ALLOWED', project_slug: slug || null }, 403);
    }
    if (method === 'GET') {
      const useDraft =
        url.searchParams.get('draft') === '1' || url.searchParams.get('preview') === 'draft';
      try {
        const part = await readSiteShellPart(env, slug, partId, { draft: useDraft });
        if (!part) return jsonResponse({ error: 'site_shell_not_found' }, 404);
        return jsonResponse({ part });
      } catch (e) {
        return jsonResponse({ error: e.message || 'read_failed' }, 500);
      }
    }
    if (method === 'PUT') {
      let body = {};
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'invalid JSON' }, 400);
      }
      try {
        const part = await writeSiteShellDraft(env, slug, partId, String(body.html || ''));
        return jsonResponse({ ok: true, part });
      } catch (e) {
        const msg = e?.message || 'write_failed';
        const status =
          msg === 'site_shell_not_configured' || msg === 'site_shell_part_not_found' ? 404 : 500;
        return jsonResponse({ error: msg }, status);
      }
    }
  }

  if (path === '/api/cms/site-shell' && method === 'GET') {
    const projectSlug =
      url.searchParams.get('project_slug') ||
      url.searchParams.get('site') ||
      explicitProjectSlug ||
      siteConfig.project_slug;
    const slug = String(projectSlug || '').trim();
    if (!slug || !cmsScope.allowedSlugs.has(slug)) {
      return jsonResponse({ error: 'CMS_SITE_NOT_ALLOWED', project_slug: slug || null }, 403);
    }
    try {
      const site_shell = await listSiteShellPartsMeta(env, slug);
      return jsonResponse({ site_shell });
    } catch (e) {
      return jsonResponse({ error: e.message || 'list_failed' }, 500);
    }
  }

  if (path === '/api/cms/bootstrap' && method === 'GET') {
    const explicitSlug =
      url.searchParams.get('project_slug') ||
      url.searchParams.get('site') ||
      url.searchParams.get('project') ||
      null;
    const focusPageId = String(url.searchParams.get('page_id') || '').trim() || null;

    try {
      const result = await buildCmsBootstrap({
        env,
        ctx,
        request,
        authUser,
        workspaceId,
        tenantId,
        explicitSlug,
        focusPageId,
        requestCache,
        defaultR2Bucket: CMS_DEFAULT_R2_BUCKET,
        storageBindings: { kv: 'SESSION_CACHE', collaboration: 'IAM_COLLAB' },
        adapters: {
          enrichPages: host.enrichPages,
          hydrateSections: hydrateCmsSectionRows,
          resolveActiveThemeRow: resolveActiveCmsThemeRow,
          getDraftCache: getCmsDraftCache,
          resolveSiteConfig: resolveCmsSiteConfig,
          listSiteShell: listSiteShellPartsMeta,
          resolveTenant: resolveCmsTenantByProjectSlug,
          resolvePublicDomain: resolveCmsSitePublicDomain,
          buildPageUrls: buildCmsPageUrls,
          listStorefrontCatalog: host.listStorefrontCatalog,
          upsertProjectContext: upsertCmsSiteProjectContext,
        },
      });
      return jsonResponse(result.body, result.status || (result.ok ? 200 : 400));
    } catch (e) {
      return jsonResponse({ error: e.message || 'CMS_BOOTSTRAP_FAILED' }, 500);
    }
  }




  return null;
}
