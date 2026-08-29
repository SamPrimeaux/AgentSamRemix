/** Mutable human/workspace authorization policy owned by the identity plane. */
export {
  DEFAULT_USER_POLICY,
  normalizeAutoRunMode,
  loadAgentSamUserPolicy,
} from './user-policy.js';
export {
  loadMembershipCached,
  loadAgentSamUserPolicyCached,
  invalidateAuthClaimsCache,
  readAuthRev,
  bumpAuthRev,
} from './cache.js';
export { computeAuthCapabilities } from '../sessions/fields.js';
