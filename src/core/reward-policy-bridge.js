/**
 * Worker bridge: src/core/reward-events.js ↔ backend/services/learning/reward-policy.js
 */
export {
  REWARD_POLICY_VERSION,
  NON_BANDIT_FAILURE_CATEGORIES,
  deriveRewardPolicy,
  legacySignalSemantics,
  resolveFailureSemantics,
  writerKeyFromReason,
  failureOriginFromCategory,
} from '../../backend/services/learning/reward-policy.js';
