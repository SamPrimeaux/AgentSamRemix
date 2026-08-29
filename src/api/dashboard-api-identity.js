/**
 * Shared auth gate for dashboard Worker APIs (tenant/workspace from session — never from body).
 *
 * Single spine: getRequestAuth → normalized authUser. Everyone passes the same workspace gate.
 * Kanban: boards/tasks are additionally scoped by owner_id (see kanban-scope.js).
 */
import { getRequestAuth, userFromAuthContext } from '../../backend/identity/index.js'; import { jsonResponse } from '../core/responses.js';
import { userCanAccessWorkspace } from '../core/workspace-access.js';

/**
 * @param {Request} request
 * @param {any} env
 * @returns {Promise<
 *   | { ok: true, authUser: Record<string, unknown>, authCtx: import('../core/auth/request-auth.js').AuthContext }
 *   | { ok: false, response: Response }
 * >}
 */
export async function requireDashboardAuth(request, env) {
  if (!env?.DB) {
    return { ok: false, response: jsonResponse({ error: 'Database not configured' }, 503) };
  }

  const authCtx = await getRequestAuth(request, env, { required: false });
  const authUser = authCtx ? userFromAuthContext(authCtx) : null;

  if (!authUser?.id || !authUser.tenant_id) {
    return { ok: false, response: jsonResponse({ error: 'unauthenticated' }, 401) };
  }

  const workspaceId = authUser.workspace_id != null ? String(authUser.workspace_id).trim() : '';
  if (!workspaceId) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'no_workspace', detail: 'WORKSPACE_CONTEXT_MISSING' },
        403,
      ),
    };
  }

  const allowed = await userCanAccessWorkspace(env, authUser, workspaceId);
  if (!allowed) {
    return { ok: false, response: jsonResponse({ error: 'workspace_forbidden' }, 403) };
  }

  return { ok: true, authUser, authCtx };
}

/** @deprecated Use requireDashboardAuth — returns authUser, not identity. */
export const requireDashboardIdentity = requireDashboardAuth;
