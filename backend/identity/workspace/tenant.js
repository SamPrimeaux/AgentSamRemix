/** Workspace tenant lookup kept at the identity boundary during schema transition. */

function trim(value) {
  const result = value == null ? '' : String(value).trim();
  return result || null;
}

/**
 * Read the canonical workspace tenant, with the legacy workspaces row as a
 * compatibility read only. Callers must already have authorized the workspace.
 */
export async function getWorkspaceTenantIdWithFallback(env, workspaceId) {
  const wid = trim(workspaceId);
  if (!env?.DB || !wid) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT COALESCE(
         (SELECT tenant_id FROM agentsam_workspace WHERE id = ? LIMIT 1),
         (SELECT COALESCE(tenant_id, owner_tenant_id, default_tenant_id)
            FROM workspaces WHERE id = ? LIMIT 1)
       ) AS tenant_id`,
    ).bind(wid, wid).first();
    return trim(row?.tenant_id);
  } catch {
    return null;
  }
}
