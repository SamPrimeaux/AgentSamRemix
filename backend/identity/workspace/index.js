/**
 * Workspace identity — relationship vs capability split (intentional).
 *
 * workspace_members  → "may this au_* access ws_*?" (access.js)
 * memberships        → role + can_run_* capability columns (membership.js)
 * auth_users.active_workspace_id → stored pin (resolve.js)
 */

export { resolveCanonicalWorkspace } from '../workspace-resolve.js';
export {
  persistWorkspaceSelection,
  resolveRequestWorkspace,
} from './request-resolve.js';
export { selectWorkspace } from './select.js';
export {
  fetchAuthUserWorkspacePrefs,
  resolveWorkspaceIdForRequest,
} from '../workspace-context.js';

export {
  authorizeFirstWorkspace,
  authorizeWorkspaceAccess,
  resolveWorkspaceAccessContext,
  userCanAccessWorkspace,
  userIdIsIamTunnelOwner,
  userIsWorkspaceOwner,
  workspaceMemberUserCandidates,
  resolveWorkspaceMemberRole,
  userHasWorkspaceRole,
  userCanAdminWorkspace,
  userCanInviteToTenant,
  userIsTunnelInfraActor,
} from './authority.js';

export {
  loadMembership,
  userHasMembership,
  resolveFirstMembershipWorkspaceId,
} from './membership.js';
