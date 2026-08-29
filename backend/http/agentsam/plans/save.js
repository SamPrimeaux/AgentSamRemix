/** POST /api/agent/plan/save-workspace. */

import { jsonResponse } from '../shared.js';
import { loadOwnedPlan, planRouteScope, unauthorizedIfMissing } from './common.js';

export async function handlePlanSaveRoute(request, url, env, ctx, identity, services) {
  if (request.method.toUpperCase() !== 'POST' ||
      url.pathname.toLowerCase().replace(/\/$/, '') !== '/api/agent/plan/save-workspace') return null;
  const scope = planRouteScope(identity);
  const unauthorized = unauthorizedIfMissing(scope);
  if (unauthorized) return unauthorized;
  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const planId = String(body.plan_id ?? body.planId ?? '').trim();
  if (!planId) return jsonResponse({ error: 'plan_id required' }, 400);
  const owned = await loadOwnedPlan(env, planId, scope);
  if (owned.response) return owned.response;
  if (typeof services?.savePlanToWorkspaceArtifacts !== 'function') {
    return jsonResponse({ error: 'plan_save_unavailable' }, 503);
  }
  try {
    const out = await services.savePlanToWorkspaceArtifacts(env, ctx, {
      planId,
      userId: scope.userId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      includeMap: body.include_map !== false,
      authUser: scope.authUser,
      sourceSessionId: body.session_id ?? body.sessionId ?? null,
    });
    return jsonResponse(out);
  } catch (error) {
    return jsonResponse({ error: 'plan_save_failed', message: String(error?.message || error).slice(0, 500) }, 500);
  }
}
