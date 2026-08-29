/** POST /api/agent/plan/refine. */

import { startPlanRefineSseResponse } from '../plan-refine-stream.js';
import { startPlanningRun, planningRunLifecycle } from '../../../agentsam/runtime/plan/turn.js';
import { jsonResponse } from '../shared.js';
import { loadOwnedPlan, planRouteScope, unauthorizedIfMissing } from './common.js';

export async function handlePlanRefineRoute(request, url, env, ctx, identity, services) {
  if (request.method.toUpperCase() !== 'POST' ||
      url.pathname.toLowerCase().replace(/\/$/, '') !== '/api/agent/plan/refine') return null;
  const scope = planRouteScope(identity);
  const unauthorized = unauthorizedIfMissing(scope);
  if (unauthorized) return unauthorized;
  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const planId = String(body.plan_id ?? body.planId ?? '').trim();
  const refinement = String(body.refinement ?? body.message ?? '').trim();
  if (!planId) return jsonResponse({ error: 'plan_id required' }, 400);
  if (!refinement) return jsonResponse({ error: 'refinement required' }, 400);
  const owned = await loadOwnedPlan(env, planId, scope);
  if (owned.response) return owned.response;
  if (typeof services?.refineAgentsamPlan !== 'function') {
    return jsonResponse({ error: 'plan_refine_unavailable' }, 503);
  }
  const run = await startPlanningRun(env, {
    userId: scope.userId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    conversationId: body.sessionId ?? body.session_id ?? scope.sessionId,
  });
  return startPlanRefineSseResponse(env, ctx, {
    planId,
    refinement,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    tenantId: scope.tenantId,
    sessionId: body.sessionId ?? body.session_id ?? scope.sessionId,
    planningSkillMarkdown: '',
    planningRun: planningRunLifecycle(env, run, request.signal),
  }, services);
}
