/** Workflow HTTP request scope resolved from the canonical identity plane. */
import { getRequestAuth } from '../../identity/resolve-identity.js';
import { fetchAuthUserTenantId } from '../../identity/users/tenant.js';
import { userCanAccessWorkspace } from '../../identity/workspace/access.js';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function identityFields(identity) {
  if (!identity || typeof identity !== 'object') return {};
  return {
    userId: trim(identity.userId || identity.user?.id) || null,
    tenantId: trim(identity.tenantId || identity.tenant?.id) || null,
    workspaceId: trim(identity.workspaceId || identity.workspace?.id) || null,
    email: trim(identity.email || identity.user?.email) || null,
    sessionId: trim(identity.sessionId) || null,
  };
}

/**
 * Resolve user/tenant/workspace once for workflow HTTP handlers.
 * Explicit route identity wins; otherwise consume the request-auth context already
 * primed by the Worker front door. No legacy bootstrap/session re-selection.
 */
export async function resolveWorkflowRequestScope(request, env, authUser = null, identity = null) {
  const explicit = identityFields(identity);
  let authCtx = null;
  if (!explicit.userId || !explicit.workspaceId || !explicit.tenantId) {
    authCtx = await getRequestAuth(request, env, { required: false });
  }

  const userId = explicit.userId || trim(authCtx?.userId) || trim(authUser?.id) || null;
  let tenantId =
    explicit.tenantId || trim(authCtx?.tenantId) || trim(authUser?.tenant_id) || null;
  const workspaceId =
    explicit.workspaceId ||
    trim(authCtx?.workspaceId) ||
    trim(authUser?.workspace_id) ||
    trim(authUser?.active_workspace_id) ||
    null;

  if (!tenantId && userId && env?.DB) {
    tenantId = trim(await fetchAuthUserTenantId(env, userId).catch(() => null)) || null;
  }

  return {
    userId,
    tenantId,
    workspaceId,
    email: explicit.email || trim(authCtx?.email) || trim(authUser?.email) || null,
    sessionId: explicit.sessionId || trim(authCtx?.sessionId) || trim(authUser?.session_id) || null,
    authCtx,
  };
}


/** Keep authenticated humans on canonical identity; bridge ingestion may supply explicit identity fields. */
export function resolveWorkflowStartIdentity(body = {}, scope = {}, { bridgeIngest = false } = {}) {
  const human = !bridgeIngest;
  return {
    userId: human ? (scope.userId ?? null) : (body.userId ?? body.user_id ?? scope.userId ?? null),
    tenantId: human ? (scope.tenantId ?? null) : (body.tenantId ?? body.tenant_id ?? scope.tenantId ?? null),
    workspaceId: human ? (scope.workspaceId ?? null) : (body.workspaceId ?? body.workspace_id ?? scope.workspaceId ?? null),
    userEmail: human
      ? (scope.email ?? null)
      : (body.userEmail ?? body.user_email ?? scope.email ?? null),
  };
}

/** Authorize an optional client-selected workspace without letting query/body input become identity. */
export async function resolveRequestedWorkflowWorkspace(env, scope, requestedWorkspaceId = null) {
  const requested = trim(requestedWorkspaceId);
  if (!requested) return { ok: true, workspaceId: scope?.workspaceId || null };
  if (!scope?.userId) return { ok: false, error: 'unauthorized' };
  const authUser = {
    id: scope.userId,
    email: scope.email || null,
    tenant_id: scope.tenantId || null,
  };
  const allowed = await userCanAccessWorkspace(env, authUser, requested);
  if (!allowed) return { ok: false, error: 'workspace_forbidden' };
  return { ok: true, workspaceId: requested };
}
