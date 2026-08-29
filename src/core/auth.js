/**
 * Identity & Access Layer — stable import facade.
 * Implementation lives in `backend/identity` (mechanical peel toward agentsam-sdk identity package).
 * Canonical Identity: auth_users.id (au_ prefix).
 */
export { bumpAuthRev, invalidateAuthClaimsCache } from '../../backend/identity/index.js';
export {
  loadFeatureFlags,
  loadFeatureFlagsCached,
  loadFeatureFlagsFromD1,
  invalidateFeatureFlagsCache,
  invalidateGlobalFeatureFlagsCache,
} from '../../backend/identity/permissions/feature-flags.js';

export {
  IAM_KV_SESSION_KEY_PREFIX,
  AUTH_COOKIE_NAME,
  AUTH_SESSION_TTL_SECONDS,
  MIN_AGENT_SESSION_TTL_SECONDS,
          MAX_AGENT_SESSION_TTL_SECONDS,
  DEFAULT_AGENT_SESSION_TTL_SECONDS,
  AUTH_LOGIN_PATH,
  AUTH_SIGNUP_PATH,
  DASHBOARD_AFTER_LOGIN_PATH,
} from '../../backend/auth/constants.js';
export { AuthError } from '../../backend/auth/errors.js';
export { sanitizeBrowserNextPath, getApexDomain } from '../../backend/http/auth/browser-paths.js';
export { jsonResponse } from './responses.js';
export {
  normalizeLoginSessionResult,
  formatSessionCookieHeader,
  appendBrowserLoginSessionCookies,
} from '../../backend/auth/session-cookies.js';
export {
  resolveTelemetryTenantId,
  platformTenantIdFromEnv,
  fallbackSystemTenantId,
  fetchAuthUserTenantId,
  resolveTenantAtLogin,
  resolveUserEnrichment,
} from '../../backend/identity/users/tenant.js';
export {
  authorizeFirstWorkspace,
  authorizeWorkspaceAccess,
  userCanAccessWorkspace,
} from '../../backend/identity/workspace/access.js';
export {
  userIsWorkspaceOwner,
  userIdIsIamTunnelOwner,
} from '../../backend/identity/workspace/grants.js';

export {
  assertFetchDomainAllowed,
  assertPathAllowedByIgnorePatterns,
  assertBrowserOriginTrusted,
} from '../../backend/auth/policy-guards.js';

export { getSession } from '../../backend/identity/sessions/read.js';
export { writeIamSessionToKv } from '../../backend/identity/sessions/kv.js';
export {
  resolveWorkspaceIdAtLogin,
  syncSessionWorkspaceId,
} from '../../backend/identity/sessions/workspace.js';
export {
  primeLegacySessionUpgrade,
  peekSessionUpgradeToken,
} from '../../backend/identity/sessions/upgrade.js';
export {
  establishIamSession,
  createLoginSession,
  pruneExpiredAuthSessions,
  revokeAuthSession,
  resolveSessionIdFromCookieValue,
} from '../../backend/identity/sessions/write.js';
export {
  resolveAuth,
  getRequestAuth,
  primeRequestAuth,
  primeRequestAuthWithContext,
  peekRequestAuth,
  authUserFromRequest,
  userFromAuthContext,
  resolveRequestContext,
  getSamContext,
} from '../../backend/identity/resolve-identity.js';
export { getAuthUser } from '../../backend/identity/resolve-identity.js';

/** @deprecated Prefer getAuthUser(); canonical mapper alias for primed AuthContext. */
export { userFromAuthContext as authContextToLegacyUser } from '../../backend/identity/resolve-identity.js';

