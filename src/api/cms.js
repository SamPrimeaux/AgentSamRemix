/**
 * CMS HTTP facade.
 *
 * This module owns authentication, request-scoped CMS context, host/bridge routing,
 * construction of canonical stores/adapters, ordered route dispatch, and HTTP fallback.
 * Reusable CMS business rules and storage mechanics live outside this transport layer.
 */
import { getAuthUser, jsonResponse } from '../core/auth.js';
import { resolveIamActorContext } from '../core/identity.js';
import { resolveCmsApiScope } from '../core/cms-access.js';
import { resolveCmsSiteConfig } from '../core/cms-site-config.js';
import { isCmsBridgeEligible, mintCmsEmbedSession, proxyCmsBridgeRequest } from '../core/cms-client-bridge.js';
import { tryBridgedCpasCmsRequest } from '../core/cms-bridge-cpas-adapter.js';

import { createD1CmsPageStore } from '../core/agentsam/cms/adapters/cloudflare/d1-page-store.js';
import { createD1CmsSectionStore } from '../core/agentsam/cms/adapters/cloudflare/d1-section-store.js';
import { createD1CmsBlockStore } from '../core/agentsam/cms/adapters/cloudflare/d1-block-store.js';
import { createD1CmsAssetStore } from '../core/agentsam/cms/adapters/cloudflare/d1-asset-store.js';
import { createCloudflareCmsPreviewStore } from '../core/agentsam/cms/adapters/cloudflare/preview-store.js';
import { createCloudflareCmsLifecycleStore } from '../core/agentsam/cms/adapters/cloudflare/lifecycle-store.js';
import { CMS_DEFAULT_R2_BUCKET } from '../core/agentsam/cms/adapters/cloudflare/storage.js';
import { bindCmsHostPlatformContext } from './cms-host-platform-bind.js';

import { handleCmsActivityRoutes } from './cms-routes/activity.js';
import { handleCmsAssetRoutes } from './cms-routes/assets.js';
import { handleCmsContextRoutes } from './cms-routes/context.js';
import { handleCmsConversionRoutes } from './cms-routes/conversions.js';
import { handleCmsInjectedSectionRoutes } from './cms-routes/injected-sections.js';
import { handleCmsIntegrationRoutes } from './cms-routes/integrations.js';
import { handleCmsLiquidImportRoutes } from './cms-routes/liquid-imports.js';
import { handleCmsLiveLifecycleRoutes } from './cms-routes/live-lifecycle.js';
import { handleCmsPageRoutes } from './cms-routes/pages.js';
import { handleCmsRevisionRoutes } from './cms-routes/revisions.js';
import { handleCmsSectionBlockRoutes } from './cms-routes/sections-blocks.js';
import { handleCmsSiteOperationRoutes } from './cms-routes/site-operations.js';
import { handleCmsSitePackageRoutes } from './cms-routes/site-packages.js';
import { handleCmsStudioStatusRoutes } from './cms-routes/studio-status.js';
import { handleCmsTemplateRoutes } from './cms-routes/templates.js';
import { handleCmsThemeRoutes } from './cms-routes/themes.js';

export { CMS_DEFAULT_R2_BUCKET };

const PRE_BRIDGE_HANDLERS = [handleCmsContextRoutes, handleCmsIntegrationRoutes];

const POST_BRIDGE_HANDLERS = [
  handleCmsPageRoutes,
  handleCmsRevisionRoutes,
  handleCmsSectionBlockRoutes,
  handleCmsLiveLifecycleRoutes,
  handleCmsConversionRoutes,
  handleCmsTemplateRoutes,
  handleCmsLiquidImportRoutes,
  handleCmsInjectedSectionRoutes,
  handleCmsStudioStatusRoutes,
  handleCmsSiteOperationRoutes,
  handleCmsSitePackageRoutes,
  handleCmsThemeRoutes,
  handleCmsAssetRoutes,
  handleCmsActivityRoutes,
];

async function dispatchCmsRoutes(handlers, state) {
  for (const handler of handlers) {
    const response = await handler(state);
    if (response) return response;
  }
  return null;
}

