export async function resolveScope(env, authUser, identity, wsHint) {
  const userId = String(authUser?.id || '').trim();
  const workspaceId =
    String(wsHint || identity?.workspaceId || authUser?.workspace_id || '').trim() || null;
  let tenantId = String(identity?.tenantId || authUser?.tenant_id || '').trim() || null;
  if (!tenantId && workspaceId && env?.DB) {
    const row = await env.DB.prepare(
      `SELECT tenant_id FROM agentsam_workspace WHERE id = ? LIMIT 1`,
    )
      .bind(workspaceId)
      .first()
      .catch(() => null);
    tenantId = row?.tenant_id ? String(row.tenant_id) : tenantId;
  }
  if (!tenantId) {
    tenantId = String(authUser?.tenant_id || '').trim() || null;
  }
  if (!workspaceId) return { error: 'workspace_id required', status: 400 };
  if (!tenantId) return { error: 'tenant_id could not be resolved', status: 400 };
  return { userId, workspaceId, tenantId };
}
