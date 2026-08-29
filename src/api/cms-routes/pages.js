import { jsonResponse } from '../../core/auth.js';
import {
  archiveCmsPage, createCmsPage, getCmsPage, listCmsPages, normalizeCmsPageCreateInput,
  restoreCmsPage, updateCmsPage,
} from '../../core/agentsam/cms/pages/index.js';
import { createCmsSection, sectionToLegacyRow } from '../../core/agentsam/cms/sections/index.js';
import {
  buildCmsPageUrls, cmsPreviewModelToLegacy, loadCmsPreviewByPageId, normalizeCmsPreviewMode,
} from '../../core/agentsam/cms/preview/index.js';
import { getCmsR2Binding } from '../../core/agentsam/cms/adapters/cloudflare/storage.js';
import { bindCmsHostPlatformContext } from '../cms-host-platform-bind.js';
import { resolveCmsSitePublicDomain } from '../../core/cms-public-domain.js';
import { resolveCmsSiteConfig } from '../../core/cms-site-config.js';
import { hydrateCmsRoutePageHtml, normalizeCmsRoutePath } from '../../core/cms-page-hydrate-dispatch.js';
import { renderCmsSectionTreeHtmlWithInjections } from '../../core/cms-injected-sections.js';
import {
  auditCmsMutation, flushCmsDraftToD1, invalidateCmsBootstrap, logCmsActivity,
  renderCmsSectionTreeHtml, stageCmsDraftKv,
} from '../../core/cms-edit-safety.js';
import { touchCmsLiveEditSession } from '../../core/cms-live-edit-session.js';
import { saveCmsPageContentDraft, writeCmsDraftHtmlToR2 } from '../../core/cms-draft-artifact-host.js';
import { executeCmsPagePublish } from '../../core/cms-agent-publish.ts';
import { cmsMutationMeta, presignR2GetObjectUrl } from './route-utils.js';

