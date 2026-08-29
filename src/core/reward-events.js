/**
 * agentsam_reward_events — single-writer mutation receipts.
 *
 * Contract: every mutation of agentsam_routing_arms success_alpha/beta (and
 * cost/latency/quality when applicable) for a rewardable signal MUST go
 * through applyRewardEvent. Policy math lives in
 * backend/services/learning/reward-policy.js (pure); this module owns identity,
 * arm resolution, dedup, Welford, INSERT receipt, UPDATE arm — one D1 batch.
 *
 * Evidence truth: agentsam_performance_eto_events (+ experience compile).
 * Application truth: this table under policy_version thompson_v2.
 *
 * Domain tables may still record facts; they must NOT independently bump
 * routing-arm bandit columns.
 *
 * Allowed non-ledger mutators: decayRoutingArms() in thompson.js (scheduled
 * prior decay only — not outcome learning).
 */

import { armTaskTypeForRouteKey } from '../../backend/agentsam/runtime/routing/route-keys.js';
import { resolveThompsonArmTaskType } from './resolveModel.js';
import { pragmaTableInfo } from '../../backend/services/retention.js';
import {
  normalizeFailureCategory,
  normalizeFailureCategoryOrUnknown,
} from './reward-failure-category.js';
import {
  deriveRewardPolicy,
  legacySignalSemantics,
  writerKeyFromReason,
} from './reward-policy-bridge.js';

/** @typedef {'user_thumbs_up'|'user_thumbs_down'|'user_star_rating'|'auto_success'|'auto_error'|'auto_latency'|'auto_cost_efficiency'} RewardSignalType */

/**
 * Pure delta math — no I/O.
 * For auto_success / auto_error, finite signalValue > 0 is used as the weight
 * (e.g. 0.5 for recordArmOutcome, 0.8 for scheduleRoutingArmBanditUpdate).
 *
 * @param {string} signalType
 * @param {number} signalValue
 * @returns {{ alphaDelta: number, betaDelta: number, quality?: number|null }}
 */
export function computeRewardDeltas(signalType, signalValue) {
  const t = String(signalType || '').trim();
  const v = Number(signalValue);
  switch (t) {
    case 'user_thumbs_up':
      return { alphaDelta: 1, betaDelta: 0, quality: 1 };
    case 'user_thumbs_down':
      return { alphaDelta: 0, betaDelta: 1, quality: 0 };
    case 'auto_success': {
      const w = Number.isFinite(v) && v > 0 ? v : 1;
      return { alphaDelta: w, betaDelta: 0, quality: null };
    }
    case 'auto_error': {
      const w = Number.isFinite(v) && v > 0 ? v : 1;
      return { alphaDelta: 0, betaDelta: w, quality: null };
    }
    case 'user_star_rating': {
      const stars = Number.isFinite(v) ? Math.min(5, Math.max(1, v)) : 3;
      if (stars >= 4) return { alphaDelta: 1, betaDelta: 0, quality: stars / 5 };
      if (stars <= 2) return { alphaDelta: 0, betaDelta: 1, quality: stars / 5 };
      return { alphaDelta: 0.25, betaDelta: 0.25, quality: stars / 5 };
    }
    case 'auto_latency':
      // Latency-only ledger + Welford; no bandit move.
      return { alphaDelta: 0, betaDelta: 0, quality: null };
    case 'auto_cost_efficiency':
      // Ledger fact only (signal_value = efficiency 0..1). Callers must set
      // apply_cost false when cost was already applied on auto_success/error.
      return { alphaDelta: 0, betaDelta: 0, quality: null };
    default:
      return { alphaDelta: 0, betaDelta: 0, quality: null };
  }
}

