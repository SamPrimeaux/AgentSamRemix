import { fetchAuthUserTenantId, fallbackSystemTenantId } from '../../src/core/auth.js';
import { userCanAccessWorkspace } from '../identity/workspace/access.js';
import { resolveWorkspaceIdForRequest } from '../identity/workspace-context.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

export async function resolveTenantIdOrFetch(env, authUser) {
  if (authUser?.tenant_id && trim(authUser.tenant_id)) return trim(authUser.tenant_id);
  if (authUser?.id && env?.DB) {
    const tid = await fetchAuthUserTenantId(env, authUser.id);
    if (tid) return tid;
  }
  if (env?.TENANT_ID) return trim(env.TENANT_ID);
  return fallbackSystemTenantId(env);
}

export async function resolveWorkspaceIdStrict(env, request, authUser) {
  const queryWs = request?.url
    ? new URL(request.url).searchParams.get('workspace_id')
    : null;
  return resolveWorkspaceIdForRequest(env, {
    request,
    authUser,
    queryWorkspaceId: queryWs,
  });
}

/**
 * @returns {Promise<{ workspaceId: string|null, error: string|null }>}
 */
export async function assertWorkspaceAccess(env, request, authUser) {
  const workspaceId = await resolveWorkspaceIdStrict(env, request, authUser);
  if (!workspaceId) return { workspaceId: null, error: 'WORKSPACE_CONTEXT_MISSING' };
  const ok = await userCanAccessWorkspace(env, authUser, workspaceId);
  if (!ok) return { workspaceId: null, error: 'Forbidden' };
  return { workspaceId, error: null };
}

/**
 * @param {string|null} error
 */
export function workspaceErrorResponse(error) {
  if (error === 'Forbidden') {
    return { status: 403, body: { ok: false, error: 'FORBIDDEN', message: 'You do not have access to this workspace.' } };
  }
  if (error === 'WORKSPACE_CONTEXT_MISSING') {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'WORKSPACE_CONTEXT_MISSING',
        message: 'Workspace context is missing. Open this page from a workspace or set your active workspace.',
      },
    };
  }
  if (error) {
    return { status: 400, body: { ok: false, error: 'WORKSPACE_ERROR', message: error } };
  }
  return null;
}

export function clientError(code, message, status = 400) {
  return { status, body: { ok: false, error: code, message } };
}
