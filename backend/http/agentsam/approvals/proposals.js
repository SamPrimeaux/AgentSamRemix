/** Proposal routes backed by the canonical approval authority. */

import { insertApprovalQueueRow, getApprovalQueueRow } from '../../../agentsam/approvals/queue.js';
import { decideApproval } from '../../../agentsam/approvals/decisions.js';
import { listPendingProposals } from '../../../agentsam/approvals/lookup.js';
import { updateCommandRunApproval } from '../../../agentsam/approvals/linkage.js';
import { jsonResponse, trustedScope } from '../shared.js';

export async function handleProposalRoutes(request, url, env, ctx, identity) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const scope = trustedScope(identity);
  if (!scope.authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  const canDecide = (row) => {
    if (!row) return false;
    if (String(row.tenant_id || '') !== String(scope.tenantId || '')) return false;
    if (row.workspace_id && String(row.workspace_id).trim() !== String(scope.workspaceId || '')) return false;
    const actorIds = new Set([scope.userId, scope.authUser.email].filter(Boolean).map((value) => String(value).trim()));
    return !row.user_id || actorIds.has(String(row.user_id).trim());
  };

  if (path === '/api/agent/propose' && method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const body = await request.json().catch(() => ({}));
    const commandText = String(body.command_text || body.command || '').trim();
    if (!commandText) return jsonResponse({ error: 'command_text required' }, 400);
    if (!scope.tenantId) return jsonResponse({ error: 'Tenant not configured for this account' }, 403);
    const proposalId = `prop_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = Math.floor(Date.now() / 1000);
    await insertApprovalQueueRow(env, {
      id: proposalId,
      tenant_id: scope.tenantId,
      workspace_id: scope.workspaceId,
      user_id: String(scope.authUser.email || scope.userId || '').slice(0, 200),
      session_id: body.session_id || scope.sessionId || null,
      tool_name: String(body.command_name || 'proposed').slice(0, 200),
      action_summary: String(body.rationale || 'Agent proposed command').slice(0, 8000),
      risk_level: 'medium',
      input_json: JSON.stringify({
        command_text: commandText,
        filled_template: commandText,
        command_source: 'agent_generated',
      }),
      expires_at: now + 86400,
      status: 'pending',
      approval_type: 'tool',
      created_at: now,
    });
    const origin = String(env.IAM_ORIGIN || '').replace(/\/$/, '');
    if (typeof identity?.notifyUser === 'function') {
      await identity.notifyUser(env, {
        userId: scope.userId,
        tenantId: scope.tenantId,
        subject: `Proposal pending: ${commandText.slice(0, 80)}`,
        body: `ID: ${proposalId}\nApprove: ${origin}/dashboard/overview?proposal=${proposalId}`,
        category: 'proposal',
      }, ctx).catch(() => {});
    }
    return jsonResponse({ ok: true, proposal_id: proposalId });
  }

  if (path === '/api/agent/proposals/pending' && method === 'GET') {
    return jsonResponse(await listPendingProposals(env, scope));
  }

  const approve = path.match(/^\/api\/agent\/proposals\/([^/]+)\/approve$/);
  if (approve && method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const id = approve[1];
    const row = await getApprovalQueueRow(env, id);
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    if (!canDecide(row)) return jsonResponse({ error: 'Forbidden' }, 403);
    const out = await decideApproval(env, id, 'approved', scope.authUser.email || scope.userId);
    if (!out.ok) return jsonResponse({ error: 'Not found' }, 404);
    await updateCommandRunApproval(env, row.command_run_id, 'approved');
    return jsonResponse({ ok: true, proposal_id: id });
  }

  const deny = path.match(/^\/api\/agent\/proposals\/([^/]+)\/deny$/);
  if (deny && method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    const id = deny[1];
    const row = await getApprovalQueueRow(env, id);
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    if (!canDecide(row)) return jsonResponse({ error: 'Forbidden' }, 403);
    const out = await decideApproval(env, id, 'denied', scope.authUser.email || scope.userId);
    if (!out.ok) return jsonResponse({ error: 'Not found' }, 404);
    return jsonResponse({ ok: true, proposal_id: id, status: 'denied' });
  }
  return null;
}
