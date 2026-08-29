/**
 * Model catalog + routing settings (/api/settings/models, /api/ai/models, …).
 */
import { jsonResponse } from '../agentsam/shared.js';
import { resolveAuthTenantId, resolveRequestWorkspaceId } from './route-helpers.js';

export async function handleSettingsModelsCatalogRoutes(request, env, ctx, authContext) {
  void ctx;
  const { authUser, url, pathLower, method, sessionUserId } = authContext || {};
  if (!authUser) return null;
  const isModelsPath = pathLower === '/api/ai/models' || pathLower === '/api/settings/model-preference' || pathLower === '/api/settings/allowlist/command-suggestions' || pathLower === '/api/settings/models' || pathLower.startsWith('/api/settings/models/');
  if (!isModelsPath) return null;
  if (pathLower === '/api/ai/models' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const { results } = await env.DB.prepare('SELECT * FROM agentsam_model_catalog ORDER BY provider ASC, display_name ASC').all();
    return jsonResponse({ models: results || [] });
  }
  if (pathLower === '/api/settings/models' && method === 'GET') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const workspaceId = await resolveRequestWorkspaceId(env, authUser, request, url);
    const { results } = await env.DB.prepare(`SELECT id, display_name AS name, provider FROM agentsam_model_catalog ORDER BY provider, display_name`).all();
    return jsonResponse({ models: results || [], tiers: [], routing: [], workspace_id: workspaceId || null });
  }
  return null;
}
