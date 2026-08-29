/**
 * Thompson/Beta bandit over agentsam_routing_arms + nightly updates from agentsam_execution_performance_metrics.
 */

import { isThompsonRoutingSamplingEnabled } from './routing-thompson-flag.js';
import { resolveCronWorkspaceId } from '../../../jobs/cron-tenant.js';
import { resolveThompsonArmTaskType } from './resolve-model-task-types.js';
import { betaSample } from './resolve-model-beta.js';
import {
  failureCategoryFromAgentRun,
  normalizeFailureCategory,
} from '../../../ai/routing/training/failure-category.js';

const MS_PER_DAY = 86_400_000;

const FAILURE_CATEGORY_ALIASES = Object.freeze({
  provider_timeout: 'timeout',
  deadline_exceeded: 'timeout',
  hung: 'timeout',
  cancelled: 'cancelled_by_user',
  canceled: 'cancelled_by_user',
  user_cancelled: 'cancelled_by_user',
  user_canceled: 'cancelled_by_user',
});

/**
 * Observed provider cost. Unknown is NULL — never coerced from missing/null to 0.
 * @param {unknown} value
 * @returns {number|null}
 */
export function observedCostUsd(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Observed wall-clock duration. Missing/non-positive is NULL.
 * @param {unknown} value
 * @returns {number|null}
 */
export function observedLatencyMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Classify a tool/command outcome. User cancel is stored but is not bandit-eligible.
 * @param {Record<string, unknown>|null|undefined} payload
 * @param {boolean} success
 * @returns {string|null}
 */
export function classifyCallOutcomeFailure(payload, success) {
  if (success) return null;
  if (payload?.cancelled === true || payload?.canceled === true) return 'cancelled_by_user';
  const raw = payload?.failure_category ?? payload?.failureCategory ?? null;
  const alias =
    raw != null ? FAILURE_CATEGORY_ALIASES[String(raw).trim().toLowerCase()] : null;
  const normalized = normalizeFailureCategory(alias || raw);
  if (normalized) return normalized;
  return (
    failureCategoryFromAgentRun({
      status: payload?.status,
      errorMessage: payload?.errorMessage ?? payload?.error_message,
      timedOut: payload?.timedOut === true || payload?.timed_out === true,
      cancelled: payload?.cancelled === true || payload?.canceled === true,
    }) || 'tool_execution_error'
  );
}

/**
 * Accounting fields for applyRewardEvent. Cost/latency are independent of success.
 * @param {Record<string, unknown>} payload
 */
export function buildCallOutcomeRewardFields(payload = {}) {
  const categoryHint = classifyCallOutcomeFailure(payload, false);
  const cancelled =
    payload?.cancelled === true ||
    payload?.canceled === true ||
    categoryHint === 'cancelled_by_user';
  const success = !!payload?.success && !cancelled;
  const costUsd = observedCostUsd(payload?.costUsd ?? payload?.cost_usd);
  const latencyMs = observedLatencyMs(payload?.durationMs ?? payload?.latency_ms);
  return {
    signal_type: success ? 'auto_success' : 'auto_error',
    cost_usd: costUsd,
    latency_ms: latencyMs,
    apply_cost: costUsd != null,
    apply_latency: latencyMs != null,
    apply_execution: true,
    failure_category: success ? null : categoryHint,
  };
}


async function rewardWorkspaceId(env, wsv) {
  const fromArg = wsv != null ? String(wsv).trim() : '';
  if (fromArg) return fromArg;
  const ws = await resolveCronWorkspaceId(env);
  return ws || '';
}

/**
 * Thompson-style pick from pre-fetched routing arm rows (cost/latency penalties).
 * @param {Array<Record<string, unknown>> | null | undefined} results
 */
/**
 * @param {Array<Record<string, unknown>> | null | undefined} results
 * @param {{ excludeModelKeys?: string[] }} [opts]
 */
export function pickRoutingArmByThompson(results, opts = {}) {
  if (!results?.length) return null;
  const exclude = new Set(
    (opts.excludeModelKeys || []).map((k) => String(k || '').trim()).filter(Boolean),
  );
  const pool = exclude.size
    ? results.filter((a) => !exclude.has(String(a.model_key || '').trim()))
    : results;
  if (!pool.length) return null;

  let best = null;
  let bestUtility = -1;

  for (const arm of pool) {
    // 1. Probabilistic success draw
    const successProb = betaSample(arm.success_alpha, arm.success_beta);

    // 2. Normalized Latency Penalty (lower is better)
    const latMean = Number(arm.latency_mean) || 1000;
    const latPenalty = 1 / (1 + Math.log10(1 + latMean / 100));

    // 3. Normalized Cost Penalty
    const costMean = Number(arm.cost_mean) || 0.01;
    const costPenalty = 1 / (1 + (costMean * 100));

    const utility = successProb * latPenalty * costPenalty;

    if (utility > bestUtility) {
      bestUtility = utility;
      best = arm;
    }
  }
  return best;
}

/**
 * Single-draw Thompson sample for command/default-selection flows.
 * Uses {@link queryRoutingArmsCandidates} via dynamic import to avoid a static cycle with `routing.js`.
 */
export async function thompsonSample(env, taskType, mode, workspaceId = '', opts = {}) {
  if (!env?.DB) return null;
  const tt = taskType != null ? String(taskType).trim() : 'agent';
  const m = mode != null && String(mode).trim() !== '' ? String(mode).trim() : 'agent';
  const ws = workspaceId != null ? String(workspaceId).trim() : '';
  const excludeModelKeys = Array.isArray(opts.excludeModelKeys)
    ? opts.excludeModelKeys.map((k) => String(k || '').trim()).filter(Boolean)
    : [];

  try {
    const { queryRoutingArmsCandidates } = await import('./routing.js');
    let arms = await queryRoutingArmsCandidates(env, {
      taskType: tt,
      mode: m,
      workspaceId: ws,
      toolRequired: !!opts.toolRequired,
      routeKey: opts.routeKey ?? null,
    });
    if (excludeModelKeys.length) {
      arms = arms.filter((a) => !excludeModelKeys.includes(String(a.model_key || '').trim()));
    }
    if (!arms.length) return null;

    const useThompson = await isThompsonRoutingSamplingEnabled(env, {
      userId: opts.userId,
      tenantId: opts.tenantId,
    });
    return useThompson
      ? pickRoutingArmByThompson(arms, { excludeModelKeys })
      : arms[0] ?? null;
  } catch {
    return null;
  }
}

export async function updateArmsFromMetrics(env) {
  if (!env?.DB) return;
  const { isEtoThompsonOwner } = await import('../../../http/agentsam/routes/ops-runtime.js');
  if (await isEtoThompsonOwner(env)) {
    return { skipped: true, reason: 'eto_thompson_owner' };
  }
  const { results: metrics } = await env.DB
    .prepare(
      `
    SELECT routing_arm_id, model_key, workspace_id, execution_count, success_count, failure_count,
           avg_duration_ms, total_cost_cents, command_id
    FROM agentsam_execution_performance_metrics
    WHERE metric_date = date('now','-1 day') AND execution_count > 0
  `,
    )
    .all()
    .catch(() => ({ results: [] }));

  for (const m of metrics || []) {
    let arm = null;
    const rid = m.routing_arm_id != null ? String(m.routing_arm_id).trim() : '';
    if (rid) {
      arm = await env.DB
        .prepare(
          `
      SELECT id, workspace_id, success_alpha, success_beta, cost_n, cost_mean, latency_n, latency_mean
      FROM agentsam_routing_arms WHERE id = ? LIMIT 1
    `,
        )
        .bind(rid)
        .first()
        .catch(() => null);
      if (arm && String(arm.workspace_id || '').trim()) arm = null;
    }
    const mk = m.model_key != null ? String(m.model_key).trim() : '';
    const wsv = m.workspace_id != null ? String(m.workspace_id).trim() : '';
    if (!arm && mk) {
      arm = await env.DB
        .prepare(
          `
      SELECT id, success_alpha, success_beta, cost_n, cost_mean, latency_n, latency_mean
      FROM agentsam_routing_arms
      WHERE model_key = ? AND COALESCE(TRIM(workspace_id), '') = ''
      LIMIT 1
    `,
        )
        .bind(mk)
        .first()
        .catch(() => null);
    }

    if (!arm) continue;

    const execN = Math.max(1, Number(m.execution_count) || 1);
    const successCount = Number(m.success_count) || 0;
    const failureCount = Number(m.failure_count) || 0;
    const costUsd = ((m.total_cost_cents || 0) / 100) / execN;
    const latMs = Number(m.avg_duration_ms) || 0;
    const day = 'epm_yesterday';

    try {
      const {
        applyTrainingEvent: applyRewardEvent,
        resolveTenantIdForReward,
      } = await import('../../../ai/routing/training/apply-events.js');
      const workspaceId = await rewardWorkspaceId(env, wsv);
      if (!workspaceId) continue;
      const tenantId = await resolveTenantIdForReward(env, { workspaceId });
      if (!tenantId) continue;
      const armRow = await env.DB.prepare(
        `SELECT task_type, model_key, provider FROM agentsam_routing_arms WHERE id = ? LIMIT 1`,
      )
        .bind(arm.id)
        .first();
      const taskType = resolveThompsonArmTaskType(armRow?.task_type);
      let costApplied = false;
      if (successCount > 0) {
        await applyRewardEvent(env, {
          tenant_id: tenantId,
          workspace_id: workspaceId,
          task_type: taskType,
          signal_type: 'auto_success',
          signal_value: successCount,
          routing_arm_id: arm.id,
          model_key: mk || armRow?.model_key || null,
          cost_usd: costUsd,
          latency_ms: latMs,
          apply_cost: true,
          apply_latency: latMs > 0,
          apply_execution: true,
          dedup_key: `epm:${day}:${arm.id}:ok`,
          reason: 'updateArmsFromMetrics',
        });
        costApplied = true;
      }
      if (failureCount > 0) {
        await applyRewardEvent(env, {
          tenant_id: tenantId,
          workspace_id: workspaceId,
          task_type: taskType,
          signal_type: 'auto_error',
          signal_value: failureCount,
          routing_arm_id: arm.id,
          model_key: mk || armRow?.model_key || null,
          cost_usd: !costApplied ? costUsd : null,
          latency_ms: !costApplied && latMs > 0 ? latMs : null,
          apply_cost: !costApplied,
          apply_latency: !costApplied && latMs > 0,
          apply_execution: successCount <= 0,
          dedup_key: `epm:${day}:${arm.id}:err`,
          reason: 'updateArmsFromMetrics',
        });
      }
    } catch (e) {
      console.warn('[thompson] updateArmsFromMetrics', e?.message ?? e);
    }
  }

  let hasToolChain = false;
  try {
    const probe = await env.DB.prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'agentsam_tool_chain' LIMIT 1`,
    ).first();
    hasToolChain = !!probe?.ok;
  } catch {
    hasToolChain = false;
  }
  if (hasToolChain) {
    const { results: comps } = await env.DB
      .prepare(
        `
    SELECT TRIM(COALESCE(tc.model_key, '')) AS model_key
    FROM agentsam_execution_dependency_graph edg
    JOIN agentsam_tool_chain tc ON tc.id = edg.depends_on_chain_id
    WHERE edg.dependency_type = 'compensation'
      AND edg.created_at > unixepoch('now','-1 day')
      AND TRIM(COALESCE(tc.model_key, '')) != ''
  `,
      )
      .all()
      .catch(() => ({ results: [] }));

    const {
      applyTrainingEvent: applyRewardEvent,
      resolveTenantIdForReward,
    } = await import('../../../ai/routing/training/apply-events.js');
    for (const c of comps || []) {
      const cmk = c.model_key != null ? String(c.model_key).trim() : '';
      if (!cmk) continue;
      try {
        const arm = await env.DB.prepare(
          `SELECT id, task_type FROM agentsam_routing_arms
           WHERE model_key = ? AND COALESCE(TRIM(workspace_id), '') = ''
           LIMIT 1`,
        )
          .bind(cmk)
          .first();
        if (!arm?.id) continue;
        const workspaceId = await rewardWorkspaceId(env, '');
        if (!workspaceId) continue;
        const tenantId = await resolveTenantIdForReward(env, { workspaceId });
        if (!tenantId) continue;
        await applyRewardEvent(env, {
          tenant_id: tenantId,
          workspace_id: workspaceId,
          task_type: resolveThompsonArmTaskType(arm.task_type),
          signal_type: 'auto_error',
          signal_value: 1,
          routing_arm_id: arm.id,
          model_key: cmk,
          apply_cost: false,
          apply_latency: false,
          apply_execution: false,
          dedup_key: `compensation:${cmk}:${Math.floor(Date.now() / MS_PER_DAY)}`,
          reason: 'updateArmsFromMetrics_compensation',
        });
      } catch (e) {
        console.warn('[thompson] compensation', e?.message ?? e);
      }
    }
  }
}

/**
 * Incremental routing-arm feedback after a tool/command completes (Thompson/Beta update).
 * @param {any} env
 * @param {{ taskType: string, mode?: string, modelKey: string, provider?: string, success: boolean, costUsd?: number, durationMs?: number }} payload
 */
/**
 * Tool/command outcome → applyRewardEvent (single writer).
 */
export async function recordCallOutcome(env, payload) {
  if (!env?.DB) return;
  const taskType = resolveThompsonArmTaskType(payload?.taskType);
  const routeKey = payload?.routeKey ?? payload?.chatRouteKey ?? null;
  const modelKey = payload?.modelKey != null ? String(payload.modelKey).trim() : '';
  const workspaceId =
    payload?.workspaceId != null ? String(payload.workspaceId).trim() : '';
  if (!taskType || !modelKey || !workspaceId) {
    console.warn('[thompson] recordCallOutcome skipped — missing identifiers', {
      has_task_type: Boolean(taskType),
      has_model_key: Boolean(modelKey),
      has_workspace_id: Boolean(workspaceId),
    });
    return { skipped: true, reason: 'missing_identifiers' };
  }
  const mode = payload?.mode != null ? String(payload.mode).trim() : 'agent';
  const accounting = buildCallOutcomeRewardFields(payload);
  try {
    const {
      applyTrainingEvent: applyRewardEvent,
      resolveTenantIdForReward,
    } = await import('../../../ai/routing/training/apply-events.js');
    const tenantId = await resolveTenantIdForReward(env, {
      tenantId: payload?.tenantId,
      workspaceId,
      userId: payload?.userId,
    });
    if (!tenantId) {
      console.warn('[thompson] recordCallOutcome skipped — no tenant_id');
      return;
    }
    const dedup =
      payload?.dedupKey != null
        ? String(payload.dedupKey).trim()
        : `call:${workspaceId}:${taskType}:${mode}:${modelKey}:${Math.floor(Date.now() / 1000)}:${accounting.signal_type === 'auto_success' ? 'ok' : 'err'}`;
    await applyRewardEvent(env, {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      task_type: taskType,
      route_key: routeKey,
      mode,
      signal_type: accounting.signal_type,
      signal_value: 1,
      signal_source: 'runtime',
      evidence_class: 'execution',
      model_key: modelKey,
      provider: payload?.provider ?? null,
      cost_usd: accounting.cost_usd,
      latency_ms: accounting.latency_ms,
      apply_cost: accounting.apply_cost,
      apply_latency: accounting.apply_latency,
      apply_execution: accounting.apply_execution,
      dedup_key: dedup,
      reason: 'recordCallOutcome',
      failure_category: accounting.failure_category,
    });
  } catch (e) {
    console.warn('[thompson] recordCallOutcome', e?.message ?? e);
  }
}

export async function decayRoutingArms(env) {
  if (!env?.DB) return;
  await env.DB
    .prepare(
      `
    UPDATE agentsam_routing_arms SET
      success_alpha = MAX(1.0, success_alpha * 0.95),
      success_beta  = MAX(1.0, success_beta  * 0.95),
      decayed_score = MAX(1.0, success_alpha * 0.95)
                    / NULLIF(MAX(1.0, success_alpha * 0.95) + MAX(1.0, success_beta * 0.95), 0),
      last_decay_at = unixepoch(),
      updated_at    = unixepoch()
    WHERE is_eligible = 1
  `,
    )
    .run()
    .catch((e) => {
      console.warn('[thompson] decayRoutingArms', e?.message ?? e);
    });
}
