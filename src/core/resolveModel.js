/**
 * AgentSam — Canonical Model Resolver  v2.0
 * src/core/resolveModel.js
 *
 * Barrel: public API re-exports. Implementation lives in resolve-model-*.js.
 *
 * SINGLE SOURCE OF TRUTH for model → provider → api_platform resolution.
 * Every runtime path MUST call resolveModelForTask() and consume ResolvedModel.
 *
 * Resolution chain (first match wins; fail loud — no emergency fallback):
 *   A. Explicit routing_arm_id        → honor caller's arm directly
 *   B. Explicit requested_model_key   → respect user/UI picker choice
 *   C. Thompson sampling              → Beta(α,β) draw across eligible arms
 *   D. Global arm policy              → agentsam_routing_arms (no workspace)
 *   Else → throw ResolutionError (NO_ELIGIBLE_ARM)
 */

export {
  EXECUTION_MODES,
  normalizeMode,
  normalizeRouteKey,
  resolveRouteKeyFromOpts,
  armTaskTypeForRouteKey,
  modeToDefaultRouteKey,
  taskTypeAsRouteKeyIfValid,
} from '../../backend/agentsam/runtime/routing/route-keys.js';

export { openAiChatCompletionsUsesMaxCompletionTokens } from '../integrations/openai-token-params.js';
export {
  OPENAI_AGENTSAM_GPT_TIER_SECRET,
  OPENAI_PLATFORM_DEFAULT_SECRET,
  resolveOpenAiApiKey,
  resolveOpenAiSecretKeyName,
} from '../integrations/openai-credentials.js';

export { ResolutionError } from '../../backend/agentsam/catalog/resolve-model-error.js';
export {
  normalizeProvider,
  normalizeApiPlatform,
  KNOWN_API_PLATFORMS,
  KNOWN_PROVIDERS,
} from '../../backend/agentsam/catalog/resolve-model-platform.js';
export { computeCostUsd } from './resolve-model-cost.js';
export { betaSample } from '../../backend/agentsam/runtime/routing/resolve-model-beta.js';
export {
  INVALID_TASK_TYPES,
  TASK_TYPE_ARM_MODE,
  isExecutionMode,
  resolveRoutingMode,
  routingTaskTypeCandidates,
  normalizeCanonicalTaskType,
  resolveThompsonArmTaskType,
} from '../../backend/agentsam/runtime/routing/resolve-model-task-types.js';
export {
  THOMPSON_CANDIDATE_LIMIT,
  diversifyArmsForThompsonDraw,
  isGlobalRoutingArm,
  preferGlobalArmPerModelKey,
  applyForcedExplorationFloor,
} from '../../backend/agentsam/runtime/routing/resolve-model-arms.js';
export { loadModelRecord } from '../../backend/agentsam/catalog/model-resolution.js';
export { selectThompsonArm, queryGlobalPolicyArm } from '../../backend/agentsam/runtime/routing/resolve-model-thompson.js';
export { resolveModelForTask } from '../../backend/agentsam/runtime/routing/resolve-model-for-task.js';
export { finalizeAgentRun } from './resolve-model-finalize.js';
