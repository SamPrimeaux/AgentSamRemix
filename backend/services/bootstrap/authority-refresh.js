/**
 * Canonical actor authority refresh after Keys lifecycle mutations.
 */

import { resolveAgentSamBootstrap } from './resolve.js';

/**
 * @param {unknown} env
 * @param {{ userId: string, workspaceId: string, tenantId?: string|null }} scope
 */
export async function refreshActorAuthorityAfterKeysChange(env, scope) {
  const userId = scope?.userId != null ? String(scope.userId).trim() : '';
  const workspaceId = scope?.workspaceId != null ? String(scope.workspaceId).trim() : '';
  if (!env?.DB || !userId || !workspaceId) {
    return { ok: false, error: 'missing_scope' };
  }

  try {
    return await resolveAgentSamBootstrap(env, {
      userId,
      requestedWorkspaceId: workspaceId,
      refresh: true,
    });
  } catch (e) {
    console.warn('[authority-refresh] bootstrap refresh failed', e?.message ?? e);
    return { ok: false, error: String(e?.message ?? e) };
  }
}
