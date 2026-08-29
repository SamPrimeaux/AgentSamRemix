export async function routeResolveAgentDataScope(env, authUser, request, identity = {}) {
  const workspaceId = String(identity?.workspaceId || authUser?.active_workspace_id || '').trim() || null;
  return {
    userId: String(identity?.userId || authUser?.id || '').trim() || null,
    workspaceId,
    tenantId: String(identity?.tenantId || authUser?.tenant_id || '').trim() || null,
  };
}
