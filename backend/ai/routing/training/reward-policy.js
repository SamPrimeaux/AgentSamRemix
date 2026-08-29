/**
 * Pure routing-training reward policy.
 *
 * This module is intentionally side-effect free: it does not query D1, load
 * arms, or write receipts. Training event application belongs to apply-events.
 */

export const REWARD_POLICY_VERSION = 'thompson_v2';

/** @typedef {'execution'|'evaluation'|'user_feedback'|'operational'|'derived_metric'} EvidenceClass */

export const NON_BANDIT_FAILURE_CATEGORIES = Object.freeze([
  'platform_request_error',
  'cancelled_by_user',
  'unknown',
  'budget_exceeded',
]);

const NON_BANDIT_SET = new Set(NON_BANDIT_FAILURE_CATEGORIES);

const SKIP_REASON_BY_CATEGORY = Object.freeze({
  platform_request_error: 'platform_not_model_evidence',
  cancelled_by_user: 'cancelled_not_model_evidence',
  unknown: 'failure_unclassified',
  budget_exceeded: 'budget_not_model_evidence',
});

const WRITER_KEY_BY_REASON = Object.freeze({
  applyEtoToRoutingArms: 'eto_apply',
  applyEtoToRoutingArms_cost_only: 'eto_apply',
  applyThompsonLoopFromAgentRun: 'agent_run_finalize',
  scheduleRoutingArmBanditUpdate: 'bandit_schedule',
  scheduleRoutingArmBanditUpdate_ensure_retry: 'bandit_schedule',
  applyRoutingArmUsageFeedback: 'usage_feedback',
  auto_cost_efficiency: 'usage_feedback',
  recordAntigravityOutcome: 'antigravity_outcome',
});

export function writerKeyFromReason(reason) {
  const r = reason != null ? String(reason).trim() : '';
  if (!r) return null;
  return WRITER_KEY_BY_REASON[r] || r.slice(0, 64);
}

export function legacySignalSemantics(signalType) {
  const t = String(signalType || '').trim();
  switch (t) {
    case 'user_thumbs_up':
      return { evidenceClass: 'user_feedback', rewardType: 'user_thumbs_up' };
    case 'user_thumbs_down':
      return { evidenceClass: 'user_feedback', rewardType: 'user_thumbs_down' };
    case 'user_star_rating':
      return { evidenceClass: 'user_feedback', rewardType: 'user_star_rating' };
    case 'auto_success':
      return { evidenceClass: 'execution', rewardType: 'execution_success' };
    case 'auto_error':
      return { evidenceClass: 'execution', rewardType: 'execution_failure' };
    case 'auto_latency':
      return { evidenceClass: 'operational', rewardType: 'latency_sample' };
    case 'auto_cost_efficiency':
      return { evidenceClass: 'derived_metric', rewardType: 'cost_efficiency' };
    default:
      return { evidenceClass: 'operational', rewardType: t || 'unknown' };
  }
}

export function failureOriginFromCategory(category) {
  const c = category != null ? String(category).trim().toLowerCase() : '';
  switch (c) {
    case 'timeout':
    case 'empty_response':
    case 'provider_error':
      return 'provider';
    case 'platform_request_error':
    case 'budget_exceeded':
      return 'platform';
    case 'tool_execution_error':
      return 'tool';
    case 'cancelled_by_user':
      return 'user';
    case 'unknown':
    default:
      return 'unknown';
  }
}

export function resolveFailureSemantics(p = {}) {
  const rawCategory =
    p.failureCategory != null ? String(p.failureCategory).trim().toLowerCase() : '';
  const isError = p.isErrorSignal === true;

  if (!isError) {
    return {
      failureOrigin: p.failureOrigin != null ? String(p.failureOrigin).trim() : null,
      failureCategory: rawCategory || null,
      failureCode:
        p.failureCode != null ? String(p.failureCode).trim().slice(0, 128) : null,
      banditEligible: true,
      skipReason: null,
    };
  }

  const category = rawCategory || 'unknown';
  const origin =
    (p.failureOrigin != null && String(p.failureOrigin).trim()) ||
    failureOriginFromCategory(category);

  if (NON_BANDIT_SET.has(category)) {
    return {
      failureOrigin: origin,
      failureCategory: category,
      failureCode:
        p.failureCode != null ? String(p.failureCode).trim().slice(0, 128) : null,
      banditEligible: false,
      skipReason: SKIP_REASON_BY_CATEGORY[category] || 'failure_non_bandit',
    };
  }

  return {
    failureOrigin: origin,
    failureCategory: category,
    failureCode:
      p.failureCode != null ? String(p.failureCode).trim().slice(0, 128) : null,
    banditEligible: true,
    skipReason: null,
  };
}

