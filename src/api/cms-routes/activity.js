import { jsonResponse } from '../../core/auth.js';
import { createCloudflareCmsActivityStore } from '../../core/agentsam/cms/adapters/cloudflare/activity-store.js';

export async function handleCmsActivityRoutes(state) {
  const { path, method, url, env, tenantId } = state;
  if (path !== '/api/cms/activity' || method !== 'GET') return null;
  try {
    const activity = await createCloudflareCmsActivityStore(env).list({
      tenantId,
      projectSlug: url.searchParams.get('project_slug') || url.searchParams.get('site') || '',
      pageId: url.searchParams.get('page_id') || '',
      limit: 50,
    });
    return jsonResponse({ activity });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}
