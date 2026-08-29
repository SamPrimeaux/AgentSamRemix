import { httpJsonResponse as jsonResponse } from '../responses.js';
import { resolveRequestedWorkflowWorkspace, resolveWorkflowRequestScope } from './scope.js';
import { listRecentWorkflowRuns } from '../../workflows/index.js';

function clampLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(50, Math.floor(n)));
}


/**
 * GET /api/workflows
 *
 * Returns recent `agentsam_workflow_runs` rows (tenant + workspace scoped) for UnifiedSearchBar wf prefix search.
 *
 * Query:
 * - q: optional search term (matches workflow_key, display_name, id)
 * - limit: default 10, max 50
 */
export async function handleWorkflowsApi(request, url, env) {
  const method = (request.method || 'GET').toUpperCase();
  if (method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);

  const scope = await resolveWorkflowRequestScope(request, env);
  if (!scope.userId) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);

  const tenantId = scope.tenantId || '';
  if (!tenantId) return jsonResponse({ error: 'Tenant not configured for this account' }, 403);
  const requestedWorkspaceId = String(url.searchParams.get('workspace_id') || '').trim();
  const workspaceScope = await resolveRequestedWorkflowWorkspace(env, scope, requestedWorkspaceId);
  if (!workspaceScope.ok) return jsonResponse({ error: 'Workspace access denied' }, 403);
  const workspaceId = workspaceScope.workspaceId || '';

  const q = String(url.searchParams.get('q') || '').trim();
  const limit = clampLimit(url.searchParams.get('limit'));
  try {
    const workflows = await listRecentWorkflowRuns(env.DB, {
      tenantId,
      workspaceId: workspaceId || null,
      query: q,
      limit,
    });
    return jsonResponse({ workflows, workspace_id: workspaceId || null });
  } catch (e) {
    return jsonResponse({ error: e?.message ?? String(e) }, 500);
  }
}

