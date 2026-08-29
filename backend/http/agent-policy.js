import { userFromAuthContext } from '../identity/index.js';
import { fetchDashboardBootstrapAgentPolicy } from '../agentsam/policy/dashboard-bootstrap.js';
import { httpJsonResponse as jsonResponse } from './responses.js';

export async function handleAgentPolicyHttp(request, env, authCtx) {
  if (request.method.toUpperCase() !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);
  const authUser = userFromAuthContext(authCtx);
  if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);
  const workspaceId =
    authCtx?.workspaceId != null && String(authCtx.workspaceId).trim()
      ? String(authCtx.workspaceId).trim()
      : authUser.active_workspace_id != null
        ? String(authUser.active_workspace_id).trim()
        : null;
  if (!workspaceId) return jsonResponse({ ok: true, agent_policy: null });
  const policy = await fetchDashboardBootstrapAgentPolicy(env, authUser, workspaceId).catch(() => null);
  return jsonResponse({ ok: true, agent_policy: policy });
}
