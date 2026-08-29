import { jsonResponse } from '../../core/auth.js';
import { getCmsPage } from '../../core/agentsam/cms/pages/index.js';
import { publishCmsOverrideRevision, upsertCmsOverrideDraft } from '../../core/agentsam/cms/lifecycle/index.js';
import { clearCmsDraftHotCache, flushCmsDraftToD1, invalidateCmsBootstrap, logCmsActivity } from '../../core/cms-edit-safety.js';
import { joinCmsLiveEditSession, leaveCmsLiveEditSession, touchCmsLiveEditSession } from '../../core/cms-live-edit-session.js';

export async function handleCmsLiveLifecycleRoutes(state) {
  const { path, method, url, request, env, ctx, authUser, tenantId, workspaceId, cmsScope, pageStore, lifecycleStore } = state;
  if (path === '/api/cms/live-session/join' && method === 'POST') {
    let body = {}; try { body = await request.json(); } catch { return jsonResponse({ error: 'invalid JSON' }, 400); }
    const pageId = String(body.page_id || body.pageId || '').trim();
    if (!pageId) return jsonResponse({ error: 'page_id required' }, 400);
    const result = await joinCmsLiveEditSession(env, { pageId, userId: authUser.id, workspaceId, tenantId });
    return result.ok ? jsonResponse(result) : jsonResponse({ error: result.error || 'join_failed' }, 404);
  }
  if (path === '/api/cms/live-session/heartbeat' && method === 'POST') {
    let body = {}; try { body = await request.json(); } catch { return jsonResponse({ error: 'invalid JSON' }, 400); }
    const pageId = String(body.page_id || body.pageId || '').trim();
    if (!pageId) return jsonResponse({ error: 'page_id required' }, 400);
    await touchCmsLiveEditSession(env, { pageId, userId: authUser.id });
    return jsonResponse({ ok: true, page_id: pageId });
  }
  if (path === '/api/cms/live-session/leave' && method === 'POST') {
    let body = {}; try { body = await request.json(); } catch { return jsonResponse({ error: 'invalid JSON' }, 400); }
    const pageId = String(body.page_id || body.pageId || '').trim();
    if (!pageId) return jsonResponse({ error: 'page_id required' }, 400);
    const flushed = await flushCmsDraftToD1(env, { pageId, userId: authUser.id });
    await leaveCmsLiveEditSession(env, { pageId, userId: authUser.id });
    await clearCmsDraftHotCache(env, pageId, authUser.id);
    const pageResult = await getCmsPage(cmsScope, pageId, pageStore);
    const projectSlug = pageResult.ok ? String(pageResult.page.project_slug || pageResult.page.project_id || '').trim() : '';
    if (projectSlug) invalidateCmsBootstrap(env, ctx, workspaceId, projectSlug);
    ctx.waitUntil(logCmsActivity(env, { tenantId, userId: authUser.id, action: 'live_session_leave', resourceType: 'page', resourceId: pageId, details: { draft_flushed: !!flushed?.ok } }));
    return jsonResponse({ ok: true, page_id: pageId, draft_flushed: !!flushed?.ok });
  }
  if (path === '/api/cms/overrides' && method === 'POST') {
    let body = {}; try { body = await request.json(); } catch { return jsonResponse({ error: 'invalid JSON' }, 400); }
    const projectSlug = String(body.project_slug || body.project_id || url.searchParams.get('project_slug') || '').trim();
    const result = await upsertCmsOverrideDraft(lifecycleStore, {
      projectSlug,
      projectId: body.project_id || projectSlug,
      path: String(body.path || '').trim(),
      section: body.section || 'hero',
      overridesJson: body.overrides_json ?? body.overridesJson ?? {},
      userId: authUser.id,
    });
    if (!result.ok) return jsonResponse({ error: 'project_slug and path required' }, 400);
    ctx.waitUntil(logCmsActivity(env, { tenantId, userId: authUser.id, action: 'override_upsert', resourceType: 'override', resourceId: result.id }));
    invalidateCmsBootstrap(env, ctx, workspaceId, projectSlug);
    return jsonResponse({ success: true, id: result.id });
  }
  const publishMatch = path.match(/^\/api\/cms\/overrides\/([^/]+)\/publish$/);
  if (publishMatch && method === 'POST') {
    try {
      const result = await publishCmsOverrideRevision(lifecycleStore, publishMatch[1], { userId: authUser.id });
      if (!result?.ok) return jsonResponse({ error: result?.error || 'Override not found' }, result?.error === 'override_not_found' ? 404 : 400);
      ctx.waitUntil(logCmsActivity(env, { tenantId, userId: authUser.id, action: 'override_publish', resourceType: 'override_version', resourceId: result.version_id, details: { override_id: publishMatch[1], version: result.version } }));
      invalidateCmsBootstrap(env, ctx, workspaceId, String(result.project_slug || '').trim());
      return jsonResponse({ success: true, override_id: publishMatch[1], version_id: result.version_id, version: result.version });
    } catch (e) { return jsonResponse({ error: e.message }, 500); }
  }
  return null;
}
