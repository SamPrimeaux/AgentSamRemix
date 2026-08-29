import { jsonResponse } from '../../core/auth.js';
import { fetchCmsPageInScope } from '../../core/cms-access.js';
import { auditCmsMutation, invalidateCmsBootstrap, logCmsActivity } from '../../core/cms-edit-safety.js';
import { createCmsPageRevision, listCmsPageRevisions, restoreCmsPageRevision } from '../../core/agentsam/cms/lifecycle/index.js';

function cmsPageKey(workspaceId, projectId, slug, variant) {
  return `cms/${workspaceId}/${projectId}/${slug}/${variant}.html`;
}

export async function handleCmsRevisionRoutes(state) {
  const { path, method, request, env, ctx, authUser, tenantId, workspaceId, cmsScope, lifecycleStore } = state;
  if (path.match(/^\/api\/cms\/pages\/[^/]+\/rollbacks$/) && method === 'GET') {
    const pageId = path.split('/')[4];
    try {
      const page = await fetchCmsPageInScope(env, pageId, cmsScope);
      if (!page) return jsonResponse({ error: 'Page not found' }, 404);
      const result = await listCmsPageRevisions(lifecycleStore, pageId, { limit: 20 });
      const rollbacks = result.revisions.map((revision) => ({ id: revision.id, page_id: revision.page_id, slug: page.slug, previous_r2_key: revision.artifact_key, deployed_html_hash: revision.content_hash, created_at: revision.created_at }));
      return jsonResponse({ rollbacks, revisions: result.revisions });
    } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }
  if (path.match(/^\/api\/cms\/pages\/[^/]+\/snapshot$/) && method === 'POST') {
    const pageId = path.split('/')[4];
    try {
      const page = await fetchCmsPageInScope(env, pageId, cmsScope);
      if (!page) return jsonResponse({ error: 'Page not found' }, 404);
      const result = await createCmsPageRevision(lifecycleStore, { page, workspaceId, createdAt: Math.floor(Date.now() / 1000) });
      ctx.waitUntil(logCmsActivity(env, { tenantId, userId: authUser.id, action: 'snapshot', resourceType: 'revision', resourceId: result.revision.id, details: { previous_r2_key: result.revision.artifact_key } }));
      return jsonResponse({ success: true, id: result.revision.id, previous_r2_key: result.revision.artifact_key, revision: result.revision });
    } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }
  if (path === '/api/cms/rollback' && method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    const { rollback_id, page_id } = body;
    if (!rollback_id || !page_id) return jsonResponse({ error: 'rollback_id and page_id required' }, 400);
    try {
      const page = await fetchCmsPageInScope(env, page_id, cmsScope);
      if (!page) return jsonResponse({ error: 'Page not found' }, 404);
      const result = await restoreCmsPageRevision(lifecycleStore, { page, revisionId: rollback_id, publishedKey: cmsPageKey(workspaceId, page.project_id, page.slug, 'published'), now: Math.floor(Date.now() / 1000) });
      if (!result.ok) return jsonResponse({ error: 'Rollback not found' }, 404);
      const projectSlug = String(page.project_slug || page.project_id || '').trim();
      invalidateCmsBootstrap(env, ctx, workspaceId, projectSlug);
      auditCmsMutation(env, ctx, { workspaceId, tenantId, userId: authUser.id, projectSlug, pageId: page_id, sectionId: 'rollback' });
      ctx.waitUntil(logCmsActivity(env, { tenantId, userId: authUser.id, action: 'rollback', resourceType: 'page', resourceId: page_id, details: { rollback_id, previous_r2_key: result.revision.artifact_key, restored_r2_key: result.restored_r2_key } }));
      return jsonResponse({ success: true, page_id, previous_r2_key: result.revision.artifact_key, restored_r2_key: result.restored_r2_key, r2_restored: result.r2_restored, revision: result.revision });
    } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }
  return null;
}