/** Welford online update for one sample. */
export function welfordUpdate(n, mean, m2, x) {
  const nn = (Number(n) || 0) + 1;
  const m = Number(mean) || 0;
  const mm2 = Number(m2) || 0;
  const sample = Number(x) || 0;
  const newMean = nn === 1 ? sample : m + (sample - m) / nn;
  const newM2 = mm2 + (sample - m) * (sample - newMean);
  return { n: nn, mean: newMean, m2: newM2 };
}

/**
 * Resolve tenant_id for reward writes (refuses silent partial arm updates).
 * @param {unknown} env
 * @param {{ tenantId?: string|null, workspaceId?: string|null, userId?: string|null }} p
 */
export async function resolveTenantIdForReward(env, p = {}) {
  const explicit = p.tenantId != null ? String(p.tenantId).trim() : '';
  if (explicit) return explicit;
  const ws = p.workspaceId != null ? String(p.workspaceId).trim() : '';
  if (ws && env?.DB) {
    try {
      const row = await env.DB.prepare(
        `SELECT tenant_id FROM workspaces WHERE id = ? LIMIT 1`,
      )
        .bind(ws)
        .first();
      if (row?.tenant_id) return String(row.tenant_id).trim();
    } catch {
      /* ignore */
    }
    try {
      const row = await env.DB.prepare(
        `SELECT tenant_id FROM agentsam_workspace WHERE id = ? OR workspace_ref_id = ? LIMIT 1`,
      )
        .bind(ws, ws)
        .first();
      if (row?.tenant_id) return String(row.tenant_id).trim();
    } catch {
      /* ignore */
    }
  }
  const uid = p.userId != null ? String(p.userId).trim() : '';
  if (uid && env?.DB) {
    try {
      const row = await env.DB.prepare(
        `SELECT COALESCE(active_tenant_id, tenant_id) AS tid FROM auth_users WHERE id = ? LIMIT 1`,
      )
        .bind(uid)
        .first();
      if (row?.tid) return String(row.tid).trim();
    } catch {
      /* ignore */
    }
    try {
      const row = await env.DB.prepare(
        `SELECT tenant_id FROM users WHERE id = ? LIMIT 1`,
      )
        .bind(uid)
        .first();
      if (row?.tenant_id) return String(row.tenant_id).trim();
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Resolve routing arm id when caller only has model_key + workspace + task_type.
 * Prefer global (empty workspace_id) posteriors — workspace is not the bandit dimension.
 * Reward resolution includes paused arms (learning continues; Thompson draw filters pause).
 * Stale explicit ids fall through to model_key + create-on-miss.
 * @param {unknown} env
 * @param {{ routing_arm_id?: string|null, model_key?: string|null, workspace_id: string, task_type: string, route_key?: string|null, routeKey?: string|null, mode?: string|null, provider?: string|null }} p
 */
export async function resolveRewardArmId(env, p) {
  const explicit = p.routing_arm_id != null ? String(p.routing_arm_id).trim() : '';
  if (explicit && env?.DB) {
    const live = await env.DB.prepare(
      `SELECT id, workspace_id, model_key, task_type, mode, provider
       FROM agentsam_routing_arms WHERE id = ? LIMIT 1`,
    )
      .bind(explicit)
      .first()
      .catch(() => null);
    if (live?.id != null && !String(live.workspace_id || '').trim()) {
      return String(live.id);
    }
    if (live?.id != null) {
      return resolveRewardArmId(env, {
        ...p,
        routing_arm_id: null,
        model_key: String(live.model_key || p.model_key || '').trim() || p.model_key,
        task_type: live.task_type || p.task_type,
        mode: live.mode || p.mode,
        provider: live.provider || p.provider,
      });
    }
    // Stale/ghost arm id — do not short-circuit; resolve via model_key + ensure.
  } else if (explicit) {
    return explicit;
  }

  const mk = p.model_key != null ? String(p.model_key).trim() : '';
  const routeKey = p.route_key ?? p.routeKey;
  const tt = routeKey != null && String(routeKey).trim()
    ? armTaskTypeForRouteKey(routeKey)
    : resolveThompsonArmTaskType(p.task_type);
  const mode = p.mode != null ? String(p.mode).trim() : '';
  if (!mk || !tt || !env?.DB) return null;

  // 1) Global + mode (learning SSOT) — include paused so auto-pause still gets credit
  if (mode) {
    const globalByMode = await env.DB.prepare(
      `SELECT id FROM agentsam_routing_arms
       WHERE model_key = ? AND COALESCE(TRIM(workspace_id), '') = '' AND task_type = ? AND mode = ?
       ORDER BY is_active DESC, is_eligible DESC, updated_at DESC
       LIMIT 1`,
    )
      .bind(mk, tt, mode)
      .first()
      .catch(() => null);
    if (globalByMode?.id != null) return String(globalByMode.id);
  }

  // 2) Global any mode for task
  const globalAny = await env.DB.prepare(
    `SELECT id FROM agentsam_routing_arms
     WHERE model_key = ? AND COALESCE(TRIM(workspace_id), '') = '' AND task_type = ?
     ORDER BY is_active DESC, is_eligible DESC, updated_at DESC
     LIMIT 1`,
  )
    .bind(mk, tt)
    .first()
    .catch(() => null);
  if (globalAny?.id != null) return String(globalAny.id);

  // Observed / picker models: create global arm on miss so failures still train Thompson.
  try {
    const { ensureObservedModelRoutingArm } = await import('../../backend/agentsam/runtime/routing/routing-arms-ensure.js');
    const ensured = await ensureObservedModelRoutingArm(env, {
      modelKey: mk,
      taskType: tt,
      mode: mode || 'agent',
      provider: p.provider,
    });
    if (ensured?.armId) return String(ensured.armId);
  } catch (e) {
    console.warn('[reward-events] ensureObservedModelRoutingArm', e?.message ?? e);
  }

  return null;
}

/**
 * Load Welford state for armId; if the row is missing, create-on-miss via model_key then re-read.
 * This is the hard gate before INSERT+UPDATE — never score against a ghost arm id.
 * @param {unknown} env
 * @param {{ armId: string, model_key?: string|null, task_type: string, mode?: string|null, provider?: string|null }} p
 */
async function loadArmStatsOrEnsure(env, p) {
  let armId = String(p.armId || '').trim();
  if (!armId || !env?.DB) return { armId: null, armStats: null, created: false };

  const selectSql = `SELECT id, is_paused, cost_n, cost_mean, cost_m2, latency_n, latency_mean, latency_m2
     FROM agentsam_routing_arms WHERE id = ? LIMIT 1`;

  let armStats = await env.DB.prepare(selectSql).bind(armId).first().catch(() => null);
  if (armStats) {
    return {
      armId,
      armStats,
      created: false,
      paused: Number(armStats.is_paused) === 1,
    };
  }

  const mk = p.model_key != null ? String(p.model_key).trim() : '';
  if (!mk) {
    return { armId: null, armStats: null, created: false };
  }

  const { ensureObservedModelRoutingArm } = await import('../../backend/agentsam/runtime/routing/routing-arms-ensure.js');
  const ensured = await ensureObservedModelRoutingArm(env, {
    modelKey: mk,
    taskType: p.task_type,
    mode: p.mode || 'agent',
    provider: p.provider,
  });
  if (!ensured?.armId) {
    return { armId: null, armStats: null, created: false };
  }

  armId = String(ensured.armId);
  armStats = await env.DB.prepare(selectSql).bind(armId).first().catch(() => null);
  if (!armStats) {
    return { armId: null, armStats: null, created: false };
  }
  return {
    armId,
    armStats,
    created: Boolean(ensured.created),
    paused: Number(armStats.is_paused) === 1,
  };
}

/**
 * Single writer: INSERT reward event + UPDATE arm in one D1 batch.
 * Cost/latency use full Welford (n, mean, m2).
 *
 * @param {unknown} env
 * @param {{
 *   tenant_id: string,
 *   workspace_id: string,
 *   task_type: string,
 *   signal_type: string,
 *   signal_value?: number,
 *   signal_source?: string,
 *   routing_arm_id?: string|null,
 *   model_key?: string|null,
 *   provider?: string|null,
 *   content_tier?: string|null,
 *   mode?: string|null,
 *   cost_usd?: number|null,
 *   latency_ms?: number|null,
 *   apply_cost?: boolean,
 *   apply_latency?: boolean,
 *   apply_execution?: boolean,
 *   agent_run_id?: string|null,
 *   tool_call_log_id?: string|null,
 *   tool_chain_id?: string|null,
 *   reason?: string|null,
 *   metadata?: Record<string, unknown>|null,
 *   dedup_key?: string|null,
 *   failure_category?: string|null,
 *   failure_origin?: string|null,
 *   failure_code?: string|null,
 *   source_table?: string|null,
 *   source_id?: string|null,
 *   eto_event_id?: string|null,
 *   experience_id?: string|null,
 *   evidence_class?: string|null,
 *   reward_type?: string|null,
 *   reward_score?: number|null,
 *   reward_weight?: number|null,
 *   evidence_count?: number|null,
 *   writer_key?: string|null,
 *   policy_version?: string|null,
 * }} p
 */
export async function applyRewardEvent(env, p) {
  if (!env?.DB) throw new Error('Database not configured');
  const tenantId = String(p.tenant_id || '').trim();
  const workspaceId = String(p.workspace_id || '').trim();
  const routeKey = p.route_key ?? p.routeKey;
  const taskType = routeKey != null && String(routeKey).trim()
    ? armTaskTypeForRouteKey(routeKey)
    : resolveThompsonArmTaskType(p.task_type);
  const signalType = String(p.signal_type || '').trim();
  if (!tenantId) throw new Error('tenant_id required');
  if (!workspaceId) throw new Error('workspace_id required');
  if (!taskType) throw new Error('task_type required');
  if (!signalType) throw new Error('signal_type required');

  const signalValue = Number.isFinite(Number(p.signal_value)) ? Number(p.signal_value) : 0;
  const legacySemantics = legacySignalSemantics(signalType);

  const failureCategoryRaw =
    signalType === 'auto_error'
      ? p.failure_category != null
        ? normalizeFailureCategory(p.failure_category)
        : null
      : normalizeFailureCategory(p.failure_category);
  const failureCategoryForPolicy =
    signalType === 'auto_error' ? failureCategoryRaw || 'unknown' : failureCategoryRaw;

  const policy = deriveRewardPolicy({
    evidenceClass: p.evidence_class ?? legacySemantics.evidenceClass,
    rewardType: p.reward_type ?? legacySemantics.rewardType,
    success: signalType === 'auto_success' ? true : signalType === 'auto_error' ? false : null,
    failureOrigin: p.failure_origin ?? null,
    failureCategory: failureCategoryForPolicy,
    failureCode: p.failure_code ?? null,
    qualityScore:
      p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata)
        ? p.metadata.quality_score
        : null,
    evidenceCount: p.evidence_count ?? null,
    requestedWeight: null,
    rewardScore: p.reward_score ?? null,
    signalType,
    signalValue,
  });

  let { alphaDelta, betaDelta } = policy;
  const quality = policy.quality;
  const banditEligible = Boolean(policy.banditEligible);
  const failureCategory =
    signalType === 'auto_error'
      ? normalizeFailureCategoryOrUnknown(failureCategoryRaw)
      : failureCategoryRaw;
  const failureOrigin =
    p.failure_origin != null && String(p.failure_origin).trim()
      ? String(p.failure_origin).trim().slice(0, 32)
      : policy.failureOrigin;
  const failureCode =
    p.failure_code != null && String(p.failure_code).trim()
      ? String(p.failure_code).trim().slice(0, 128)
      : policy.failureCode;

  let armId = await resolveRewardArmId(env, {
    routing_arm_id: p.routing_arm_id,
    model_key: p.model_key,
    workspace_id: workspaceId,
    task_type: taskType,
    route_key: routeKey ?? null,
    mode: p.mode,
    provider: p.provider,
  });
  if (!armId) throw new Error('routing_arm_id_unresolved');

  const id = `re_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const nowUnix = Math.floor(Date.now() / 1000);
  const dedup =
    p.dedup_key != null && String(p.dedup_key).trim()
      ? String(p.dedup_key).trim().slice(0, 191)
      : null;
  const metaObj =
    p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata)
      ? { ...p.metadata }
      : {};
  if (failureCategory) metaObj.failure_category = failureCategory;
  if (failureOrigin) metaObj.failure_origin = failureOrigin;
  if (failureCode) metaObj.failure_code = failureCode;
  if (policy.skipReason) metaObj.bandit_skip_reason = policy.skipReason;
  if (!banditEligible) metaObj.bandit_skipped = true;
  if (policy.evidenceCount > 1) metaObj.evidence_count = policy.evidenceCount;
  const meta = JSON.stringify(metaObj);

  const costRaw = Number(p.cost_usd);
  const metricsEligible =
    signalType.startsWith('auto_') || signalType === 'auto_cost_efficiency';
  const applyCost =
    metricsEligible &&
    (p.apply_cost === true ||
      (p.apply_cost !== false &&
        Number.isFinite(costRaw) &&
        costRaw >= 0 &&
        (signalType.startsWith('auto_') || signalType === 'auto_cost_efficiency')));
  const costUsd = applyCost && Number.isFinite(costRaw) && costRaw >= 0 ? costRaw : null;

  const latencyRaw = Number(p.latency_ms);
  const applyLatency =
    metricsEligible &&
    (p.apply_latency === true ||
      (p.apply_latency !== false &&
        Number.isFinite(latencyRaw) &&
        latencyRaw >= 0 &&
        (signalType.startsWith('auto_') || signalType === 'auto_latency')));
  const latencyMs =
    applyLatency && Number.isFinite(latencyRaw) && latencyRaw >= 0 ? Math.round(latencyRaw) : null;

  const applyExecution =
    banditEligible &&
    (p.apply_execution === true ||
      (p.apply_execution !== false &&
        (signalType === 'auto_success' || signalType === 'auto_error')));
  const applyQuality = banditEligible && quality != null && Number.isFinite(quality);

  // Upsert-arm-if-missing before Welford read — explicit picks (e.g. composer-2.5)
  // must not abort the whole batch with routing_arm_missing.
  const loaded = await loadArmStatsOrEnsure(env, {
    armId,
    model_key: p.model_key,
    task_type: taskType,
    mode: p.mode,
    provider: p.provider,
  });
  if (!loaded.armStats || !loaded.armId) {
    throw new Error(
      `routing_arm_missing:${armId}:model=${p.model_key != null ? String(p.model_key) : ''}`,
    );
  }
  armId = loaded.armId;
  const armStats = loaded.armStats;

  let nextCostN = null;
  let nextCostMean = null;
  let nextCostM2 = null;
  if (costUsd != null) {
    const w = welfordUpdate(armStats.cost_n, armStats.cost_mean, armStats.cost_m2, costUsd);
    nextCostN = w.n;
    nextCostMean = w.mean;
    nextCostM2 = w.m2;
  }

  let nextLatN = null;
  let nextLatMean = null;
  let nextLatM2 = null;
  if (latencyMs != null) {
    const w = welfordUpdate(armStats.latency_n, armStats.latency_mean, armStats.latency_m2, latencyMs);
    nextLatN = w.n;
    nextLatMean = w.mean;
    nextLatM2 = w.m2;
  }

  const rewardCols = await pragmaTableInfo(env.DB, 'agentsam_reward_events');
  const hasFailureCategoryCol = rewardCols.has('failure_category');
  const hasToolChainIdCol = rewardCols.has('tool_chain_id');
  const hasRewardV2Cols = rewardCols.has('policy_version');
  const toolChainId =
    p.tool_chain_id != null && String(p.tool_chain_id).trim() !== ''
      ? String(p.tool_chain_id).trim()
      : null;

  const writerKey =
    (p.writer_key != null && String(p.writer_key).trim()) ||
    writerKeyFromReason(p.reason) ||
    null;
  const policyVersion = String(p.policy_version || policy.policyVersion || '').slice(0, 64) || null;
  const evidenceClass = String(p.evidence_class || legacySemantics.evidenceClass).slice(0, 32);
  const rewardType = String(p.reward_type || legacySemantics.rewardType).slice(0, 64);
  const sourceTable =
    p.source_table != null && String(p.source_table).trim()
      ? String(p.source_table).trim().slice(0, 64)
      : null;
  const sourceId =
    p.source_id != null && String(p.source_id).trim()
      ? String(p.source_id).trim().slice(0, 128)
      : null;
  const etoEventId =
    p.eto_event_id != null && String(p.eto_event_id).trim()
      ? String(p.eto_event_id).trim().slice(0, 128)
      : null;
  const experienceId =
    p.experience_id != null && String(p.experience_id).trim()
      ? String(p.experience_id).trim().slice(0, 128)
      : null;
  const skipReason =
    policy.skipReason != null ? String(policy.skipReason).slice(0, 128) : null;

  // Gate auto_cost_efficiency: never insert when cost is missing/zero.
  if (signalType === 'auto_cost_efficiency' && !(Number.isFinite(costRaw) && costRaw > 0)) {
    return {
      ok: false,
      skipped: true,
      reason: 'auto_cost_efficiency_requires_cost_usd',
      arm_id: armId,
    };
  }

  const colNames = [
    'id',
    'tenant_id',
    'workspace_id',
    'task_type',
    'agent_run_id',
    'tool_call_log_id',
    ...(hasToolChainIdCol ? ['tool_chain_id'] : []),
    'routing_arm_id',
    'model_key',
    'provider',
    'content_tier',
    'signal_type',
    'signal_source',
    'signal_value',
    'alpha_delta',
    'beta_delta',
    'cost_usd',
    'latency_ms',
    'reason',
    'metadata_json',
    'dedup_key',
    'created_at_unix',
    ...(hasFailureCategoryCol ? ['failure_category'] : []),
    ...(hasRewardV2Cols
      ? [
          'source_table',
          'source_id',
          'eto_event_id',
          'experience_id',
          'evidence_class',
          'reward_type',
          'reward_score',
          'reward_weight',
          'evidence_count',
          'bandit_eligible',
          'policy_version',
          'skip_reason',
          'failure_origin',
          'failure_code',
          'writer_key',
          'applied_at_unix',
        ]
      : []),
  ];
  const binds = [
    id,
    tenantId,
    workspaceId,
    taskType,
    p.agent_run_id ?? null,
    p.tool_call_log_id ?? null,
    ...(hasToolChainIdCol ? [toolChainId] : []),
    armId,
    p.model_key ?? null,
    p.provider ?? null,
    p.content_tier ?? null,
    signalType,
    String(p.signal_source || (signalType.startsWith('user_') ? 'user' : 'system')).slice(0, 32),
    signalValue,
    alphaDelta,
    betaDelta,
    costUsd,
    latencyMs,
    p.reason != null ? String(p.reason).slice(0, 500) : null,
    meta.slice(0, 4000),
    dedup,
    nowUnix,
    ...(hasFailureCategoryCol ? [failureCategory] : []),
    ...(hasRewardV2Cols
      ? [
          sourceTable,
          sourceId,
          etoEventId,
          experienceId,
          evidenceClass,
          rewardType,
          policy.rewardScore,
          policy.rewardWeight,
          policy.evidenceCount,
          banditEligible ? 1 : 0,
          policyVersion,
          skipReason,
          failureOrigin,
          failureCode,
          writerKey,
          nowUnix,
        ]
      : []),
  ];
  const insertStmt = env.DB.prepare(
    `INSERT INTO agentsam_reward_events (${colNames.join(', ')})
     VALUES (${colNames.map(() => '?').join(', ')})`,
  ).bind(...binds);

  // Pause gates Thompson *selection* only. Learning still writes so dashboards
  // and unpause decisions see why the arm was paused (failures after auto-pause).
  const updateStmt = env.DB.prepare(
    `UPDATE agentsam_routing_arms SET
       success_alpha = success_alpha + ?,
       success_beta  = success_beta + ?,
       cost_n = CASE WHEN ? IS NOT NULL THEN ? ELSE cost_n END,
       cost_mean = CASE WHEN ? IS NOT NULL THEN ? ELSE cost_mean END,
       cost_m2 = CASE WHEN ? IS NOT NULL THEN ? ELSE cost_m2 END,
       latency_n = CASE WHEN ? IS NOT NULL THEN ? ELSE latency_n END,
       latency_mean = CASE WHEN ? IS NOT NULL THEN ? ELSE latency_mean END,
       latency_m2 = CASE WHEN ? IS NOT NULL THEN ? ELSE latency_m2 END,
       avg_quality_score = CASE
         WHEN ? IS NOT NULL THEN ((COALESCE(avg_quality_score, 0) * COALESCE(quality_n, 0)) + ?) / (COALESCE(quality_n, 0) + 1)
         ELSE avg_quality_score
       END,
       quality_n = CASE WHEN ? IS NOT NULL THEN COALESCE(quality_n, 0) + 1 ELSE quality_n END,
       total_executions = total_executions + ?,
       updated_at = unixepoch()
     WHERE id = ?`,
  ).bind(
    alphaDelta,
    betaDelta,
    nextCostN,
    nextCostN ?? 0,
    nextCostMean,
    nextCostMean ?? 0,
    nextCostM2,
    nextCostM2 ?? 0,
    nextLatN,
    nextLatN ?? 0,
    nextLatMean,
    nextLatMean ?? 0,
    nextLatM2,
    nextLatM2 ?? 0,
    applyQuality ? quality : null,
    applyQuality ? quality : 0,
    applyQuality ? quality : null,
    applyExecution ? 1 : 0,
    armId,
  );

  try {
    await env.DB.batch([insertStmt, updateStmt]);
    return {
      ok: true,
      id,
      routing_arm_id: armId,
      alpha_delta: alphaDelta,
      beta_delta: betaDelta,
      failure_category: failureCategory,
      bandit_applied: Boolean(
        banditEligible && (alphaDelta !== 0 || betaDelta !== 0 || applyExecution),
      ),
      bandit_eligible: banditEligible,
      policy_version: policyVersion,
      evidence_count: policy.evidenceCount,
      skip_reason: skipReason,
      deduped: false,
      arm_created: Boolean(loaded.created),
      arm_paused: Boolean(loaded.paused),
    };
  } catch (e) {
    const msg = String(e?.message || e || '');
    if (dedup && /UNIQUE|constraint/i.test(msg)) {
      return {
        ok: true,
        id: null,
        routing_arm_id: armId,
        failure_category: failureCategory,
        deduped: true,
      };
    }
    throw e;
  }
}

/** @deprecated Use applyRewardEvent — insert-only creates a fifth parallel writer. */
export async function recordRewardEvent(env, p) {
  return applyRewardEvent(env, {
    ...p,
    apply_cost: false,
    apply_latency: false,
    apply_execution: false,
  });
}
