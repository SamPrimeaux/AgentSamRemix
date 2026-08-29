/**
 * Kanban is identity-scoped: each user has their own boards (kanban_boards.owner_id).
 * Tenant + workspace still constrain rows for tenancy; never substitute another user's owner_id from the client.
 */

/**
 * @param {Record<string, any>} authUser — from requireDashboardAuth
 * @param {string} workspaceId — resolved by backend/identity for this request
 * @returns {{ tenantId: string, workspaceId: string, ownerId: string }}
 */
export function kanbanActor(authUser, workspaceId) {
  const tenantId = String(authUser?.tenant_id ?? '').trim();
  const resolvedWorkspaceId = String(workspaceId ?? '').trim();
  const ownerId = String(authUser?.id ?? '').trim();
  if (!tenantId || !resolvedWorkspaceId || !ownerId) {
    throw new Error('kanban workspace scope required');
  }
  return {
    tenantId,
    workspaceId: resolvedWorkspaceId,
    ownerId,
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} boardRow
 * @param {ReturnType<typeof kanbanActor>} actor
 */
export function boardWritableByActor(boardRow, actor) {
  if (!boardRow) return false;
  if (String(boardRow.tenant_id) !== actor.tenantId) return false;
  return boardRow.owner_id != null && String(boardRow.owner_id) === actor.ownerId;
}
