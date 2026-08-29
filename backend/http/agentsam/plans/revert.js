/** POST /api/agent/plan/revert. */

import { jsonResponse } from '../shared.js';
import { loadOwnedPlan, planRouteScope, unauthorizedIfMissing } from './common.js';

export async function handlePlanRevertRoute(request, url, env, ctx, identity, services) {
  if (request.method.toUpperCase() !== 'POST' ||
      url.pathname.toLowerCase().replace(/\/$/, '') !== '/api/agent/plan/revert') return null;
  const scope = planRouteScope(identity);
  const unauthorized = unauthorizedIfMissing(scope);
  if (unauthorized) return unauthorized;
  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const planId = String(body.plan_id ?? body.planId ?? '').trim();
  if (!planId) return jsonResponse({ error: 'plan_id required' }, 400);
  const owned = await loadOwnedPlan(env, planId, scope);
  if (owned.response) return owned.response;
  if (typeof services?.revertAgentsamPlan !== 'function') {
    return jsonResponse({ error: 'plan_revert_unavailable' }, 503);
  }
  try {
    return jsonResponse(await services.revertAgentsamPlan(env, {
      planId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
    }));
  } catch (error) {
    return jsonResponse({ error: String(error?.message || error) }, 500);
  }
}
