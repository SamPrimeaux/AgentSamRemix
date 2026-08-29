/** POST /api/agent/plan/intake/submit. */

import { startPlanIntakeSubmitSseResponse } from '../plan-intake-stream.js';
import { jsonResponse } from '../shared.js';
import { loadOwnedIntakeBatch, planRouteScope, unauthorizedIfMissing } from './common.js';

export async function handlePlanIntakeRoute(request, url, env, ctx, identity, services) {
  if (request.method.toUpperCase() !== 'POST' ||
      url.pathname.toLowerCase().replace(/\/$/, '') !== '/api/agent/plan/intake/submit') return null;
  const scope = planRouteScope(identity);
  const unauthorized = unauthorizedIfMissing(scope);
  if (unauthorized) return unauthorized;
  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const batchId = String(body.batch_id ?? body.batchId ?? '').trim();
  if (!batchId) return jsonResponse({ error: 'batch_id required' }, 400);
  const owned = await loadOwnedIntakeBatch(env, batchId, scope);
  if (owned.response) return owned.response;
  return startPlanIntakeSubmitSseResponse(env, ctx, {
    request,
    batchId,
    selections: body.selections && typeof body.selections === 'object' ? body.selections : {},
    optionalDetails: body.optional_details ?? body.optionalDetails ?? '',
    skip: body.skip === true,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    tenantId: scope.tenantId,
    sessionId: body.sessionId ?? body.session_id ?? scope.sessionId,
  }, services);
}
