/**
 * Agent Sam model routing — Thompson sampling over agentsam_routing_arms (Beta bandit).
 *
 * Facade (stable import surface). Module map:
 *   routing.js (this file)
 *     → routing-thompson.js       Beta/Thompson math + memory priors blend
 *     → routing-arms.js           D1 arm loading and candidate queries
 *     → routing-route-req.js      agentsam_route_requirements gates
 *     → routing-resolve.js        task type mapping + arm selection
 *     → routing-feedback.js       bandit writers (usage, quality, observed model)
 *
 * Schema is discovered via PRAGMA table_info(agentsam_routing_arms) before reads/writes.
 * Expected columns (any subset; routing adapts):
 *   - id | arm_id          — arm identifier (required for outcome updates)
 *   - model_id | ai_model_id — FK to agentsam_ai.id
 *   - task_key | intent_slug | task_type — filter for task (optional)
 *   - tenant_id           — optional scope
 *   - alpha, beta         — Beta prior/posterior parameters (must stay > 0)
 *   - success_count | successes  — alternative to alpha/beta (uses Beta(1+s,1+f))
 *   - failure_count | failures
 *   - is_active | active  — optional eligibility gate
 */

export { TTFT_INTERACTIVE_PENALTY_MS, mergeModelRoutingMemoryPriors, sampleBeta, thompsonSelectArm } from './routing-thompson.js';

export {
  armMatchesRouteRequirements,
  banditTaskType,
  filterArmsForRouteKey,
  isAnthropicSmoketestQuickstartBatch,
  loadActiveCatalogModelKeysOrdered,
  loadChatRoutingArmsModelKeyOrder,
  loadRouteRequirementsRow,
  mergeAiRowWithRoutingArmForPolicy,
  pragmaRoutingArmsColumns,
  queryRoutingArmsCandidates,
  resolveRoutingArmByModelKey,
  routingModesForArmLookup,
  validateModelAgainstRouteRequirements,
} from './routing-arms.js';

export {
  getDefaultModelForTask,
  resolveRoutingArm,
  resolveRoutingTaskType,
  selectAutoModel,
} from './routing-resolve.js';

export {
  applyRoutingArmUsageFeedback,
  recordRoutingArmOutcome,
  scheduleRoutingArmBanditUpdate,
  scheduleRoutingArmFeedbackFromUsage,
  scheduleRoutingArmQualityUpdate,
} from './routing-feedback.js';
