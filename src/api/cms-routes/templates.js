import { jsonResponse } from '../../core/auth.js';
import { createCmsPage } from '../../core/agentsam/cms/pages/index.js';
import { createD1CmsTemplateStore } from '../../core/agentsam/cms/adapters/cloudflare/d1-template-store.js';
import {
  applyCmsTemplateToPage,
  cmsTemplateNeedsHtmlInstantiate,
  getCmsTemplate,
  listCmsTemplates,
  patchCmsTemplate,
  upsertCmsTemplate,
} from '../../core/agentsam/cms/templates/index.js';
import { listCmsSections, sectionToLegacyRow } from '../../core/agentsam/cms/sections/index.js';
import { CMS_DEFAULT_R2_BUCKET, getCmsR2Binding } from '../../core/agentsam/cms/adapters/cloudflare/storage.js';
import { invalidateCmsBootstrap, logCmsActivity } from '../../core/cms-edit-safety.js';
import { resolveCmsBootstrapProjectSlug } from '../../core/cms-workspace-resolve.js';
import { cmsMarketingSlugSuffix, cmsPageKey } from './route-utils.js';

async function instantiateHtmlTemplate(state, templateId, body) {
  const { url, request, env, ctx, authUser, tenantId, personUuid, workspaceId, cmsScope, pageStore, requestCache } = state;
  let projectSlug = String(body.project_slug || body.project_id || url.searchParams.get('project_slug') || '').trim();
  if (!projectSlug) {
    const resolved = await resolveCmsBootstrapProjectSlug(env, request, authUser, workspaceId, null, requestCache);
    if (resolved.error) return jsonResponse({ error: resolved.error, message: resolved.message }, 400);
    projectSlug = resolved.project_slug;
  }
  if (!cmsScope.allowedSlugs.has(projectSlug)) return jsonResponse({ error: 'CMS_SITE_NOT_ALLOWED', project_slug: projectSlug }, 403);

  const store = createD1CmsTemplateStore(env.DB);
  const lookup = await getCmsTemplate(store, templateId);
  if (!lookup.ok) return jsonResponse({ error: 'Template not found' }, 404);
  const template = lookup.template;
  if (!String(template.source_html_r2_key || '').trim()) {
    return jsonResponse({ error: 'Template has no source_html_r2_key' }, 422);
  }

  let meta = {};
  try { meta = typeof template.template_data === 'string' ? JSON.parse(template.template_data) : template.template_data || {}; } catch { meta = {}; }
  const suffix = cmsMarketingSlugSuffix(6);
  const base = String(template.slug || template.template_name || 'page').toLowerCase().replace(/^marketing-/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const pageSlug = `marketing-${base || 'page'}-${suffix}`;
  const routePath = `/marketing/${pageSlug}`;
  const title = String(meta.title || template.template_name || pageSlug).trim();
  const r2Bucket = CMS_DEFAULT_R2_BUCKET;
  const draftKey = cmsPageKey(workspaceId, projectSlug, pageSlug, 'draft');
  const r2Binding = getCmsR2Binding(env, r2Bucket);
  if (!r2Binding) return jsonResponse({ error: 'R2 storage unavailable' }, 503);
  const srcObj = await r2Binding.get(String(template.source_html_r2_key));
  if (!srcObj) return jsonResponse({ error: 'Template source HTML not found in R2', source_html_r2_key: template.source_html_r2_key }, 404);
  const contentBuffer = await srcObj.arrayBuffer();
  await r2Binding.put(draftKey, contentBuffer, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
  const created = await createCmsPage(cmsScope, {
    id: crypto.randomUUID(),
    project_id: projectSlug,
    project_slug: projectSlug,
    slug: pageSlug,
    title,
    status: 'draft',
    route_path: routePath,
    page_type: 'landing',
    r2_key: draftKey,
    r2_bucket: r2Bucket,
    content_type: 'text/html',
    content_size_bytes: contentBuffer.byteLength,
    metadata_json: { marketing_page: true, template_id: templateId, template_type: template.template_type || 'marketing_page' },
  }, { tenantId, workspaceId, personUuid, userId: authUser.id }, pageStore);
  if (!created.ok) return jsonResponse({ error: created.error }, created.status || 400);
  ctx.waitUntil(logCmsActivity(env, {
    tenantId,
    userId: authUser.id,
    action: 'template_instantiate',
    resourceType: 'page',
    resourceId: created.page.id,
    details: { template_id: templateId, route_path: routePath },
  }));
  invalidateCmsBootstrap(env, ctx, workspaceId, projectSlug);
  return jsonResponse({
    ok: true,
    mode: 'page',
    page: { id: created.page.id, slug: pageSlug, route_path: routePath, title },
    r2_draft_key: draftKey,
  });
}

export async function handleCmsTemplateRoutes(state) {
  const { path, method, url, request, env, ctx, authUser, tenantId, workspaceId, cmsScope, pageStore, sectionStore } = state;
  const store = createD1CmsTemplateStore(env.DB);

  if (path === '/api/cms/templates' && method === 'GET') {
    try {
      const result = await listCmsTemplates(store, { category: url.searchParams.get('category') || null, limit: 5000 });
      return jsonResponse({ templates: result.templates, total: result.total });
    } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }

  const templateIdMatch = path.match(/^\/api\/cms\/templates\/([^/]+)$/);
  if (templateIdMatch && method === 'PATCH') {
    let body = {};
    try { body = await request.json(); } catch { return jsonResponse({ error: 'invalid JSON' }, 400); }
    try {
      const result = await patchCmsTemplate(store, decodeURIComponent(templateIdMatch[1]), body);
      if (!result.ok) return jsonResponse({ error: result.error === 'template_not_found' ? 'template not found' : 'no fields to update' }, result.status || 400);
      return jsonResponse({ ok: true, template: result.template });
    } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }

  if (path === '/api/cms/imports' && method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch { return jsonResponse({ error: 'invalid JSON' }, 400); }
    const sourceType = String(body.source_type || 'html_drop').trim();
    const projectSlug = String(body.project_slug || body.projectSlug || '').trim();
    const files = Array.isArray(body.files) ? body.files : [];
    return jsonResponse({ ok: true, queued: true, source_type: sourceType, project_slug: projectSlug || null, file_count: files.length, message: 'Import received. Agent Sam will parse, tag, and remaster dropped assets into CMS blocks.' });
  }

  if (path === '/api/cms/templates' && method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch { return jsonResponse({ error: 'invalid JSON' }, 400); }
    try {
      const result = await upsertCmsTemplate(store, body);
      if (!result.ok) return jsonResponse({ error: 'template_name required' }, result.status || 400);
      return jsonResponse({ success: true, id: result.template.id, slug: result.template.slug });
    } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }

  const applyOrInstantiate = path.match(/^\/api\/cms\/templates\/([^/]+)\/(apply|instantiate)$/);
  if (applyOrInstantiate && method === 'POST') {
    const templateId = decodeURIComponent(applyOrInstantiate[1]);
    const action = applyOrInstantiate[2];
    let body = {};
    try { body = await request.json(); } catch { body = {}; }

    try {
      const lookup = await getCmsTemplate(store, templateId);
      if (!lookup.ok) return jsonResponse({ error: 'Template not found' }, 404);
      const template = lookup.template;

      if (action === 'instantiate' || cmsTemplateNeedsHtmlInstantiate(template)) {
        return instantiateHtmlTemplate(state, templateId, body);
      }

      const pageId = String(body.page_id || body.pageId || '').trim();
      if (!pageId) return jsonResponse({ error: 'page_id_required' }, 400);
      const listed = await listCmsSections(cmsScope, pageId, pageStore, sectionStore);
      const sortOrder = listed?.ok ? ((listed.sections?.length || 0) + 1) * 10 : 50;
      const applied = await applyCmsTemplateToPage(store, {
        templateId,
        pageId,
        scope: cmsScope,
        pageStore,
        sectionStore,
        sortOrder,
      });
      if (!applied.ok) return jsonResponse({ error: applied.error || 'apply_failed' }, applied.status || 400);

      const projectSlug = String(applied.page?.project_slug || applied.page?.project_id || '').trim();
      ctx.waitUntil(logCmsActivity(env, {
        tenantId,
        userId: authUser.id,
        action: 'template_apply',
        resourceType: 'section',
        resourceId: applied.section.id,
        details: { template_id: templateId, page_id: pageId, mode: 'section' },
      }));
      if (projectSlug) invalidateCmsBootstrap(env, ctx, workspaceId, projectSlug);
      return jsonResponse({
        ok: true,
        mode: 'section',
        template_id: templateId,
        section: sectionToLegacyRow(applied.section),
        page_id: pageId,
      });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  return null;
}
