import { jsonResponse } from '../../core/auth.js';

/**
 * @param {import('@cloudflare/workers-types').D1Database | null | undefined} db
 * @param {string} sql
 * @param {unknown[]} binds
 */
async function querySection(db, sql, binds) {
  if (!db) {
    return { ok: false, rows: [], error: 'D1 binding env.DB is not configured' };
  }
  try {
    const { results } = await db.prepare(sql).bind(...binds).all();
    return { ok: true, rows: results || [] };
  } catch (e) {
    return { ok: false, rows: [], error: String(e?.message || e) };
  }
}

/**
 * Blind-spot analytics bundle (6 D1 tables). Never throws.
 *
 * @param {Record<string, unknown>} env
 * @param {{ workspaceId?: string | null; tenantId?: string | null }} workspace
 */
export async function getInsights(env, workspace) {
  const db = env?.DB || null;
  const workspaceId =
    workspace?.workspaceId != null && String(workspace.workspaceId).trim()
      ? String(workspace.workspaceId).trim()
      : '';

  const [
    routing_eto,
    model_quality,
    tool_stats,
    model_evals,
    deploy_health,
    model_drift,
  ] = await Promise.all([
    querySection(
      db,
      `SELECT model_key, provider, task_type, routing_arm_id,
              success, failure, timed_out, sla_breach,
              latency_ms, cost_usd, quality_score,
              reward_score, alpha_delta, beta_delta,
              reward_reason, created_at
       FROM agentsam_performance_eto_events
       WHERE workspace_id = ?
         AND is_smoke_test = 0
       ORDER BY created_at DESC LIMIT 300`,
      [workspaceId],
    ),
    querySection(
      db,
      `SELECT model_key, provider, task_type, subtask_type,
              success_rate, tool_success_rate, hallucination_rate,
              reasoning_quality_score, writing_quality_score,
              code_pass_rate, browser_success_rate,
              avg_latency_ms, avg_cost_usd,
              avg_input_tokens, avg_output_tokens
       FROM agentsam_model_routing_memory
       WHERE workspace_id = ?
       ORDER BY success_rate DESC`,
      [workspaceId],
    ),
    querySection(
      db,
      `SELECT tool_key, source_client, cost_basis,
              SUM(call_count) AS call_count,
              SUM(error_count) AS error_count,
              SUM(attributed_model_cost_usd) AS attributed_model_cost_usd,
              SUM(duration_sum_ms) AS duration_sum_ms,
              MAX(computed_at) AS computed_at
       FROM agentsam_tool_stats_compacted
       WHERE workspace_id = ?
         AND metric_date >= date('now', '-7 days')
       GROUP BY tool_key, source_client, cost_basis
       ORDER BY call_count DESC LIMIT 30`,
      [workspaceId],
    ),
    querySection(
      db,
      `SELECT model_key, provider, task_key, passed, status,
              failure_class, latency_ms, estimated_cost_usd,
              input_tokens, output_tokens, created_at,
              expected_markers_found, expected_markers_total
       FROM agentsam_model_eval_observations
       WHERE workspace_id = ?
       ORDER BY created_at DESC LIMIT 100`,
      [workspaceId],
    ),
    querySection(
      db,
      `SELECT id, worker_name, environment, check_type,
              status, http_status_code, response_time_ms,
              error_message, checked_at, last_checked_at
       FROM agentsam_deployment_health
       WHERE workspace_id = ?
       ORDER BY checked_at_unix DESC LIMIT 20`,
      [workspaceId],
    ),
    querySection(
      db,
      `SELECT model_key, provider, task_type, severity,
              baseline_score, current_score, delta, delta_pct,
              detected_at, acknowledged, routing_arm_paused
       WHERE acknowledged = 0
       ORDER BY detected_at DESC LIMIT 20`,
      [],
    ),
  ]);

  return { routing_eto, model_quality, tool_stats, model_evals, deploy_health, model_drift };
}

/**
 * GET /api/analytics/insights
 *
 * @param {Request} _request
 * @param {URL} _url
 * @param {Record<string, unknown>} env
 * @param {{ workspaceId?: string | null; tenantId?: string | null }} workspace
 */
export async function handleAnalyticsInsights(_request, _url, env, workspace) {
  void _request;
  void _url;
  const payload = await getInsights(env, workspace || {});
  return jsonResponse(payload, 200);
}
