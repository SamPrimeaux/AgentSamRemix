/**
 * Workspace-scoped grants — explicit D1 policy/governance/ownership checks.
 * No person-class. No collapsed "platform operator" god bit on identity.
 */
import { getWorkspaceOwnerUserId } from './agentsam-workspace.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}
function authUserId(authUser) {
  return trim(authUser?.id ?? authUser?.user_id ?? authUser?.auth_id);
}
/**
 * workspace_members.role = owner OR workspaces.user_id owner row.
 * @param {any} env
 * @param {string|null|undefined} userId
 * @param {string|null|undefined} workspaceId
 */
export async function userIsWorkspaceOwner(env, userId, workspaceId) {
  const uid = trim(userId);
  const wid = trim(workspaceId);
  if (!env?.DB || !uid || !wid) return false;
  try {
    const ownerUserId = await getWorkspaceOwnerUserId(env, wid);
    if (ownerUserId && ownerUserId === uid) return true;
    const row = await env.DB.prepare(
      `SELECT role
         FROM workspace_members
        WHERE workspace_id = ?
          AND user_id = ?
          AND COALESCE(is_active, 1) = 1
        LIMIT 1`,
    )
      .bind(wid, uid)
      .first();
    return String(row?.role || '') === 'owner';
  } catch {
    return false;
  }
}

/**
 * Explicit agentsam_user_policy enrollment for an auth user and workspace.
 * @param {any} env
 * @param {string|null|undefined} userId auth_users.id (au_*)
 * @param {string|null|undefined} workspaceId
 */
export async function userHasPolicyGrant(env, userId, workspaceId) {
  const uid = trim(userId);
  const wid = trim(workspaceId);
  if (!env?.DB || !uid) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS ok
         FROM agentsam_user_policy p
        INNER JOIN auth_users u ON u.id = p.user_id
        WHERE p.user_id = ?
          AND (trim(COALESCE(p.workspace_id, '')) = '' OR p.workspace_id = ?)
        LIMIT 1`,
    )
      .bind(uid, wid || '')
      .first();
    return Boolean(row?.ok);
  } catch {
    return false;
  }
}

/**
 * @param {any} env
 * @param {string|null|undefined} userId
 * @param {string|null|undefined} workspaceId
 * @param {string[]} [roleIds]
 */
export async function userHasGovernanceGrant(env, userId, workspaceId, roleIds = []) {
  const uid = trim(userId);
  const wid = trim(workspaceId);
  if (!env?.DB || !uid) return false;
  const want = (Array.isArray(roleIds) ? roleIds : [])
    .map((r) => trim(r).toLowerCase())
    .filter(Boolean);
  if (!want.length) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS ok
         FROM user_governance_roles ugr
         LEFT JOIN governance_roles gr ON gr.role_id = ugr.role_id
        WHERE ugr.user_id = ?
          AND (trim(COALESCE(ugr.workspace_id, '')) = '' OR ugr.workspace_id = ?)
          AND (
            lower(COALESCE(ugr.role_id, '')) IN (${want.map(() => '?').join(', ')})
            OR lower(COALESCE(gr.role_name, '')) IN (${want.map(() => '?').join(', ')})
          )
        LIMIT 1`,
    )
      .bind(uid, wid || '', ...want, ...want)
      .first();
    return Boolean(row?.ok);
  } catch {
    return false;
  }
}

/**
 * True when auth_users.id owns conn_gcp_iam_tunnel (terminal_connections.user_id).
 * @param {any} env
 * @param {string|null|undefined} userId
 */
export async function userIdIsIamTunnelOwner(env, userId) {
  const uid = trim(userId);
  if (!uid || !env?.DB) return false;
  try {
    const { userIdIsIamTunnelOwnerFromConfig } = await import('./tunnel-owner.js');
    return userIdIsIamTunnelOwnerFromConfig(env, uid);
  } catch {
    return false;
  }
}

/**
 * Privileged terminal / platform_vm routing — explicit grants only.
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} authUser
 * @param {string|null|undefined} workspaceId
 */
export async function userMayUsePrivilegedTerminal(env, authUser, workspaceId) {
  const uid = authUserId(authUser);
  const wid = trim(workspaceId);
  if (!uid || !wid) return false;
  if (await userIdIsIamTunnelOwner(env, uid)) return true;
  return userHasGovernanceGrant(env, uid, wid, ['OWNER_ADMIN']);
}

/**
 * Platform wrangler / CF credential lane — policy or governance grant on workspace.
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} authUser
 * @param {string} [workspaceId]
 */
export async function userMayUseWorkspaceCredentials(env, authUser, workspaceId = '') {
  const uid = authUserId(authUser);
  const wid = trim(workspaceId);
  if (!uid || !wid) return false;
  if (await userIdIsIamTunnelOwner(env, uid)) return true;
  return userHasGovernanceGrant(env, uid, wid, ['OWNER_ADMIN']);
}

/**
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} authUser
 */
export async function resolveGrantAuthUserRow(env, authUser) {
  const id = authUserId(authUser);
  if (!id) return null;
  const email = trim(authUser?.email).toLowerCase();
  if (email) return { id, email };
  if (!env?.DB) return { id };
  try {
    const row = await env.DB.prepare(`SELECT id, email FROM auth_users WHERE id = ? LIMIT 1`)
      .bind(id)
      .first();
    if (!row?.id) return { id };
    return { id: trim(row.id), email: trim(row.email).toLowerCase() };
  } catch {
    return { id };
  }
}