function starBanditDeltas(stars) {
  const s = Number.isFinite(stars) ? Math.min(5, Math.max(1, stars)) : 3;
  if (s >= 4) return { alphaDelta: 1, betaDelta: 0, rewardScore: s / 5 };
  if (s <= 2) return { alphaDelta: 0, betaDelta: 1, rewardScore: s / 5 };
  return { alphaDelta: 0.25, betaDelta: 0.25, rewardScore: s / 5 };
}

/**
 * Map one training signal into deterministic mutation fields.
 *
 * @param {{
 *   evidenceClass?: string|null,
 *   rewardType?: string|null,
 *   success?: boolean|null,
 *   failureOrigin?: string|null,
 *   failureCategory?: string|null,
 *   failureCode?: string|null,
 *   qualityScore?: number|null,
 *   evidenceCount?: number|null,
 *   requestedWeight?: number|null,
 *   signalType?: string|null,
 *   signalValue?: number|null,
 *   rewardScore?: number|null,
 *   rewardWeight?: number|null,
 * }} input
 */
export function deriveRewardPolicy(input = {}) {
  const signalType = input.signalType != null ? String(input.signalType).trim() : '';
  const legacy = legacySignalSemantics(signalType);
  const evidenceClass = String(input.evidenceClass || legacy.evidenceClass).trim();
  const rewardType = String(input.rewardType || legacy.rewardType).trim();
  const rawValue = Number(input.signalValue);
  const signalValue = Number.isFinite(rawValue) ? rawValue : 0;
  const rawCount = Number(input.evidenceCount);
  const evidenceCount =
    Number.isFinite(rawCount) && rawCount > 0
      ? Math.round(rawCount)
      : Number.isFinite(rawValue) &&
          rawValue > 0 &&
          (rewardType === 'execution_success' || rewardType === 'execution_failure')
        ? Math.round(rawValue)
        : 1;
  const rawWeight = Number(input.requestedWeight);
  const requestedWeight =
    Number.isFinite(rawWeight) && rawWeight > 0
      ? rawWeight
      : Number.isFinite(rawValue) && rawValue > 0
        ? rawValue
        : 1;
  const isError =
    rewardType === 'execution_failure' ||
    rewardType === 'user_thumbs_down' ||
    signalType === 'auto_error';
  const failure = resolveFailureSemantics({
    failureOrigin: input.failureOrigin,
    failureCategory: input.failureCategory,
    failureCode: input.failureCode,
    isErrorSignal: isError,
  });
  let rewardScore = Number.isFinite(Number(input.rewardScore))
    ? Number(input.rewardScore)
    : null;
  let rewardWeight =
    Number.isFinite(Number(input.rewardWeight)) && Number(input.rewardWeight) >= 0
      ? Number(input.rewardWeight)
      : null;
  let banditEligible = failure.banditEligible;
  let skipReason = failure.skipReason;

  if (rewardType === 'cost_efficiency' || signalType === 'auto_cost_efficiency') {
    const efficiency =
      rewardScore != null && Number.isFinite(rewardScore) ? rewardScore : signalValue;
    return {
      rewardScore: efficiency,
      rewardWeight: rewardWeight != null ? rewardWeight : 0,
      evidenceCount,
      banditEligible: false,
      alphaDelta: 0,
      betaDelta: 0,
      skipReason: 'metric_only_cost_efficiency',
      policyVersion: REWARD_POLICY_VERSION,
      evidenceClass,
      rewardType,
      failureOrigin: failure.failureOrigin,
      failureCategory: failure.failureCategory,
      failureCode: failure.failureCode,
      quality: null,
    };
  }

  if (rewardType === 'latency_sample' || signalType === 'auto_latency') {
    return {
      rewardScore: rewardScore != null ? rewardScore : 0,
      rewardWeight: rewardWeight != null ? rewardWeight : 0,
      evidenceCount,
      banditEligible: false,
      alphaDelta: 0,
      betaDelta: 0,
      skipReason: 'metric_only_latency',
      policyVersion: REWARD_POLICY_VERSION,
      evidenceClass,
      rewardType,
      failureOrigin: failure.failureOrigin,
      failureCategory: failure.failureCategory,
      failureCode: failure.failureCode,
      quality: null,
    };
  }

  if (rewardType === 'user_thumbs_up' || signalType === 'user_thumbs_up') {
    return {
      rewardScore: rewardScore != null ? rewardScore : 1,
      rewardWeight: rewardWeight != null ? rewardWeight : 1,
      evidenceCount: 1,
      banditEligible: true,
      alphaDelta: 1,
      betaDelta: 0,
      skipReason: null,
      policyVersion: REWARD_POLICY_VERSION,
      evidenceClass,
      rewardType,
      failureOrigin: null,
      failureCategory: null,
      failureCode: null,
      quality: 1,
    };
  }

  if (rewardType === 'user_thumbs_down' || signalType === 'user_thumbs_down') {
    return {
      rewardScore: rewardScore != null ? rewardScore : 0,
      rewardWeight: rewardWeight != null ? rewardWeight : 1,
      evidenceCount: 1,
      banditEligible: true,
      alphaDelta: 0,
      betaDelta: 1,
      skipReason: null,
      policyVersion: REWARD_POLICY_VERSION,
      evidenceClass,
      rewardType,
      failureOrigin: failure.failureOrigin,
      failureCategory: failure.failureCategory,
      failureCode: failure.failureCode,
      quality: 0,
    };
  }

  if (rewardType === 'user_star_rating' || signalType === 'user_star_rating') {
    const star = starBanditDeltas(signalValue);
    return {
      rewardScore: rewardScore != null ? rewardScore : star.rewardScore,
      rewardWeight: rewardWeight != null ? rewardWeight : 1,
      evidenceCount: 1,
      banditEligible: true,
      alphaDelta: star.alphaDelta,
      betaDelta: star.betaDelta,
      skipReason: null,
      policyVersion: REWARD_POLICY_VERSION,
      evidenceClass,
      rewardType,
      failureOrigin: null,
      failureCategory: null,
      failureCode: null,
      quality: star.rewardScore,
    };
  }

  if (isError) {
    if (!banditEligible) {
      return {
        rewardScore: rewardScore != null ? rewardScore : 0,
        rewardWeight: rewardWeight != null ? rewardWeight : requestedWeight,
        evidenceCount,
        banditEligible: false,
        alphaDelta: 0,
        betaDelta: 0,
        skipReason,
        policyVersion: REWARD_POLICY_VERSION,
        evidenceClass,
        rewardType,
        failureOrigin: failure.failureOrigin,
        failureCategory: failure.failureCategory,
        failureCode: failure.failureCode,
        quality: null,
      };
    }
    return {
      rewardScore: rewardScore != null ? rewardScore : 0,
      rewardWeight: rewardWeight != null ? rewardWeight : requestedWeight,
      evidenceCount,
      banditEligible: true,
      alphaDelta: 0,
      betaDelta: requestedWeight,
      skipReason: null,
      policyVersion: REWARD_POLICY_VERSION,
      evidenceClass,
      rewardType,
      failureOrigin: failure.failureOrigin,
      failureCategory: failure.failureCategory,
      failureCode: failure.failureCode,
      quality: null,
    };
  }

  const isSuccess =
    input.success !== false &&
    (rewardType === 'execution_success' ||
      signalType === 'auto_success' ||
      input.success === true);
  if (!isSuccess) {
    return {
      rewardScore: rewardScore != null ? rewardScore : 0,
      rewardWeight: rewardWeight != null ? rewardWeight : 0,
      evidenceCount,
      banditEligible: false,
      alphaDelta: 0,
      betaDelta: 0,
      skipReason: skipReason || 'non_success_signal',
      policyVersion: REWARD_POLICY_VERSION,
      evidenceClass,
      rewardType,
      failureOrigin: failure.failureOrigin,
      failureCategory: failure.failureCategory,
      failureCode: failure.failureCode,
      quality: null,
    };
  }

  const qualityRaw = Number(input.qualityScore);
  return {
    rewardScore: rewardScore != null ? rewardScore : 1,
    rewardWeight: rewardWeight != null ? rewardWeight : requestedWeight,
    evidenceCount,
    banditEligible: true,
    alphaDelta: requestedWeight,
    betaDelta: 0,
    skipReason: null,
    policyVersion: REWARD_POLICY_VERSION,
    evidenceClass,
    rewardType,
    failureOrigin: failure.failureOrigin,
    failureCategory: failure.failureCategory,
    failureCode: failure.failureCode,
    quality: Number.isFinite(qualityRaw) ? qualityRaw : null,
  };
}
