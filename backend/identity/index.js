/**
 * Public identity plane surface (import from here in new code).
 *
 * @example
 * import { resolveIdentity } from './index.js';
 */

export {
  resolveIdentity,
  resolveIdentityOptional,
  resolveAuth,
  getRequestAuth,
  primeRequestAuth,
  userFromAuthContext,
  authUserFromRequest,
  resolveRequestContext,
  getAuthUser,
  peekRequestAuth,
  userFromAuthContext as authContextToLegacyUser,
} from './resolve-identity.js';

export {
  resolveIamSystemActor,
  resolveIamSystemActorId,
  resolveIamSystemActorTenantId,
  resolveIamSystemActorWorkspaceId,
  mapAuthUserToSystemActor,
} from './system-actor.js';

export { resolveAgentSamBootstrap, CURRENT_BOOTSTRAP_COMPILER_VERSION } from './bootstrap-link.js';

export * from './contracts/index.js';
export * from './kv-lanes.js';
export { IDENTITY_PEEL_MANIFEST, peelEntry } from './peel-manifest.js';

export * as sessions from './sessions/index.js';
export {
  getSession,
  createLoginSession,
  establishIamSession,
  pruneExpiredAuthSessions,
  revokeAuthSession,
  resolveSessionIdFromCookieValue,
} from './sessions/index.js';
export { writeIamSessionToKv } from './sessions/kv.js';
export {
  resolveWorkspaceIdAtLogin,
  syncSessionWorkspaceId,
} from './sessions/workspace.js';
export {
  primeLegacySessionUpgrade,
  peekSessionUpgradeToken,
} from './sessions/upgrade.js';
export * as users from './users/index.js';
export {
  loadAuthUserById,
  resolveAuthUserByEmail,
  resolveAuthUserLookup,
  resolveCanonicalUserId,
  isAuthUserId,
  isIamOwnedIdentity,
  isIamServiceIdentity,
  isIamServiceIdentityLane,
  isIamOwnedEmail,
  upsertAuthUserEmail,
  fetchAuthUserTenantId,
  fallbackSystemTenantId,
  platformTenantIdFromEnv,
  resolveTelemetryTenantId,
  resolveTenantAtLogin,
  resolveUserEnrichment,
} from './users/index.js';
export * as workspace from './workspace/index.js';
export * as permissions from './permissions/index.js';
export {
  DEFAULT_USER_POLICY,
  normalizeAutoRunMode,
  loadAgentSamUserPolicy,
  loadMembershipCached,
  loadAgentSamUserPolicyCached,
  invalidateAuthClaimsCache,
  readAuthRev,
  bumpAuthRev,
  computeAuthCapabilities,
} from './permissions/index.js';
export {
  loadFeatureFlagsFromD1,
  invalidateFeatureFlagsCache,
} from './permissions/feature-flags.js';
export {
  loadMembership,
  userHasMembership,
  resolveFirstMembershipWorkspaceId,
} from './workspace/membership.js';
export * as tokens from './tokens/index.js';

// OAuth / recovery (already peeled)
export {
  createIamPasswordResetServiceForEnv,
  finalizeInboundOAuth,
} from './worker-boot.js';
export { resolveCanonicalWorkspace } from './workspace-resolve.js';
export { whoAmI } from './whoami.js';
export { notifyUser } from './notify-user.js';
export {
  AUTH_RECOVERY_CATALOG,
  buildAuthRecoveryPayload,
  logIdentityRecoveryAttempt,
  requestIdentityRecoveryEmail,
  verifyIdentityRecoveryCode,
  mcpOAuthRecoveryExtras,
} from './recovery.js';
export * as provisioning from './provisioning.js';
export {
  ensureWorkspaceMember,
  ensureTenantForUser as ensureWorkspaceTenantForUser,
  ensureDefaultWorkspaceForTenant,
  ensureUserTenantWorkspace,
  resolveDefaultWorkspaceForTenant,
  resolveDefaultWorkspaceForTenantId,
  userHasWorkspaceMembership,
} from './workspace/provisioning.js';
export {
  NOTIFY_FLAT_KEYS,
  normalizeNotifyBag,
  notifyBagToFlat,
  applyFlatNotifyUpdates,
  readNotificationPrefs,
  writeNotificationPrefs,
  resolveNotificationEmail,
  isNotifyEventEnabled,
} from './notification-prefs.js';

export { identityContextFromSdkSession } from "./request-context.js";
