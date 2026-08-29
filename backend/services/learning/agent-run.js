/**
 * Apply execution learning from the narrow agentsam_agent_run envelope.
 *
 * The run row is intentionally read only for lifecycle/model facts. Routing-arm
 * metadata supplies the learning scope and task type; selected_by is not a
 * filter, so manually selected runs remain eligible.
 */

import { deriveRewardPolicy } from './reward-policy.js';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function welfordUpdate(n, mean, m2, sample) {
  const nextN = (Number(n) || 0) + 1;
  const previousMean = Number(mean) || 0;
  const nextMean = previousMean + (sample - previousMean) / nextN;
  return {
    n: nextN,
    mean: nextMean,
    m2: (Number(m2) || 0) + (sample - previousMean) * (sample - nextMean),
  };
}

async function resolveTenantIdForReward(env, scope = {}) {
  const explicit = trim(scope.tenantId);
  if (explicit) return explicit;
  const workspaceId = trim(scope.workspaceId);
  if (workspaceId && env?.DB) {
    const row = await env.DB.prepare(
      `SELECT tenant_id FROM workspaces WHERE id = ? LIMIT 1`,
    )
      .bind(workspaceId)
      .first()
      .catch(() => null);
    if (row?.tenant_id) return trim(row.tenant_id);
  }
  return null;
}

async function writeExecutionReward(env, runId, run, arm, scope) {
  const workspaceId = trim(scope.workspaceId) || trim(arm.workspace_id);
  const tenantId = await resolveTenantIdForReward(env, scope);
  if (!workspaceId || !tenantId) return { ok: false, reason: 'reward_scope_missing' };

  const status = trim(run.status).toLowerCase();
  const succeeded = status === 'completed';
  const signalType = succeeded ? 'auto_success' : 'auto_error';
  const policy = deriveRewardPolicy({
    evidenceClass: 'execution',
    rewardType: succeeded ? 'execution_success' : 'execution_failure',
    success: succeeded,
    signalType,
    signalValue: 1,
    evidenceCount: 1,
  });
  const dedupKey = `agent_run:${runId}:${succeeded ? 'ok' : 'err'}`;
  const existing = await env.DB.prepare(
    `SELECT id FROM agentsam_reward_events WHERE dedup_key = ? LIMIT 1`,
  )
    .bind(dedupKey)
    .first()
    .catch(() => null);
  if (existing?.id) return { ok: true, deduped: true, runId };

  const costUsd = Number(run.cost_usd);
  const latencyMs = Number(run.latency_ms);
  const applyCost = Number.isFinite(costUsd) && costUsd >= 0;
  const applyLatency = Number.isFinite(latencyMs) && latencyMs >= 0;
  const cost = applyCost ? welfordUpdate(arm.cost_n, arm.cost_mean, arm.cost_m2, costUsd) : null;
  const latency = applyLatency
    ? welfordUpdate(arm.latency_n, arm.latency_mean, arm.latency_m2, latencyMs)
    : null;
  const rewardId = `re_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Math.floor(Date.now() / 1000);
  const insert = env.DB.prepare(
    `INSERT INTO agentsam_reward_events (
       id, tenant_id, workspace_id, task_type, agent_run_id,
       routing_arm_id, model_key, provider, signal_type, signal_source,
       signal_value, alpha_delta, beta_delta, cost_usd, latency_ms,
       reason, metadata_json, dedup_key, created_at_unix
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    rewardId,
    tenantId,
    workspaceId,
    trim(arm.task_type) || trim(run.mode) || 'agent',
    runId,
    trim(arm.id),
    trim(arm.model_key) || trim(run.model_key) || null,
    trim(arm.provider) || null,
    signalType,
    1,
    Number(policy.alphaDelta) || 0,
    Number(policy.betaDelta) || 0,
    applyCost ? costUsd : null,
    applyLatency ? Math.round(latencyMs) : null,
    'applyThompsonLoopFromAgentRun',
    JSON.stringify({ evidence_class: 'execution', reward_type: policy.rewardType || null }),
    dedupKey,
    now,
  );
  const update = env.DB.prepare(
    `UPDATE agentsam_routing_arms SET
       success_alpha = success_alpha + ?,
       success_beta = success_beta + ?,
       cost_n = CASE WHEN ? IS NOT NULL THEN ? ELSE cost_n END,
       cost_mean = CASE WHEN ? IS NOT NULL THEN ? ELSE cost_mean END,
       cost_m2 = CASE WHEN ? IS NOT NULL THEN ? ELSE cost_m2 END,
       latency_n = CASE WHEN ? IS NOT NULL THEN ? ELSE latency_n END,
       latency_mean = CASE WHEN ? IS NOT NULL THEN ? ELSE latency_mean END,
       latency_m2 = CASE WHEN ? IS NOT NULL THEN ? ELSE latency_m2 END,
       total_executions = total_executions + ?,
       updated_at = unixepoch()
     WHERE id = ?`,
  ).bind(
    Number(policy.alphaDelta) || 0,
    Number(policy.betaDelta) || 0,
    cost ? cost.n : null,
    cost?.n ?? 0,
    cost ? cost.mean : null,
    cost?.mean ?? 0,
    cost ? cost.m2 : null,
    cost?.m2 ?? 0,
    latency ? latency.n : null,
    latency?.n ?? 0,
    latency ? latency.mean : null,
    latency?.mean ?? 0,
    latency ? latency.m2 : null,
    latency?.m2 ?? 0,
    policy.banditEligible ? 1 : 0,
    trim(arm.id),
  );
  await env.DB.batch([insert, update]);
  return { ok: true, runId, routingArmId: trim(arm.id), deduped: false };
}

/**
 * @param {any} env
 * @param {string|null|undefined} agentRunId
 * @param {{ tenantId?: string|null, workspaceId?: string|null, userId?: string|null }} scope
 */
export async function applyThompsonLoopFromAgentRun(env, agentRunId, scope = {}) {
  const runId = trim(agentRunId);
  if (!env?.DB || !runId) return { ok: false, reason: 'missing_run_id' };

  let run;
  try {
    run = await env.DB.prepare(
      `SELECT mode, model_key, routing_arm_id, status, cost_usd, latency_ms
         FROM agentsam_agent_run
        WHERE id = ?
        LIMIT 1`,
    )
      .bind(runId)
      .first();
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) };
  }
  const routingArmId = trim(run?.routing_arm_id);
  if (!routingArmId) return { ok: false, reason: 'routing_arm_id_missing' };

  const arm = await env.DB.prepare(
    `SELECT id, workspace_id, task_type, model_key, provider,
            cost_n, cost_mean, cost_m2, latency_n, latency_mean, latency_m2
       FROM agentsam_routing_arms
      WHERE id = ?
      LIMIT 1`,
  )
    .bind(routingArmId)
    .first()
    .catch(() => null);
  if (!arm?.id) return { ok: false, reason: 'routing_arm_not_found' };

  try {
    return await writeExecutionReward(env, runId, run, arm, scope);
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) };
  }
}
