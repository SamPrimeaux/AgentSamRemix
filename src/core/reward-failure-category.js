/**
 * Controlled vocabulary for agentsam_reward_events.failure_category on auto_error.
 * Carry through known codes at failure sites — do not invent detectors.
 */

export const FAILURE_CATEGORIES = Object.freeze([
  'timeout',
  'cancelled_by_user',
  'empty_response',
  'provider_error',
  'platform_request_error',
  'tool_execution_error',
  'budget_exceeded',
  'unknown',
]);

const CATEGORY_SET = new Set(FAILURE_CATEGORIES);

/** Failures stored as evidence but must not move Thompson α/β by default. */
export const NON_BANDIT_FAILURE_CATEGORIES = Object.freeze([
  'platform_request_error',
  'cancelled_by_user',
  'unknown',
  'budget_exceeded',
]);

/**
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeFailureCategory(value) {
  if (value == null) return null;
  const c = String(value).trim().toLowerCase();
  if (!c) return null;
  return CATEGORY_SET.has(c) ? c : null;
}

/**
 * @param {string|null|undefined} category
 * @returns {boolean}
 */
export function failureCategoryMovesBandit(category) {
  const c = normalizeFailureCategory(category);
  if (!c) return false;
  return !NON_BANDIT_FAILURE_CATEGORIES.includes(c);
}

/**
 * Coerce missing/invalid categories to controlled unknown (stored, non-bandit).
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeFailureCategoryOrUnknown(value) {
  return normalizeFailureCategory(value) || 'unknown';
}

/**
 * Map ResolutionError.code (and peers) already thrown at resolve sites.
 * @param {string|null|undefined} code
 * @returns {string|null}
 */
export function failureCategoryFromResolutionCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  if (c === 'BUDGET_EXHAUSTED') return 'budget_exceeded';
  // Catalog/capability checks never reached the model — do not train β.
  if (
    c === 'MODEL_NOT_FOUND' ||
    c === 'CAPABILITY_MISMATCH' ||
    c === 'PROVIDER_REQUIRED' ||
    c === 'PROVIDER_UNKNOWN' ||
    c === 'ARM_NOT_ELIGIBLE' ||
    c === 'NO_ELIGIBLE_ARM'
  ) {
    return 'platform_request_error';
  }
  return null;
}

/**
 * IAM_PROVIDER_HTTP already stamps status on the Error at model-turn sites.
 * 400/422 = our request shape rejected (Cursor prompt-shape class). Else provider.
 * @param {unknown} status
 * @returns {string}
 */
export function failureCategoryFromProviderHttpStatus(status) {
  const s = Number(status);
  if (s === 400 || s === 422) return 'platform_request_error';
  return 'provider_error';
}

/**
 * Empty-end-turn recover reasons from agent-tool-loop-recover.
 * @param {string|null|undefined} reason
 * @returns {string|null}
 */
export function failureCategoryFromEmptyEndTurnReason(reason) {
  const r = String(reason || '').trim().toLowerCase();
  if (!r) return null;
  if (r.startsWith('empty_end_turn') || r.includes('empty_end_turn')) return 'empty_response';
  return null;
}

/**
 * Finalize agentsam_agent_run → auto_error category from known status / error_message codes.
 * @param {{
 *   status?: string|null,
 *   errorMessage?: string|null,
 *   timedOut?: boolean|null,
 *   cancelled?: boolean|null,
 * }} p
 * @returns {string|null}
 */
export function failureCategoryFromAgentRun(p = {}) {
  if (p.timedOut === true) return 'timeout';
  if (p.cancelled === true) return 'cancelled_by_user';
  const status = String(p.status || '').trim().toLowerCase();
  if (status === 'timeout' || status === 'timed_out') return 'timeout';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled_by_user';
  const err = String(p.errorMessage || '').trim().toLowerCase();
  if (err === 'agent_run_timeout' || err.includes('agent_run_timeout')) return 'timeout';
  if (err === 'agent_run_cancelled' || err.includes('agent_run_cancelled')) return 'cancelled_by_user';
  if (err.includes('empty_end_turn')) return 'empty_response';
  if (err === 'budget_exhausted' || err.includes('budget_exhausted')) return 'budget_exceeded';
  // Succeeded path should not call this; unknown hard fails leave null (no invented label).
  return null;
}