export async function handleCmsApi(request, url, env, ctx) {
  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/\/$/, '');
  const pathParts = path.split('/');
  const authTenantId = authUser.tenant_id;
  const personUuid = authUser.person_uuid;
  const actorCtx = await resolveIamActorContext(request, env).catch(() => null);
  const workspaceId =
    actorCtx?.workspaceId ||
    (authUser.workspace_id ? String(authUser.workspace_id).trim() : '') ||
    null;

  if (!authTenantId || String(authTenantId).trim() === '') {
    return jsonResponse({ error: 'TENANT_CONTEXT_MISSING' }, 400);
  }
  if (!workspaceId) return jsonResponse({ error: 'WORKSPACE_CONTEXT_MISSING' }, 400);
  if (!env.DB) return jsonResponse({ error: 'Database unavailable' }, 503);

  const tenantId = authTenantId;
  const requestCache = {};
  const cmsScope = await resolveCmsApiScope(env, authUser, workspaceId);
  const pageStore = createD1CmsPageStore(env.DB);
  const sectionStore = createD1CmsSectionStore(env);
  const blockStore = createD1CmsBlockStore(env.DB);
  const previewStore = createCloudflareCmsPreviewStore(env);
  const lifecycleStore = createCloudflareCmsLifecycleStore(env);
  const assetStore = createD1CmsAssetStore(env.DB);
  const assetScope = { ...cmsScope, tenantId, workspaceId };

  const routeState = {
    request,
    url,
    env,
    ctx,
    authUser,
    method,
    path,
    pathParts,
    tenantId,
    authTenantId,
    personUuid,
    workspaceId,
    cmsScope,
    pageStore,
    sectionStore,
    blockStore,
    previewStore,
    lifecycleStore,
    assetStore,
    assetScope,
    requestCache,
  };

  // Context and integration discovery intentionally precede client-worker interception.
  const preBridgeResponse = await dispatchCmsRoutes(PRE_BRIDGE_HANDLERS, routeState);
  if (preBridgeResponse) return preBridgeResponse;

  const explicitProjectSlug =
    url.searchParams.get('project_slug') ||
    url.searchParams.get('site') ||
    url.searchParams.get('project_id') ||
    null;
  const siteConfig = await resolveCmsSiteConfig(env, workspaceId, explicitProjectSlug);

  if (path === '/api/cms/bridge/embed-session' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid JSON' }, 400);
    }
    const projectSlug = String(body.project_slug || body.site || siteConfig.project_slug || '').trim();
    if (!projectSlug) return jsonResponse({ error: 'project_slug required' }, 400);
    if (!cmsScope.allowedSlugs.has(projectSlug)) {
      return jsonResponse({ error: 'CMS_SITE_NOT_ALLOWED', project_slug: projectSlug }, 403);
    }
    const cfg = await resolveCmsSiteConfig(env, workspaceId, projectSlug);
    if (!isCmsBridgeEligible(cfg)) {
      return jsonResponse(
        { error: 'CMS_BRIDGE_NOT_APPLICABLE', cms_hosting: cfg.cms_hosting, bridge_supported: cfg.bridge_supported },
        409,
      );
    }
    const mint = await mintCmsEmbedSession(env, authUser, { ...cfg, project_slug: projectSlug });
    if (!mint.ok) {
      return jsonResponse(
        {
          error: mint.error || 'embed_session_failed',
          status: mint.status,
          hint: 'Client worker bridge middleware pending (Agent 4)',
        },
        mint.status && mint.status >= 400 ? mint.status : 502,
      );
    }
    return jsonResponse({
      embed_url: mint.embed_url,
      expires_at: mint.expires_at,
      studio_url: cfg.studio_url,
      bridge_supported: cfg.bridge_supported,
    });
  }

  if (path.startsWith('/api/cms/bridge/')) {
    const projectSlug =
      url.searchParams.get('project_slug') ||
      url.searchParams.get('site') ||
      explicitProjectSlug ||
      siteConfig.project_slug;
    const slug = String(projectSlug || '').trim();
    if (!slug || !cmsScope.allowedSlugs.has(slug)) {
      return jsonResponse({ error: 'CMS_SITE_NOT_ALLOWED', project_slug: slug || null }, 403);
    }
    const cfg = await resolveCmsSiteConfig(env, workspaceId, slug);
    if (!isCmsBridgeEligible(cfg)) {
      return jsonResponse(
        { error: 'CMS_BRIDGE_NOT_APPLICABLE', cms_hosting: cfg.cms_hosting, bridge_supported: cfg.bridge_supported },
        409,
      );
    }
    const proxied = await proxyCmsBridgeRequest(
      env,
      request,
      authUser,
      { ...cfg, project_slug: slug },
      path,
    );
    return jsonResponse(proxied.body, proxied.status || (proxied.ok ? 200 : 502));
  }

  const bridgeProjectSlug = String(
    explicitProjectSlug ||
      url.searchParams.get('project_slug') ||
      url.searchParams.get('site') ||
      siteConfig.project_slug ||
      '',
  ).trim();

  if (
    bridgeProjectSlug &&
    cmsScope.allowedSlugs.has(bridgeProjectSlug)
  ) {
    const bridgeCfg = await resolveCmsSiteConfig(env, workspaceId, bridgeProjectSlug);
    if (isCmsBridgeEligible(bridgeCfg)) {
      const bridged = await tryBridgedCpasCmsRequest(env, request, authUser, {
        path,
        method,
        url,
        siteConfig: { ...bridgeCfg, project_slug: bridgeProjectSlug },
        projectSlug: bridgeProjectSlug,
      });
      if (bridged) return bridged;
    }
  }

  if (siteConfig.cms_hosting === 'client_worker') {
    return jsonResponse(
      {
        error: 'CMS_CLIENT_WORKER_MODE',
        cms_hosting: siteConfig.cms_hosting,
        api_profile: siteConfig.api_profile,
        studio_url: siteConfig.studio_url,
        bridge_prefix:
          siteConfig.api_profile === 'fuel_admin'
            ? '/api/cms/bridge/admin/cms'
            : '/api/cms/bridge/cms',
        message:
          'Use /dashboard/cms or /api/cms/bridge/* — platform PrimeTech D1 is registry-only for this workspace.',
      },
      409,
    );
  }

  const host = bindCmsHostPlatformContext({ env, workspaceId, siteConfig });

  const postBridgeResponse = await dispatchCmsRoutes(POST_BRIDGE_HANDLERS, {
    ...routeState,
    explicitProjectSlug,
    siteConfig,
    host,
  });
  if (postBridgeResponse) return postBridgeResponse;

  return jsonResponse({ error: 'CMS route not found' }, 404);
}