export async function handleCmsPageRoutes(state) {
  const {
    path, method, url, request, env, ctx, authUser, pathParts,
    tenantId, personUuid, workspaceId, cmsScope, pageStore, sectionStore, previewStore, host, siteConfig,
  } = state;
  if (path === '/api/cms/pages' && method === 'GET') {
    const projectId = url.searchParams.get('project_id');
    try {
      const result = await listCmsPages(cmsScope, { projectSlug: projectId || null }, pageStore);
      if (!result.ok) return jsonResponse({ error: result.error, project_id: projectId || null }, result.status || 400);
      return jsonResponse({ pages: result.pages });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  const pagePreviewUrlsMatch = path.match(/^\/api\/cms\/pages\/([^/]+)\/preview-urls$/);
  if (pagePreviewUrlsMatch && method === 'GET') {
    const pageId = pagePreviewUrlsMatch[1];
    try {
      const pageResult = await getCmsPage(cmsScope, pageId, pageStore);
      const page = pageResult.ok ? pageResult.page : null;
      if (!page) return jsonResponse({ error: 'Page not found' }, 404);
      const projectSlug = String(page.project_slug || page.project_id || '').trim();
      const resolved = await resolveCmsSitePublicDomain(env, projectSlug, { workspaceId });
      return jsonResponse({
        page_id: pageId,
        public_domain: resolved?.domain || null,
        domain_source: resolved?.source || null,
        ...buildCmsPageUrls(page, {
          domain: resolved?.domain || null,
        }),
      });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  /**
   * GET /api/cms/pages/:id
   * Return metadata + presigned R2 URL for content.
   */
  const pageIdMatch = path.match(/^\/api\/cms\/pages\/([^/]+)$/);
  if (pageIdMatch && method === 'GET') {
    const pageId = pageIdMatch[1];
    const requestedPreviewMode = normalizeCmsPreviewMode(url.searchParams.get('preview')) || (url.searchParams.get('draft') === '1' ? 'draft' : 'published');
    const useDraft = requestedPreviewMode === 'draft';
    const projectSlugParam = String(url.searchParams.get('project_slug') || '').trim();
    try {
      const pageResult = await getCmsPage(cmsScope, pageId, pageStore, projectSlugParam || null);
      const page = pageResult.ok ? pageResult.page : null;

      if (!page) return jsonResponse({ error: 'Page not found' }, 404);

      const pagePublicDomain = await resolveCmsSitePublicDomain(env, String(page.project_slug || page.project_id || '').trim(), { workspaceId });

      const hostArtifact = host.resolvePageArtifact(page);
      const htmlKeys = hostArtifact.layout;
      const assetDef = hostArtifact.asset;
      const assetBucket = hostArtifact.bucket;
      let contentUrl = null;
      const publishedKey = hostArtifact.publishedKey;
      if (publishedKey) {
        contentUrl = await presignR2GetObjectUrl(env, assetBucket, publishedKey);
      }

      const previewModel = await loadCmsPreviewByPageId(pageId, {
        previewMode: requestedPreviewMode,
        userId: authUser.id,
      }, previewStore);
      const previewLegacy = previewModel ? cmsPreviewModelToLegacy(previewModel) : null;
      const sections = previewLegacy?.sections || [];
      const componentsBySection = previewLegacy?.componentsBySection || {};
      const activeDraft = previewLegacy?.draftData || null;
      const r2BindingPreview = getCmsR2Binding(env, assetBucket);
      let preview_html = r2BindingPreview
        ? await renderCmsSectionTreeHtmlWithInjections(
            sections,
            componentsBySection,
            r2BindingPreview,
          )
        : renderCmsSectionTreeHtml(sections, componentsBySection);

      if (assetDef && r2BindingPreview) {
        const assetRead = await host.readPageArtifact(
          r2BindingPreview,
          hostArtifact,
          useDraft ? 'draft' : 'published',
        );
        if (assetRead.html) {
          if (assetDef.hydrate) {
            const route = normalizeCmsRoutePath(assetDef.route);
            preview_html = await hydrateCmsRoutePageHtml(
              assetRead.html,
              route,
              sections,
              r2BindingPreview,
            );
          } else {
            preview_html = assetRead.html;
          }
        }
      }

      let draftContentUrl = null;
      if (useDraft && htmlKeys.draft_key) {
        draftContentUrl = await presignR2GetObjectUrl(env, assetBucket, htmlKeys.draft_key);
      }

      const routePath = String(page.route_path || `/${page.slug || ''}`).trim() || '/';
      const previewUrls = buildCmsPageUrls(page, {
        domain: pagePublicDomain?.domain || null,
        projectSlug: page.project_slug || page.project_id || null,
      });
      const liveUrl = previewUrls.live_url;

      return jsonResponse({
        page: {
          ...page,
          storefront_edit_mode: htmlKeys.mode,
          storefront_asset_r2_key: assetDef?.r2_key || null,
          storefront_hydrate: assetDef?.hydrate === true,
        },
        content_url: useDraft && draftContentUrl ? draftContentUrl : contentUrl,
        preview_html,
        preview_mode: previewModel?.mode || requestedPreviewMode,
        live_url: liveUrl,
        preview_urls: previewUrls,
        r2_key: useDraft ? htmlKeys.draft_key : publishedKey,
        storefront_edit_mode: htmlKeys.mode,
        storefront_asset: assetDef
          ? {
              route_path: normalizeCmsRoutePath(assetDef.route),
              r2_key: assetDef.r2_key,
              draft_key: htmlKeys.draft_key,
              hydrate: assetDef.hydrate === true,
              chrome: assetDef.chrome === true,
            }
          : null,
        sections,
        components_by_section: componentsBySection,
        active_draft: activeDraft,
      });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  const draftPageMatch = path.match(/^\/api\/cms\/pages\/([^/]+)\/draft$/);
  if (draftPageMatch && (method === 'GET' || method === 'PUT')) {
    const pageId = draftPageMatch[1];
    try {
      const pageResult = await getCmsPage(cmsScope, pageId, pageStore);
      const page = pageResult.ok ? pageResult.page : null;
      if (!page) return jsonResponse({ error: 'Page not found' }, 404);

      if (method === 'GET') {
        const draftRecord = await previewStore.getDraftRecord(pageId, authUser.id);
        return jsonResponse({
          page_id: pageId,
          draft_data: draftRecord.draftData,
          source: draftRecord.source,
          updated_at: draftRecord.updatedAt,
        });
      }

      let body = {};
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
      }
      const draftData = body.draft_data ?? body.draftData ?? body;
      const flush = body.flush === true || body.flush === 1;
      const meta = cmsMutationMeta(authUser, request);
      if (body.agent_applied === true) meta.agentApplied = true;

      await stageCmsDraftKv(env, {
        pageId,
        userId: authUser.id,
        payload: typeof draftData === 'object' ? draftData : { content: draftData },
      });

      let flushed = null;
      let draftR2 = null;
      if (flush) {
        flushed = await flushCmsDraftToD1(env, {
          pageId,
          userId: authUser.id,
          draftData: typeof draftData === 'object' ? draftData : { content: draftData },
        });
        draftR2 = await writeCmsDraftHtmlToR2(env, {
          workspaceId,
          page,
          userId: authUser.id,
          draftData: typeof draftData === 'object' ? draftData : { content: draftData },
        });
      }

      await touchCmsLiveEditSession(env, { pageId, userId: authUser.id });

      const projectSlug = String(page.project_slug || page.project_id || '').trim();
      ctx.waitUntil(
        logCmsActivity(env, {
          tenantId,
          userId: authUser.id,
          action: flush ? 'draft_flush' : 'draft_save',
          resourceType: 'draft',
          resourceId: pageId,
          details: { flushed: !!flushed?.ok },
        }),
      );
      auditCmsMutation(env, ctx, {
        workspaceId,
        tenantId,
        userId: authUser.id,
        projectSlug,
        pageId,
        sectionId: body.section_id || 'draft',
        agentApplied: meta.agentApplied,
        routeKey: meta.routeKey,
        changeSetId: body.change_set_id || null,
      });
      invalidateCmsBootstrap(env, ctx, workspaceId, projectSlug);

      return jsonResponse({
        success: true,
        page_id: pageId,
        kv_draft_key: `cms:draft:${pageId}:${authUser.id}`,
        flushed: !!flushed?.ok,
        r2_draft_key: draftR2?.r2_key || null,
      });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  /**
   * POST /api/cms/pages
   * Create a new page.
   */
  if (path === '/api/cms/pages' && method === 'POST') {
    const body = await request.json();
    const { project_id, slug, title, content, content_type = 'text/html', route_path } = body;

    if (!project_id || !slug || !title) {
      return jsonResponse({ error: 'project_id, slug, and title are required' }, 400);
    }
    if (!cmsScope.allowedSlugs.has(String(project_id).trim())) {
      return jsonResponse({ error: 'CMS_SITE_NOT_ALLOWED', project_id }, 403);
    }

    const normalizedRoute =
      String(route_path || `/${slug}`).trim().startsWith('/')
        ? String(route_path || `/${slug}`).trim()
        : `/${String(route_path || slug).trim()}`;

    const pageType = String(body.page_type || 'custom').trim() || 'custom';
    const pageStatus = String(body.status || 'draft').trim() === 'published' ? 'published' : 'draft';
    const seoTitle = String(body.seo_title || title || '').trim();
    const metaDescription = String(body.meta_description || `${title} — ${project_id}`).trim();

    const projectSlugTrimmed = String(project_id).trim();
    const createHost =
      projectSlugTrimmed === String(siteConfig?.project_slug || '').trim()
        ? host
        : bindCmsHostPlatformContext({
            env,
            workspaceId,
            siteConfig: await resolveCmsSiteConfig(env, workspaceId, projectSlugTrimmed),
          });
    const provision = createHost.pageCreateProvision({
      workspaceId,
      projectSlug: String(project_id).trim(),
      slug,
      status: pageStatus,
    });
    const initialSections =
      Array.isArray(body.sections) && body.sections.length
        ? body.sections
        : provision.defaultSections;

    const createPreflight = normalizeCmsPageCreateInput({
      project_id,
      slug,
      title,
      status: pageStatus,
      route_path: normalizedRoute,
      page_type: pageType,
      seo_title: seoTitle,
      meta_description: metaDescription,
    });
    if (!createPreflight.ok) return jsonResponse({ error: createPreflight.error }, 400);
    if (await pageStore.routeExists(cmsScope, project_id, createPreflight.page.route_path, null)) {
      return jsonResponse({ error: 'route_exists' }, 409);
    }

    const r2Bucket = provision.r2Bucket;
    const pageId = crypto.randomUUID();
    const pageR2Key =
      provision.layout === 'platform_storefront'
        ? provision.publishedR2Key
        : pageStatus === 'published'
          ? provision.publishedR2Key
          : provision.draftR2Key;
    const r2Binding = getCmsR2Binding(env, r2Bucket);

    if (!r2Binding) return jsonResponse({ error: 'R2 storage unavailable' }, 503);

    try {
      let contentBuffer;
      if (provision.scaffoldHtmlFromSections && initialSections.length) {
        const scaffoldHtml = renderCmsSectionTreeHtml(
          initialSections.map((sec, i) => ({
            section_type: sec.section_type || sec.type || 'custom',
            section_name: sec.section_name || sec.name || sec.section_type || sec.type || `section-${i + 1}`,
            section_data: sec.section_data ?? sec.data ?? {},
            sort_order: Number(sec.sort_order ?? (i + 1) * 10),
            is_visible: sec.is_visible === 0 || sec.is_visible === false ? 0 : 1,
          })),
          {},
        );
        contentBuffer = new TextEncoder().encode(scaffoldHtml);
      } else {
        contentBuffer = new TextEncoder().encode(content || '');
      }

      await r2Binding.put(provision.r2Key, contentBuffer, {
        httpMetadata: { contentType: provision.contentType || content_type },
      });
      if (provision.mirrorPublishedToDraftOnCreate && provision.draftR2Key) {
        await r2Binding.put(provision.draftR2Key, contentBuffer, {
          httpMetadata: { contentType: provision.contentType || content_type },
        });
      }

      const createResult = await createCmsPage(
        cmsScope,
        {
          id: pageId,
          project_id,
          slug,
          title,
          status: pageStatus,
          route_path: normalizedRoute,
          page_type: pageType,
          seo_title: seoTitle,
          meta_description: metaDescription,
          r2_key: pageR2Key,
          r2_bucket: r2Bucket,
          content_type: provision.contentType || content_type,
          content_size_bytes: contentBuffer.byteLength,
        },
        { tenantId, workspaceId, personUuid, userId: authUser.id },
        pageStore,
      );
      if (!createResult.ok) {
        return jsonResponse({ error: createResult.error }, createResult.status || 400);
      }
      const createdSections = [];
      for (let i = 0; i < initialSections.length; i++) {
        const sec = initialSections[i] || {};
        const result = await createCmsSection(
          cmsScope,
          {
            ...sec,
            id: String(sec.id || '').trim() || undefined,
            page_id: pageId,
            section_type: sec.section_type || sec.type || 'custom',
            section_name: sec.section_name || sec.name || sec.section_type || sec.type || 'custom',
            section_data: sec.section_data ?? sec.data ?? {},
            sort_order: Number(sec.sort_order ?? (i + 1) * 10),
          },
          pageStore,
          sectionStore,
        );
        if (!result.ok) return jsonResponse({ error: result.error }, result.status || 400);
        createdSections.push(sectionToLegacyRow(result.section));
      }

      if (provision.layout === 'platform_storefront') {
        await writeCmsDraftHtmlToR2(env, {
          workspaceId,
          page: {
            id: pageId,
            slug,
            title,
            route_path: normalizedRoute,
            project_slug: project_id,
            project_id,
            r2_key: pageR2Key,
            r2_bucket: r2Bucket,
            status: pageStatus,
            content_type: provision.contentType || content_type,
          },
          userId: authUser.id,
        }).catch(() => null);
      }

      invalidateCmsBootstrap(env, ctx, workspaceId, project_id);

      return jsonResponse({
        success: true,
        id: pageId,
        r2_key: pageR2Key,
        draft_r2_key: provision.draftR2Key || null,
        route_path: normalizedRoute,
        status: pageStatus,
        sections: createdSections,
        preview_urls: buildCmsPageUrls(
          { id: pageId, slug, route_path: normalizedRoute, project_slug: project_id },
          { projectSlug: project_id },
        ),
      });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  /**
   * PUT /api/cms/pages/:id
   * Update page content (saved as draft).
   */
  if (pageIdMatch && method === 'PUT') {
    const pageId = pageIdMatch[1];
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    if (!('content' in body)) {
      try {
        const result = await updateCmsPage(cmsScope, pageId, body, { userId: authUser.id }, pageStore);
        if (!result.ok) return jsonResponse({ error: result.error }, result.status || 400);
        const projectSlug = String(result.page.project_slug || result.page.project_id || '').trim();
        if (projectSlug) invalidateCmsBootstrap(env, ctx, workspaceId, projectSlug);
        return jsonResponse({
          success: true,
          id: pageId,
          page: result.page,
          preview_urls: buildCmsPageUrls(result.page, { projectSlug }),
        });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    const { title, content, content_type = 'text/html' } = body;

    try {
      const pageResult = await getCmsPage(cmsScope, pageId, pageStore);
      const page = pageResult.ok ? pageResult.page : null;

      if (!page) return jsonResponse({ error: 'Page not found' }, 404);

      const saved = await saveCmsPageContentDraft(env, {
        workspaceId,
        page,
        userId: authUser.id,
        title: title || null,
        content,
        contentType: content_type,
      });
      if (!saved.ok) return jsonResponse({ error: saved.error }, saved.error === 'R2 storage unavailable' ? 503 : 400);
      return jsonResponse({ success: true, ...saved });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  /**
   * POST /api/cms/pages/:id/publish
   * Copy draft R2 object to published path.
   */
  const pagePublishMatch = path.match(/^\/api\/cms\/pages\/([^/]+)\/publish$/);
  if (pagePublishMatch && method === 'POST') {
    const pageId = pagePublishMatch[1];
    let projectSlug = '';
    try {
      const pageResult = await getCmsPage(cmsScope, pageId, pageStore);
      const page = pageResult.ok ? pageResult.page : null;
      if (!page) return jsonResponse({ error: 'Page not found' }, 404);

      projectSlug = String(page.project_slug || page.project_id || '').trim();

      const result = await executeCmsPagePublish(env, {
        pageId,
        page,
        workspaceId,
        tenantId,
        userId: authUser.id,
        executionCtx: ctx,
        agentApplied: false,
      });

      if (!result.ok) {
        if (result.error === 'publish_in_progress') {
          return jsonResponse({ error: 'publish_in_progress', holder: result.holder || null }, 409);
        }
        if (result.error === 'publish_gate_blocked') {
          return jsonResponse(
            {
              error: result.error,
              contract: result.contract,
              promotion: result.promotion,
              blocked: result.blocked,
            },
            422,
          );
        }
        const status = result.error === 'R2 storage unavailable' ? 503 : 400;
        return jsonResponse({ error: result.error }, status);
      }

      return jsonResponse({
        success: true,
        status: result.status,
        phase: result.phase,
        r2_key: result.r2_key,
        r2_bucket: result.r2_bucket,
        bootstrap_cache_key: result.bootstrap_cache_key,
        override_chain: result.override_chain,
        revision: result.revision || null,
        preview_urls: result.preview_urls,
        live_url: result.live_url,
      });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  /**
   * DELETE /api/cms/pages/:id
   * Soft delete page.
   */
  if (pageIdMatch && method === 'DELETE') {
    const pageId = pageIdMatch[1];
    try {
      const result = await archiveCmsPage(cmsScope, pageId, { userId: authUser.id }, pageStore);
      if (!result.ok) return jsonResponse({ error: result.error }, result.status || 400);
      const projectSlug = String(result.page.project_slug || result.page.project_id || '').trim();
      if (projectSlug) invalidateCmsBootstrap(env, ctx, workspaceId, projectSlug);
      return jsonResponse({ success: true, status: 'archived', page: result.page });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  const restorePageMatch = path.match(/^\/api\/cms\/pages\/([^/]+)\/restore$/);
  if (restorePageMatch && method === 'POST') {
    const pageId = restorePageMatch[1];
    try {
      const result = await restoreCmsPage(cmsScope, pageId, { userId: authUser.id }, pageStore);
      if (!result.ok) return jsonResponse({ error: result.error }, result.status || 400);
      const projectSlug = String(result.page.project_slug || result.page.project_id || '').trim();
      if (projectSlug) invalidateCmsBootstrap(env, ctx, workspaceId, projectSlug);
      return jsonResponse({ success: true, status: result.page.status, page: result.page });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }




  return null;
}
