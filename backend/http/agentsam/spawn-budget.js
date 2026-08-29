/** POST /api/agent/spawn-budget/decide. */

import { resolveSpawnBudgetDecision } from '../../agentsam/runtime/spawn/orchestrator.js';
import { jsonResponse, trustedScope } from './shared.js';

export async function handleSpawnBudgetRoute(request, url, env, ctx, identity) {
  if (request.method.toUpperCase() !== 'POST' ||
      url.pathname.toLowerCase().replace(/\/$/, '') !== '/api/agent/spawn-budget/decide') {
    return null;
  }
  const scope = trustedScope(identity);
  if (!scope.authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const spawnJobId = String(body.spawn_job_id || body.spawnJobId || '').trim();
  const decision = String(body.decision || '').trim().toLowerCase();
  if (!spawnJobId) return jsonResponse({ error: 'spawn_job_id required' }, 400);
  if (!['approved', 'denied', 'cancel'].includes(decision)) {
    return jsonResponse({ error: 'decision must be approved|denied|cancel' }, 400);
  }
  const out = await resolveSpawnBudgetDecision(env, ctx || { waitUntil() {} }, {
    spawnJobId,
    decision,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
  }).catch((error) => ({ ok: false, error: error?.message ?? String(error) }));
  if (!out?.ok) return jsonResponse({ error: out?.error || 'spawn_budget_decide_failed' }, 400);
  return jsonResponse({ ok: true, spawn_resume: out });
}
