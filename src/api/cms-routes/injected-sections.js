import { jsonResponse } from '../../core/responses.js';
import { fetchCmsPageInScope } from '../../core/cms-access.js';
import { cmsBootstrapKey } from '../../core/cms-kv-cache.js';
import { createCmsSection, getCmsSection, listCmsSections, sectionToLegacyRow, updateCmsSection } from '../../core/agentsam/cms/sections/index.js';
import { CMS_DEFAULT_R2_BUCKET, getCmsR2Binding } from '../../core/agentsam/cms/adapters/cloudflare/storage.js';
import { isFullHtmlDocument, normalizeFullPageHtml } from '../../core/cms-injected-sections.js';
import { invalidateCmsBootstrap, logCmsActivity } from '../../core/cms-edit-safety.js';
import { writeCmsDraftHtmlToR2 } from '../../core/cms-draft-artifact-host.js';
import { cmsContentSha256, cmsR2PublicUrlFromRequest, cmsSectionHtmlKey, presignR2GetObjectUrl } from './route-utils.js';

export async function handleCmsInjectedSectionRoutes(state) {
  const { path, method, request, env, ctx, authUser, tenantId, workspaceId, cmsScope, pageStore, sectionStore, host } = state;
  if (path === '/api/cms/sections/save-injected' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid JSON' }, 400);
    }
    const pageId = String(body.page_id || '').trim();
    const sectionName = String(body.section_name || '').trim();
    const sectionType = String(body.section_type || body.sectionType || 'custom').trim();
    const html = body.html != null ? String(body.html) : '';
    const projectSlug = String(body.project_slug || body.projectSlug || '').trim();
    const explicitSectionId = String(body.section_id || body.sectionId || '').trim();
    const position = String(body.position || 'end').trim();
    if (!pageId || !sectionName) {
      return jsonResponse({ error: 'page_id and section_name required' }, 400);
    }
    if (!html.trim()) return jsonResponse({ error: 'html required' }, 400);
    if (html.length > 512_000) {
      return jsonResponse({ error: 'html exceeds 512KB limit' }, 413);
    }
    try {
      const page = await fetchCmsPageInScope(env, pageId, cmsScope, projectSlug || null);
      if (!page) return jsonResponse({ error: 'Page not found' }, 404);
      if (projectSlug && !cmsScope.allowedSlugs.has(projectSlug)) {
        return jsonResponse({ error: 'CMS_SITE_NOT_ALLOWED', project_slug: projectSlug }, 403);
      }
      const pageSlug = String(page.slug || page.route_path || pageId).replace(/^\//, '') || 'page';
      const hash = await cmsContentSha256(html);
      const r2Key = cmsSectionHtmlKey(pageSlug, sectionName, hash);
      // Write into the same R2 bucket the page HTML uses so storefront hydrate finds fragments.
      const hostArtifact = host.resolvePageArtifact(page);
      const r2Bucket = hostArtifact.bucket;
      const r2Binding = getCmsR2Binding(env, r2Bucket);
      if (!r2Binding) return jsonResponse({ error: 'R2 storage unavailable' }, 503);
      const putOpts = { httpMetadata: { contentType: 'text/html; charset=utf-8' } };
      const encoded = new TextEncoder().encode(html);
      await r2Binding.put(r2Key, encoded, putOpts);
      // Dual-write to CMS catalog bucket when page lives on ASSETS so templates/catalog stay in sync.
      if (r2Bucket !== CMS_DEFAULT_R2_BUCKET) {
        const cmsBinding = getCmsR2Binding(env, CMS_DEFAULT_R2_BUCKET);
        if (cmsBinding) {
          await cmsBinding.put(r2Key, encoded, putOpts).catch(() => null);
        }
      }
      const publicUrl =
        (await presignR2GetObjectUrl(env, r2Bucket, r2Key)) ||
        cmsR2PublicUrlFromRequest(request, r2Bucket, r2Key);
      const zone = String(body.zone || body.section_zone || '').trim();
      const sectionData = {
        r2_key: r2Key,
        r2_bucket: r2Bucket,
        public_url: publicUrl,
        html_source: 'injected',
        inject_position: position,
        content_sha256: hash,
        updated_at: Math.floor(Date.now() / 1000),
        full_page_document: isFullHtmlDocument(html),
        ...(zone ? { zone } : {}),
      };
      const payload = JSON.stringify(sectionData);

      let sectionId = explicitSectionId;
      let existing = null;
      if (sectionId) {
        const existingResult = await getCmsSection(cmsScope, sectionId, pageStore, sectionStore);
        if (existingResult.ok && existingResult.section.page_id === pageId) existing = existingResult.section;
      }
      if (!existing) {
        const sectionsResult = await listCmsSections(cmsScope, pageId, pageStore, sectionStore);
        if (sectionsResult.ok) existing = sectionsResult.sections.find((item) => item.name === sectionName) || null;
      }

      let sectionResult;
      if (existing?.id) {
        sectionId = existing.id;
        sectionResult = await updateCmsSection(
          cmsScope,
          sectionId,
          { section_data: sectionData, section_type: sectionType },
          pageStore,
          sectionStore,
        );
        if (!sectionResult.ok) return jsonResponse({ error: sectionResult.error }, sectionResult.status || 400);
        ctx.waitUntil(logCmsActivity(env, { tenantId, userId: authUser.id, action: 'section_inject_update', resourceType: 'section', resourceId: sectionId, details: { r2_key: r2Key, section_name: sectionName } }));
      } else {
        const sortOrder = typeof body.sort_order === 'number' ? body.sort_order : position === 'start' ? 5 : Number(body.sort_order ?? 50);
        sectionResult = await createCmsSection(
          cmsScope,
          { id: sectionId || undefined, page_id: pageId, section_type: sectionType, section_name: sectionName, section_data: sectionData, sort_order: sortOrder, is_visible: 1 },
          pageStore,
          sectionStore,
        );
        if (!sectionResult.ok) return jsonResponse({ error: sectionResult.error }, sectionResult.status || 400);
        sectionId = sectionResult.section.id;
        ctx.waitUntil(logCmsActivity(env, { tenantId, userId: authUser.id, action: 'section_inject_create', resourceType: 'section', resourceId: sectionId, details: { r2_key: r2Key, section_name: sectionName } }));
      }

      const section = sectionToLegacyRow(sectionResult.section);
      const ps = projectSlug || page.project_slug || page.project_id || null;
      if (ps) invalidateCmsBootstrap(env, ctx, workspaceId, ps);
      await writeCmsDraftHtmlToR2(env, {
        workspaceId,
        page,
        userId: authUser.id,
        fullPageHtml: isFullHtmlDocument(html) ? normalizeFullPageHtml(html) : undefined,
      }).catch(() => null);
      return jsonResponse({
        success: true,
        section: {
          ...section,
          section_data: sectionData,
        },
        r2_key: r2Key,
        public_url: publicUrl,
        created: !existing?.id,
      });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  if (path === '/api/cms/sections/upload-html' && method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid JSON' }, 400);
    }
    const pageId = String(body.page_id || '').trim();
    const sectionName = String(body.section_name || '').trim();
    const html = body.html != null ? String(body.html) : '';
    const projectSlug = String(body.project_slug || '').trim();
    if (!pageId || !sectionName) {
      return jsonResponse({ error: 'page_id and section_name required' }, 400);
    }
    if (!html.trim()) return jsonResponse({ error: 'html required' }, 400);
    try {
      const page = await fetchCmsPageInScope(env, pageId, cmsScope, projectSlug || null);
      if (!page) return jsonResponse({ error: 'Page not found' }, 404);
      if (projectSlug && !cmsScope.allowedSlugs.has(projectSlug)) {
        return jsonResponse({ error: 'CMS_SITE_NOT_ALLOWED', project_slug: projectSlug }, 403);
      }
      const pageSlug = String(page.slug || page.route_path || pageId).replace(/^\//, '');
      const hash = await cmsContentSha256(html);
      const r2Key = cmsSectionHtmlKey(pageSlug, sectionName, hash);
      const hostArtifact = host.resolvePageArtifact(page);
      const r2Bucket = hostArtifact.bucket;
      const r2Binding = getCmsR2Binding(env, r2Bucket);
      if (!r2Binding) return jsonResponse({ error: 'R2 storage unavailable' }, 503);
      const contentBuffer = new TextEncoder().encode(html);
      const putOpts = { httpMetadata: { contentType: 'text/html; charset=utf-8' } };
      await r2Binding.put(r2Key, contentBuffer, putOpts);
      if (r2Bucket !== CMS_DEFAULT_R2_BUCKET) {
        const cmsBinding = getCmsR2Binding(env, CMS_DEFAULT_R2_BUCKET);
        if (cmsBinding) await cmsBinding.put(r2Key, contentBuffer, putOpts).catch(() => null);
      }
      const publicUrl =
        (await presignR2GetObjectUrl(env, r2Bucket, r2Key)) ||
        cmsR2PublicUrlFromRequest(request, r2Bucket, r2Key);
      const ps = projectSlug || page.project_slug || page.project_id || null;
      if (env.SESSION_CACHE && ps) {
        ctx.waitUntil(env.SESSION_CACHE.delete(cmsBootstrapKey(workspaceId, ps)).catch(() => {}));
      }
      return jsonResponse({ r2_key: r2Key, public_url: publicUrl });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }






  return null;
}
