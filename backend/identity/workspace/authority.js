/**
 * Workspace authority — membership, roles, tenant-scoped admin, tunnel infra gate.
 *
 * Canonical identity-plane implementation. Legacy callers import through
 * src/core/workspace-authority.js while the broader workspace-access peel lands.
 * No superadmin person-class. No platform_operator column bypass.
 */
import {
  authorizeFirstWorkspace,
  authorizeWorkspaceAccess,
  listAccessibleWorkspaces,
  resolveWorkspaceAccessContext,
  userCanAccessWorkspace,
  workspaceMemberUserCandidates,
} from './access.js';
import {
  userIdIsIamTunnelOwner,
  userIsWorkspaceOwner,
} from './grants.js';

export {
  authorizeFirstWorkspace,
  authorizeWorkspaceAccess,
  listAccessibleWorkspaces,
  resolveWorkspaceAccessContext,
  userCanAccessWorkspace,
  userIdIsIamTunnelOwner,
  userIsWorkspaceOwner,
  workspaceMemberUserCandidates,
};

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function authUserId(authUser) {
  return trim(authUser?.id);
}

/**
 * workspace_members.role for the auth user in a workspace (owner|admin|member|null).
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} authUser
 * @param {string|null|undefined} workspaceId
 */
export async function resolveWorkspaceMemberRole(env, authUser, workspaceId) {
  const wid = trim(workspaceId);
  if (!env?.DB || !wid) return null;
  const candidates = await workspaceMemberUserCandidates(env, authUser);
  if (!candidates.length) return null;
  try {
    const ph = candidates.map(() => '?').join(', ');
    const row = await env.DB.prepare(
      `SELECT role
         FROM workspace_members
        WHERE workspace_id = ?
          AND user_id IN (${ph})
          AND COALESCE(is_active, 1) = 1
        ORDER BY CASE LOWER(COALESCE(role, ''))
          WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
        LIMIT 1`,
    )
      .bind(wid, ...candidates)
      .first();
    const role = trim(row?.role).toLowerCase();
    return role || null;
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} authUser
 * @param {string|null|undefined} workspaceId
 * @param {string[]} roles
 */
export async function userHasWorkspaceRole(env, authUser, workspaceId, roles) {
  const want = new Set((roles || []).map((r) => trim(r).toLowerCase()).filter(Boolean));
  if (!want.size) return false;
  const role = await resolveWorkspaceMemberRole(env, authUser, workspaceId);
  return role != null && want.has(role);
}

/**
 * Workspace owner or admin — settings, invites, destructive ops within a workspace.
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} authUser
 * @param {string|null|undefined} workspaceId
 */
export async function userCanAdminWorkspace(env, authUser, workspaceId) {
  const wid = trim(workspaceId);
  if (!wid) return false;
  if (await userHasWorkspaceRole(env, authUser, wid, ['owner', 'admin'])) return true;
  return userIsWorkspaceOwner(env, authUserId(authUser), wid);
}

/**
 * Tenant invite / onboarding admin — any active owner/admin membership.
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} authUser
 */
export async function userCanInviteToTenant(env, authUser) {
  const uid = authUserId(authUser);
  if (!env?.DB || !uid) return false;
  const candidates = await workspaceMemberUserCandidates(env, authUser);
  if (!candidates.length) return false;
  try {
    const ph = candidates.map(() => '?').join(', ');
    const row = await env.DB.prepare(
      `SELECT 1 AS ok
         FROM workspace_members
        WHERE user_id IN (${ph})
          AND LOWER(COALESCE(role, '')) IN ('owner', 'admin')
          AND COALESCE(is_active, 1) = 1
        LIMIT 1`,
    )
      .bind(...candidates)
      .first();
    return Boolean(row?.ok);
  } catch {
    return false;
  }
}

/**
 * iam-tunnel connection owner — internal container/sandbox routes only.
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} authUser
 */
export async function userIsTunnelInfraActor(env, authUser) {
  const uid = authUserId(authUser);
  if (!uid) return false;
  return userIdIsIamTunnelOwner(env, uid);
}
