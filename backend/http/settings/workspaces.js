/**
 * Workspace list/active/default/theme settings routes.
 */
import { httpJsonResponse as jsonResponse } from '../responses.js';
import { appendBrowserLoginSessionCookies } from '../../auth/session-cookies.js';
import { syncSessionWorkspaceId } from '../../identity/sessions/workspace.js';
import { fetchAuthUserWorkspacePrefs } from '../../identity/workspace-context.js';
import { fetchWorkspaceRowsForSettingsApi } from '../../identity/workspace/access.js';
import { selectWorkspace } from '../../identity/workspace/select.js';
import { whoAmI } from '../../identity/whoami.js';
import { CORE_WORKSPACES_DATA, resolveAuthTenantId } from './route-helpers.js';

export async function handleSettingsWorkspacesRoutes(request, env, ctx, authContext) {
  void ctx;
  const { authUser, url, pathLower, method, sessionUserId } = authContext || {};
  if (!authUser) return null;
  const isWorkspacesListPath = pathLower === '/api/settings/workspaces' || pathLower === '/api/workspaces' || pathLower === '/api/settings/workspaces/active' || pathLower === '/api/settings/workspace/default' || pathLower?.match(/^\/api\/settings\/workspace\/[^/]+\/theme$/);
  if (!isWorkspacesListPath) return null;
  if (pathLower === '/api/settings/workspaces/active' && method === 'POST') {
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);
    try {
      const tenantId = await resolveAuthTenantId(env, authUser);
      if (!tenantId) return jsonResponse({ error: 'Tenant required' }, 403);
      const body = await request.json().catch(() => ({}));
      const id = body.id != null ? String(body.id).trim() : '';
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const selected = await selectWorkspace(env, {
        userId: sessionUserId,
        workspaceId: id,
      });
      if (!selected.ok) {
        return jsonResponse(
          { error: selected.error === 'workspace_access_denied' ? 'Workspace not found' : selected.error },
          selected.error === 'workspace_access_denied' || selected.error === 'workspace_not_found' ? 404 : 400,
        );
      }

      // Keep legacy session/JWT mirrors synchronized until request auth stops
      // consuming workspace transport claims. D1 was updated first.
      const transport = await syncSessionWorkspaceId(env, request, sessionUserId, id);
      const current = await whoAmI(env, {
        userId: sessionUserId,
        sessionId: authContext?.identity?.sessionId || 'internal-selection',
      });
      if (!current.ok) {
        return jsonResponse({ error: current.error || 'identity_read_failed' }, 503);
      }

      const response = jsonResponse({
        success: true,
        ok: true,
        current: current.workspace?.id || id,
        workspace: current.workspace || selected.workspace,
      });
      if (transport?.sessionToken) {
        const headers = new Headers(response.headers);
        appendBrowserLoginSessionCookies(headers, transport.sessionToken);
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
      return response;
    } catch (e) {
      return jsonResponse({ error: e?.message ?? 'Update failed' }, 500);
    }
  }
  if ((pathLower === '/api/settings/workspaces' || pathLower === '/api/workspaces') && method === 'GET') {
    if (!env.DB) return jsonResponse({ data: CORE_WORKSPACES_DATA, current: null, workspaceThemes: {}, workspaces: {} });
    const tenantId = await resolveAuthTenantId(env, authUser);
    if (!tenantId) return jsonResponse({ error: 'Tenant required' }, 403);
    const wsRows = await fetchWorkspaceRowsForSettingsApi(env.DB, env, authUser);
    const prefs = await fetchAuthUserWorkspacePrefs(env, sessionUserId);
    return jsonResponse({ data: wsRows, current: prefs.active_workspace_id || null, workspaceThemes: {}, workspaces: {} });
  }
  return null;
}
