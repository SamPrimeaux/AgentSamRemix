/**
 * Shared helpers for settings HTTP route modules (tenant, workspaces, models-catalog).
 */
import { fetchAuthUserTenantId } from '../../identity/users/tenant.js';
import { resolveWorkspaceIdForRequest } from '../../identity/workspace-context.js';

export const CORE_WORKSPACES_DATA = [];

export async function resolveRequestWorkspaceId(env, authUser, request, url) {
  return resolveWorkspaceIdForRequest(env, {
    request, authUser, queryWorkspaceId: url?.searchParams?.get('workspace_id'),
  });
}

export async function resolveAuthTenantId(env, authUser) {
  if (authUser.tenant_id != null && String(authUser.tenant_id).trim() !== '') {
    return String(authUser.tenant_id).trim();
  }
  let tid = await fetchAuthUserTenantId(env, authUser.id);
  if (tid) return tid;
  if (authUser.email) {
    tid = await fetchAuthUserTenantId(env, authUser.email);
    if (tid) return tid;
  }
  return null;
}

export function parseSettingsJsonSafe(str, fallback = {}) {
  if (str == null || str === '') return { ...fallback };
  try {
    const o = typeof str === 'string' ? JSON.parse(str) : str;
    return typeof o === 'object' && o !== null ? o : { ...fallback };
  } catch {
    return { ...fallback };
  }
}
