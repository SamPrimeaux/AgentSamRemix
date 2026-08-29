/**
 * Canonical workspace membership plane (migration 299).
 * account_id = auth_users.id (au_*). Legacy workspace_members is not used for access checks.
 */

function trimId(v) {
  if (v == null) return '';
  return String(v).trim();
}

/**
 * @param {any} env
 * @param {string} accountId auth_users.id
 * @param {string} workspaceId ws_*
 * @returns {Promise<{
 *   role: string,
 *   can_run_pty: number,
 *   can_run_mcp: number,
 *   can_deploy: number,
 *   org_id: string | null,
 * } | null>}
 */
export async function loadMembership(env, accountId, workspaceId) {
  const aid = trimId(accountId);
  const wid = trimId(workspaceId);
  if (!env?.DB || !aid || !wid) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT role, can_run_pty, can_run_mcp, can_deploy, org_id
       FROM memberships
       WHERE account_id = ? AND workspace_id = ?
       LIMIT 1`,
    )
      .bind(aid, wid)
      .first();
    if (!row) return null;
    return {
      role: String(row.role || 'member'),
      can_run_pty: Number(row.can_run_pty) === 1 ? 1 : 0,
      can_run_mcp: Number(row.can_run_mcp) === 1 ? 1 : 0,
      can_deploy: Number(row.can_deploy) === 1 ? 1 : 0,
      org_id: row.org_id != null ? String(row.org_id) : null,
    };
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {string} accountId
 * @param {string} workspaceId
 */
export async function userHasMembership(env, accountId, workspaceId) {
  const m = await loadMembership(env, accountId, workspaceId);
  return m != null;
}

/**
 * First active membership workspace for an account (login / default workspace resolution).
 * @param {any} env
 * @param {string} accountId
 * @returns {Promise<string|null>}
 */
export async function resolveFirstMembershipWorkspaceId(env, accountId) {
  const aid = trimId(accountId);
  if (!env?.DB || !aid) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT workspace_id FROM memberships
       WHERE account_id = ?
       ORDER BY joined_at ASC, created_at ASC
       LIMIT 1`,
    )
      .bind(aid)
      .first();
    return trimId(row?.workspace_id) || null;
  } catch {
    return null;
  }
}
