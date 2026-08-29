/**
 * Deterministic experience scoring — no LLM judge.
 * Combines objective signals already owned by the platform.
 */
import { normalizeFailureCategory } from '../../../../src/core/reward-failure-category.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * Map run status + failure category → outcome taxonomy.
 * @param {{
 *   status?: string,
 *   failureCategory?: string|null,
 *   cancelled?: boolean,
 *   toolErrorCount?: number,
 *   toolCallCount?: number,
 *   qualityScore?: number|null,
 * }} p
 */
export function classifyExperienceOutcome(p = {}) {
  const status = trim(p.status).toLowerCase();
  const fc = normalizeFailureCategory(p.failureCategory);
  if (p.cancelled || status === 'cancelled' || status === 'canceled') {
    return { outcome: 'cancelled', completion_signal: 'deterministic' };
  }
  if (fc === 'platform_request_error' || status === 'infrastructure_failure') {
    return { outcome: 'infrastructure_failure', completion_signal: 'deterministic' };
  }
  const succeeded = status === 'completed' || status === 'success';
  if (!succeeded) {
    return { outcome: 'failed', completion_signal: 'deterministic' };
  }
  const q = p.qualityScore != null ? clamp01(p.qualityScore) : null;
  const toolErrors = Math.max(0, Math.floor(Number(p.toolErrorCount) || 0));
  const toolCalls = Math.max(0, Math.floor(Number(p.toolCallCount) || 0));
  if (q != null && q < 0.45) {
    return { outcome: 'partial', completion_signal: 'mixed' };
  }
  if (toolCalls > 0 && toolErrors / toolCalls > 0.4) {
    return { outcome: 'partial', completion_signal: 'mixed' };
  }
  return { outcome: 'useful_success', completion_signal: 'deterministic' };
}

/**
 * Latency score: faster is better (soft target 30s agent, 120s debug).
 * @param {number|null} latencyMs
 * @param {string|null} taskType
 */
export function latencyComponent(latencyMs, taskType) {
  const ms = Number(latencyMs);
  if (!Number.isFinite(ms) || ms < 0) return 0.5;
  const tt = trim(taskType).toLowerCase();
  const target = tt.includes('plan') || tt.includes('ask') ? 15000 : 30000;
  return clamp01(1 - ms / (target * 4));
}

/**
 * Cost efficiency vs task-type baseline ($0.05 default).
 * @param {number|null} costUsd
 * @param {string|null} taskType
 */
export function costComponent(costUsd, taskType) {
  const cost = Number(costUsd);
  if (!Number.isFinite(cost) || cost < 0) return 0.5;
  const tt = trim(taskType).toLowerCase();
  const baseline =
    tt.includes('plan') || tt.includes('ask') ? 0.008 : tt.includes('agent') ? 0.05 : 0.03;
  return clamp01(baseline / Math.max(cost, baseline * 0.01));
}

/**
 * @param {{
 *   outcome: string,
 *   failureCategory?: string|null,
 *   costUsd?: number|null,
 *   latencyMs?: number|null,
 *   taskType?: string|null,
 *   toolCallCount?: number,
 *   toolErrorCount?: number,
 *   qualityScore?: number|null,
 *   userFeedback?: 'up'|'down'|null,
 * }} input
 */
export function scoreAgentExperience(input = {}) {
  const outcome = trim(input.outcome) || 'failed';
  const success =
    outcome === 'useful_success' ? 1 : outcome === 'partial' ? 0.55 : outcome === 'cancelled' ? 0.35 : 0;
  const infra = outcome === 'infrastructure_failure';
  const toolOk =
    input.toolCallCount > 0
      ? clamp01(1 - (Number(input.toolErrorCount) || 0) / input.toolCallCount)
      : 1;
  const cost = costComponent(input.costUsd, input.taskType);
  const latency = latencyComponent(input.latencyMs, input.taskType);
  let userFb = null;
  if (input.userFeedback === 'up') userFb = 1;
  if (input.userFeedback === 'down') userFb = 0;

  const components = {
    success,
    tool_outcome: toolOk,
    cost,
    latency,
    user_feedback: userFb,
    infrastructure_neutral: infra ? 1 : 0,
  };

  const weights = {
    success: 0.35,
    tool_outcome: 0.2,
    cost: 0.2,
    latency: 0.15,
    user_feedback: userFb != null ? 0.1 : 0,
  };
  let wSum = 0;
  let reward = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (w <= 0) continue;
    wSum += w;
    reward += w * (Number(components[k]) || 0);
  }
  reward = wSum > 0 ? clamp01(reward / wSum) : 0;
  if (infra) reward = Math.max(reward, 0.5);

  return {
    reward,
    reward_components: components,
  };
}

/**
 * Estimate cache savings from token counts (rough catalog pricing).
 * @param {{ cached_input_tokens?: number, input_tokens?: number, cost_usd?: number }} p
 */
export function estimateCacheSavingsUsd(p = {}) {
  const cached = Math.max(0, Math.floor(Number(p.cached_input_tokens) || 0));
  const input = Math.max(0, Math.floor(Number(p.input_tokens) || 0));
  const cost = Number(p.cost_usd);
  if (cached <= 0 || !Number.isFinite(cost) || cost <= 0) return 0;
  const totalIn = input + cached;
  if (totalIn <= 0) return 0;
  return Math.max(0, (cost * cached) / totalIn * 0.5);
}
