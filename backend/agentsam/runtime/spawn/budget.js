/**
 * Budget authority for generic Multitask spawning.
 *
 * Budget policy and model pricing are independent of lane decomposition.
 * The orchestrator may choose any graph; this module only resolves ceilings.
 */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

async function loadSpawnBudgetPolicy(env, userId, workspaceId) {
  if (!env?.DB) return {};
  try {
    return (
      (await env.DB.prepare(
        `SELECT max_cost_per_call_usd, max_cost_per_session_usd,
                COALESCE(allow_subagent_spawn, 1) AS allow_subagent_spawn,
                COALESCE(allow_fanout_execution, 0) AS allow_fanout_execution,
                COALESCE(can_run_pty, 0) AS can_run_pty
           FROM agentsam_user_policy
          WHERE user_id = ? AND workspace_id = ?
          LIMIT 1`,
      )
        .bind(trim(userId), trim(workspaceId))
        .first()) || {}
    );
  } catch {
    return {};
  }
}

async function estimateModelCostUsd(env, modelKey, inputTokens, outputTokens) {
  if (!env?.DB || !trim(modelKey)) return 0;
  try {
    const row = await env.DB.prepare(
      `SELECT input_rate_per_mtok, output_rate_per_mtok, cost_per_1k_in, cost_per_1k_out
         FROM agentsam_model_pricing
        WHERE model_key = ?
          AND COALESCE(is_active, 1) = 1
        ORDER BY effective_from DESC
        LIMIT 1`,
    )
      .bind(trim(modelKey))
      .first();
    const input = Math.max(0, Math.floor(Number(inputTokens) || 0));
    const output = Math.max(0, Math.floor(Number(outputTokens) || 0));
    const inputRate = Number(row?.input_rate_per_mtok);
    const outputRate = Number(row?.output_rate_per_mtok);
    const legacyInputRate = Number(row?.cost_per_1k_in);
    const legacyOutputRate = Number(row?.cost_per_1k_out);
    return (
      (input / 1_000_000) * (Number.isFinite(inputRate) ? inputRate : (legacyInputRate / 1000 || 0)) +
      (output / 1_000_000) *
        (Number.isFinite(outputRate) ? outputRate : (legacyOutputRate / 1000 || 0))
    );
  } catch {
    return 0;
  }
}

export function normalizeCostCapUsd(raw) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function clampTimeoutSeconds(raw) {
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(7200, Math.max(60, value));
}

/**
 * Resolve spawn budget values from explicit input, policy, and profile.
 *
 * @param {any} env
 * @param {{ userId: string, workspaceId: string, costCapUsd?: number|null, laneCostCapUsd?: number|null, timeoutSeconds?: number|null, laneTimeoutSeconds?: number|null, masterAgentSlug?: string|null }} p
 */
export async function resolveSpawnBudgetStandards(env, p) {
  const userId = trim(p.userId);
  const workspaceId = trim(p.workspaceId);
  if (!userId || !workspaceId) return { ok: false, error: 'user_id_and_workspace_id_required' };

  const policy = await loadSpawnBudgetPolicy(env, userId, workspaceId);
  const jobCostCapUsd =
    normalizeCostCapUsd(p.costCapUsd) ??
    normalizeCostCapUsd(policy?.max_cost_per_session_usd);
  const laneCostCapUsd =
    normalizeCostCapUsd(p.laneCostCapUsd) ??
    normalizeCostCapUsd(policy?.max_cost_per_call_usd);
  if (jobCostCapUsd == null) return { ok: false, error: 'policy_job_cost_cap_required' };
  if (laneCostCapUsd == null) return { ok: false, error: 'policy_lane_cost_cap_required' };

  let jobTimeoutSeconds = clampTimeoutSeconds(p.timeoutSeconds);
  if (jobTimeoutSeconds == null && env?.DB) {
    const slug = trim(p.masterAgentSlug) || 'agent-sam';
    const row = await env.DB.prepare(
      `SELECT job_timeout_seconds
         FROM agentsam_subagent_profile
        WHERE slug = ? AND COALESCE(is_active, 1) = 1
        ORDER BY can_spawn_subagents DESC
        LIMIT 1`,
    )
      .bind(slug)
      .first()
      .catch(() => null);
    jobTimeoutSeconds = clampTimeoutSeconds(row?.job_timeout_seconds);
  }
  if (jobTimeoutSeconds == null) return { ok: false, error: 'policy_job_timeout_required' };

  return {
    ok: true,
    jobCostCapUsd,
    laneCostCapUsd,
    jobTimeoutSeconds,
    laneTimeoutSeconds: clampTimeoutSeconds(p.laneTimeoutSeconds) ?? jobTimeoutSeconds,
    policy,
  };
}

export async function persistCostCapUsd(env, table, recordId, rawCap) {
  const cap = normalizeCostCapUsd(rawCap);
  if (!env?.DB || !recordId || cap == null) throw new Error('cost_cap_usd_required');
  if (!['agentsam_spawn_job'].includes(table)) throw new Error('budget_table_invalid');
  await env.DB.prepare(`UPDATE ${table} SET cost_cap_usd = ? WHERE id = ?`)
    .bind(cap, trim(recordId))
    .run();
}

export async function estimateAgentRunCostUsd(env, modelKey, inputTokens, outputTokens) {
  return estimateModelCostUsd(env, modelKey, inputTokens, outputTokens);
}
