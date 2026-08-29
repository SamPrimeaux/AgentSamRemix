/** Canonical /api/agent/workflow/* HTTP adapter. */
import { verifyBridgeKey } from '../../auth/bridge-key-auth.js';
import { httpJsonResponse as jsonResponse } from '../responses.js';
import { executeWorkflow, transitionWorkflowApproval } from '../../workflows/index.js';
import { resolveWorkflowRequestScope, resolveWorkflowStartIdentity } from './scope.js';

export function isAgentWorkflowHttpPath(path) {
  return path === '/api/agent/workflow/start' || path === '/api/agent/workflow/approve';
}

export async function handleAgentWorkflowRoutes(request, url, env, ctx, routeAuth = null, identity = null) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  if (!isAgentWorkflowHttpPath(path)) return null;
  if (method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  const ra =
    routeAuth && typeof routeAuth === 'object' && 'authCtx' in routeAuth
      ? routeAuth
      : { authUser: routeAuth, authCtx: null };
  const ingestBypass = path === '/api/agent/workflow/start' && verifyBridgeKey(request, env);
  const authUser = ra.authUser ?? identity?.authUser ?? null;
  const scope = await resolveWorkflowRequestScope(request, env, authUser, identity);
  if (!ingestBypass && !scope.userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  if (path === '/api/agent/workflow/start') {
    const body = await request.json().catch(() => ({}));
    const workflowKey = String(body.workflow_key || body.workflowKey || '').trim();
    if (!workflowKey) return jsonResponse({ error: 'workflow_key required' }, 400);

    const startIdentity = resolveWorkflowStartIdentity(body, {
      ...scope,
      email: authUser?.email ?? scope.email ?? null,
    }, { bridgeIngest: ingestBypass });
    const { userId, tenantId, workspaceId } = startIdentity;

    if (!ingestBypass && !workspaceId) {
      return jsonResponse({ error: 'no_workspace', redirect: '/onboarding' }, 403);
    }
    if (!tenantId) return jsonResponse({ error: 'Tenant could not be resolved' }, 403);
    if (!workspaceId) return jsonResponse({ error: 'workspace_id required' }, 400);

    const result = await executeWorkflow(env, {
      workflowKey,
      input: body.input ?? {},
      tenantId: String(tenantId),
      workspaceId: String(workspaceId),
      userId: userId != null ? String(userId) : null,
      userEmail: startIdentity.userEmail,
      sessionId: body.sessionId ?? body.session_id ?? scope.sessionId ?? null,
      triggerType: body.trigger_type ?? body.triggerType ?? 'api',
      ctx,
    });
    return jsonResponse(result);
  }

  const body = await request.json().catch(() => ({}));
  const approvalId = body.approval_id ? String(body.approval_id) : '';
  const decision = String(body.decision || '').toLowerCase();
  if (!approvalId) return jsonResponse({ error: 'approval_id required' }, 400);
  if (!['approved', 'rejected', 'denied'].includes(decision)) {
    return jsonResponse({ error: 'decision must be approved or rejected' }, 400);
  }
  const approval = await transitionWorkflowApproval(env, {
    approvalId,
    decision,
    approvedBy: authUser?.id ?? scope.userId ?? null,
    tenantId: scope.tenantId ?? null,
    workspaceId: scope.workspaceId ?? null,
  });
  if (!approval.ok) {
    return jsonResponse(
      { error: approval.error },
      approval.error === 'approval_not_found_or_decided' ? 404 : 400,
    );
  }
  return jsonResponse({
    ok: true,
    decision: approval.decision,
    approval_id: approvalId,
    run_id: approval.run_id ?? null,
  });
}
