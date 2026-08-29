/** Shared trusted-scope and ownership checks for plan HTTP routes. */

import { jsonResponse, trustedScope } from '../shared.js';

export function planRouteScope(identity) {
  return trustedScope(identity);
}

export async function loadOwnedPlan(env, planId, scope, fields = 'id, tenant_id, workspace_id') {
  const id = String(planId || '').trim();
  if (!env?.DB || !id) return { response: jsonResponse({ error: 'plan_id required' }, 400) };
  const row = await env.DB
    .prepare(`SELECT ${fields} FROM agentsam_plans WHERE id = ? LIMIT 1`)
    .bind(id)
    .first()
    .catch(() => null);
  if (!row?.id) return { response: jsonResponse({ error: 'plan_not_found' }, 404) };
  if (String(row.tenant_id || '') !== String(scope.tenantId || '')) {
    return { response: jsonResponse({ error: 'Forbidden' }, 403) };
  }
  if (String(row.workspace_id || '') !== String(scope.workspaceId || '')) {
    return { response: jsonResponse({ error: 'workspace_mismatch' }, 403) };
  }
  return { row, planId: id };
}

export async function loadOwnedIntakeBatch(env, batchId, scope) {
  const id = String(batchId || '').trim();
  if (!env?.DB || !id) return { response: jsonResponse({ error: 'batch_id required' }, 400) };
  const row = await env.DB
    .prepare('SELECT id, tenant_id, workspace_id FROM agentsam_plan_intake_batches WHERE id = ? LIMIT 1')
    .bind(id)
    .first()
    .catch(() => null);
  if (!row?.id) return { response: jsonResponse({ error: 'batch_not_found' }, 404) };
  if (String(row.tenant_id || '') !== String(scope.tenantId || '')) {
    return { response: jsonResponse({ error: 'Forbidden' }, 403) };
  }
  if (String(row.workspace_id || '') !== String(scope.workspaceId || '')) {
    return { response: jsonResponse({ error: 'workspace_mismatch' }, 403) };
  }
  return { row, batchId: id };
}

export function unauthorizedIfMissing(scope) {
  return scope.authUser ? null : jsonResponse({ error: 'Unauthorized' }, 401);
}
