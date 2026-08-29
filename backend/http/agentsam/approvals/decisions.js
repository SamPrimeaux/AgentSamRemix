/** POST/PATCH approval decisions, backed by agentsam/approvals authority. */

import { decideApproval, getApprovalForDecision } from '../../../agentsam/approvals/decisions.js';
import { resumeSpawnAfterBudgetDecision } from '../../../agentsam/runtime/spawn/orchestrator.js';
import { jsonResponse, trustedScope } from '../shared.js';

async function maybeResumeSpawn(identity, env, ctx, row, approvalId, decision) {
  if (String(row?.tool_name || '').trim() !== 'spawn_lane_extension') return null;
  return resumeSpawnAfterBudgetDecision(env, ctx || { waitUntil() {} }, {
    approvalId,
    decision,
    userId: String(identity?.userId || row?.user_id || '').trim() || null,
    workspaceId: String(row?.workspace_id || '').trim() || null,
  }).catch((error) => ({ ok: false, error: error?.message ?? String(error) }));
}

function approvalInScope(row, scope) {
  if (!row) return false;
  if (String(row.tenant_id || '') !== String(scope.tenantId || '')) return false;
  if (row.workspace_id && String(row.workspace_id).trim() !== String(scope.workspaceId || '')) return false;
  const actorIds = new Set([scope.userId, scope.authUser?.email].filter(Boolean).map((value) => String(value).trim()));
  return !row.user_id || actorIds.has(String(row.user_id).trim());
}

export async function handleApprovalDecisionRoutes(request, url, env, ctx, identity) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const scope = trustedScope(identity);
  if (!scope.authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  const post = path.match(/^\/api\/agent\/approval\/([^/]+)\/(approve|deny)$/);
  if (post && method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const approvalId = post[1];
    const decision = post[2] === 'approve' ? 'approved' : 'denied';
    const previous = await getApprovalForDecision(env, approvalId);
    if (!approvalInScope(previous, scope)) return jsonResponse({ error: previous ? 'Forbidden' : 'Not found' }, previous ? 403 : 404);
    const out = await decideApproval(env, approvalId, decision, scope.authUser.id || scope.authUser.email);
    if (!out.ok) return jsonResponse({ error: 'Not found' }, 404);
    const spawnResume = await maybeResumeSpawn(identity, env, ctx, out.approval, approvalId, decision);
    return jsonResponse({ ok: true, approval_id: approvalId, spawn_resume: spawnResume });
  }

  const patch = path.match(/^\/api\/agent\/approval\/([^/]+)$/);
  if (patch && method === 'PATCH') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const { status } = await request.json().catch(() => ({}));
    if (!['approved', 'denied'].includes(status)) return jsonResponse({ error: 'invalid status' }, 400);
    const previous = await getApprovalForDecision(env, patch[1]);
    if (!approvalInScope(previous, scope)) return jsonResponse({ error: previous ? 'Forbidden' : 'Not found' }, previous ? 403 : 404);
    if (status === 'approved' && typeof identity?.persistDiscoveryApprovalGrant === 'function' &&
        identity.approvalWantsDiscoveryGrant?.(previous.input_json)) {
      try {
        await identity.persistDiscoveryApprovalGrant(env.DB, {
          userId: previous.user_id,
          workspaceId: previous.workspace_id,
          toolKey: previous.tool_name,
          notes: 'discovery_approval',
        });
      } catch (error) {
        return jsonResponse({ error: 'discovery_grant_failed', detail: String(error?.message || error) }, 500);
      }
    }
    const out = await decideApproval(
      env,
      patch[1],
      status,
      scope.authUser.email || scope.authUser.id,
    );
    if (!out.ok) return jsonResponse({ error: 'Not found' }, 404);
    const spawnResume = await maybeResumeSpawn(identity, env, ctx, out.approval, patch[1], status);
    return jsonResponse({ ok: true, spawn_resume: spawnResume });
  }
  return null;
}
