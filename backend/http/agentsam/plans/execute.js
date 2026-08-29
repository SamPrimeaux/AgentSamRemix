/** POST /api/agent/plan/execute. */

import { startPlanExecuteSseResponse } from '../plan-execute-stream.js';
import { jsonResponse } from '../shared.js';
import { loadOwnedPlan, planRouteScope, unauthorizedIfMissing } from './common.js';

export async function handlePlanExecuteRoute(request, url, env, ctx, identity, services) {
  if (request.method.toUpperCase() !== 'POST' ||
      url.pathname.toLowerCase().replace(/\/$/, '') !== '/api/agent/plan/execute') return null;
  const scope = planRouteScope(identity);
  const unauthorized = unauthorizedIfMissing(scope);
  if (unauthorized) return unauthorized;
  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const planId = String(body.plan_id ?? body.planId ?? '').trim();
  if (!planId) return jsonResponse({ error: 'plan_id required' }, 400);
  const owned = await loadOwnedPlan(env, planId, scope, 'id, tenant_id, workspace_id, workflow_run_id, status');
  if (owned.response) return owned.response;
  if (typeof services?.executePlan !== 'function') return jsonResponse({ error: 'plan_executor_unavailable' }, 503);
  return startPlanExecuteSseResponse(env, ctx, {
    planId,
    executePlan: services.executePlan,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    tenantId: scope.tenantId,
    sessionId: body.sessionId ?? body.session_id ?? scope.sessionId,
    workflowRunId: owned.row.workflow_run_id ?? body.workflow_run_id ?? null,
    request,
  });
}
