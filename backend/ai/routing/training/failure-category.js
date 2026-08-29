/**
 * Controlled vocabulary for routing-training failure evidence.
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

export const NON_BANDIT_FAILURE_CATEGORIES = Object.freeze([
  'platform_request_error',
  'cancelled_by_user',
  'unknown',
  'budget_exceeded',
]);

export function normalizeFailureCategory(value) {
  if (value == null) return null;
  const category = String(value).trim().toLowerCase();
  return category && CATEGORY_SET.has(category) ? category : null;
}

export function failureCategoryMovesBandit(category) {
  const normalized = normalizeFailureCategory(category);
  return Boolean(normalized && !NON_BANDIT_FAILURE_CATEGORIES.includes(normalized));
}

export function normalizeFailureCategoryOrUnknown(value) {
  return normalizeFailureCategory(value) || 'unknown';
}

export function failureCategoryFromResolutionCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === 'BUDGET_EXHAUSTED') return 'budget_exceeded';
  if (
    [
      'MODEL_NOT_FOUND',
      'CAPABILITY_MISMATCH',
      'PROVIDER_REQUIRED',
      'PROVIDER_UNKNOWN',
      'ARM_NOT_ELIGIBLE',
      'NO_ELIGIBLE_ARM',
    ].includes(normalized)
  ) {
    return 'platform_request_error';
  }
  return null;
}

export function failureCategoryFromProviderHttpStatus(status) {
  const numericStatus = Number(status);
  return numericStatus === 400 || numericStatus === 422
    ? 'platform_request_error'
    : 'provider_error';
}

export function failureCategoryFromEmptyEndTurnReason(reason) {
  const normalized = String(reason || '').trim().toLowerCase();
  return normalized.includes('empty_end_turn') ? 'empty_response' : null;
}

export function failureCategoryFromAgentRun(input = {}) {
  if (input.timedOut === true) return 'timeout';
  if (input.cancelled === true) return 'cancelled_by_user';
  const status = String(input.status || '').trim().toLowerCase();
  if (status === 'timeout' || status === 'timed_out') return 'timeout';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled_by_user';
  const error = String(input.errorMessage || '').trim().toLowerCase();
  if (error.includes('agent_run_timeout')) return 'timeout';
  if (error.includes('agent_run_cancelled')) return 'cancelled_by_user';
  if (error.includes('empty_end_turn')) return 'empty_response';
  if (error.includes('budget_exhausted')) return 'budget_exceeded';
  return null;
}
