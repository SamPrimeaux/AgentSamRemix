/**
 * Legacy import surface for workspace authorization.
 * Canonical implementation: backend/identity/workspace/access.js.
 */
export {
  authorizeFirstWorkspace,
  authorizeWorkspaceAccess,
  listAccessibleWorkspaces,
  repoAlignedWorkspaceName,
  resolveWorkspaceAccessContext,
  userCanAccessWorkspace,
  workspaceMemberUserCandidates,
} from '../../backend/identity/workspace/access.js';
