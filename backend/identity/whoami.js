/**
 * Canonical browser identity read.
 *
 * The caller proves the browser session before entering this module. D1 is the
 * authority for the user and current workspace; session workspace claims are
 * intentionally not accepted here.
 */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * @param {any} env
 * @param {{ userId: string, sessionId: string }} proof
 * @returns {Promise<{
 *   ok: boolean,
 *   error?: string,
 *   authenticated?: boolean,
 *   user?: { id: string, email: string|null, displayName: string|null },
 *   tenant?: { id: string|null },
 *   workspace?: { id: string, name: string, slug: string|null }|null,
 *   membership?: { role: string|null }|null,
 *   session?: { id: string },
 * }>}
 */
export async function whoAmI(env, proof) {
  const userId = trim(proof?.userId);
  const sessionId = trim(proof?.sessionId);
  if (!userId || !sessionId) return { ok: false, error: 'session_proof_missing' };
  if (!env?.DB) return { ok: false, error: 'database_unavailable' };

  let row;
  try {
    row = await env.DB.prepare(
      `SELECT
         au.id,
         au.email,
         au.display_name,
         au.name,
         au.active_tenant_id,
         au.tenant_id,
         au.active_workspace_id,
         aw.id AS workspace_id,
         aw.display_name AS workspace_display_name,
         aw.name AS workspace_name,
         aw.workspace_slug,
         wm.workspace_id AS membership_workspace_id,
         wm.role AS membership_role
       FROM auth_users au
       LEFT JOIN agentsam_workspace aw
         ON aw.id = au.active_workspace_id
        AND COALESCE(aw.status, 'active') != 'archived'
       LEFT JOIN workspace_members wm
         ON wm.workspace_id = aw.id
        AND wm.user_id = au.id
        AND COALESCE(wm.is_active, 1) = 1
       WHERE au.id = ?
       LIMIT 1`,
    )
      .bind(userId)
      .first();
  } catch (error) {
    console.warn('[whoAmI] identity read failed', error?.message ?? error);
    return { ok: false, error: 'identity_read_failed' };
  }

  if (!row?.id) return { ok: false, error: 'user_not_found' };

  const workspaceId = trim(row.workspace_id);
  const membershipWorkspaceId = trim(row.membership_workspace_id);
  const membershipRole = trim(row.membership_role);
  const workspace = workspaceId && membershipWorkspaceId
    ? {
        id: workspaceId,
        name:
          trim(row.workspace_display_name) ||
          trim(row.workspace_name) ||
          trim(row.workspace_slug) ||
          workspaceId,
        slug: trim(row.workspace_slug) || null,
      }
    : null;

  return {
    ok: true,
    authenticated: true,
    user: {
      id: String(row.id),
      email: trim(row.email) || null,
      displayName: trim(row.display_name) || trim(row.name) || null,
    },
    tenant: {
      id: trim(row.active_tenant_id) || trim(row.tenant_id) || null,
    },
    workspace,
    membership: workspace
      ? { role: membershipRole || null }
      : null,
    session: { id: sessionId },
  };
}
