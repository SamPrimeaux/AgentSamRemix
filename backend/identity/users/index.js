/** Human/service identity rows backed by auth_users + auth_user_emails. */
export {
  loadAuthUserById,
  resolveAuthUserByEmail,
  resolveAuthUserLookup,
  isIamOwnedIdentity,
  isIamServiceIdentity,
  isIamServiceIdentityLane,
  isIamOwnedEmail,
  upsertAuthUserEmail,
} from './repository.js';
export { isAuthUserId, resolveCanonicalUserId } from './canonical-id.js';
export {
  fetchAuthUserTenantId,
  fallbackSystemTenantId,
  platformTenantIdFromEnv,
  resolveTelemetryTenantId,
  resolveTenantAtLogin,
  resolveUserEnrichment,
} from './tenant.js';
