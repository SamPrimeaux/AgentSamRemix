/**
 * Direct agentsam_usage_events → agentsam_usage_rollups_daily rollup (yesterday UTC).
 * Raw events are ephemeral — purge after rollup via purgeUsageEventsAfterRollup.
 */

import { pragmaTableInfo } from '../../backend/services/retention.js';

/**
 * @param {any} env
 */
export async function rollupUsageEventsDaily(env) {
  if (!env?.DB) return { ok: false, skipped: true, reason: 'no_db' };

  const srcCols = await pragmaTableInfo(env.DB, 'agentsam_usage_events');
  const rollCols = await pragmaTableInfo(env.DB, 'agentsam_usage_rollups_daily');
  if (!srcCols.has('created_at') || !srcCols.has('tenant_id') || !rollCols.size) {
    return { ok: false, skipped: true, reason: 'schema' };
  }

  const wsExpr = srcCols.has('workspace_id')
    ? 'workspace_id'
    : `'__tenant__'`;
  const tokensInExpr = srcCols.has('input_tokens')
    ? 'SUM(COALESCE(tokens_in, input_tokens, 0))'
    : 'SUM(COALESCE(tokens_in, 0))';
  const tokensOutExpr = srcCols.has('output_tokens')
    ? 'SUM(COALESCE(tokens_out, output_tokens, 0))'
    : 'SUM(COALESCE(tokens_out, 0))';
  const hasTool = srcCols.has('tool_name');
  const hasStatus = srcCols.has('status');

  const toolCallsExpr = hasTool
    ? `COUNT(CASE WHEN tool_name IS NOT NULL THEN 1 END)`
    : '0';
  const toolSuccessExpr =
    hasTool && hasStatus
      ? `COUNT(CASE WHEN tool_name IS NOT NULL AND status = 'ok' THEN 1 END)`
      : '0';
  const toolFailExpr =
    hasTool && hasStatus
      ? `COUNT(CASE WHEN tool_name IS NOT NULL AND status != 'ok' THEN 1 END)`
      : '0';
  const errorCountExpr = hasStatus
    ? `COUNT(CASE WHEN status != 'ok' THEN 1 END)`
    : '0';

  const sql = `
    INSERT INTO agentsam_usage_rollups_daily
      (tenant_id, workspace_id, day,
       ai_calls, tokens_in, tokens_out, cost_usd,
       tool_calls, tool_successes, tool_failures,
       error_count, provider_breakdown_json, top_tools_json,
       rollup_source, rolled_up_at)
    SELECT
      tenant_id,
      ${wsExpr} AS workspace_id,
      date(created_at, 'unixepoch') AS day,
      COUNT(*) AS ai_calls,
      ${tokensInExpr} AS tokens_in,
      ${tokensOutExpr} AS tokens_out,
      SUM(COALESCE(cost_usd, 0)) AS cost_usd,
      ${toolCallsExpr} AS tool_calls,
      ${toolSuccessExpr} AS tool_successes,
      ${toolFailExpr} AS tool_failures,
      ${errorCountExpr} AS error_count,
      '{}' AS provider_breakdown_json,
      '[]' AS top_tools_json,
      'daily_cron' AS rollup_source,
      unixepoch() AS rolled_up_at
    FROM agentsam_usage_events
    WHERE date(created_at, 'unixepoch') = date('now', '-1 day')
    GROUP BY tenant_id, ${wsExpr}, date(created_at, 'unixepoch')
    ON CONFLICT (tenant_id, workspace_id, day) DO UPDATE SET
      ai_calls       = agentsam_usage_rollups_daily.ai_calls       + excluded.ai_calls,
      tokens_in      = agentsam_usage_rollups_daily.tokens_in      + excluded.tokens_in,
      tokens_out     = agentsam_usage_rollups_daily.tokens_out     + excluded.tokens_out,
      cost_usd       = agentsam_usage_rollups_daily.cost_usd       + excluded.cost_usd,
      tool_calls     = agentsam_usage_rollups_daily.tool_calls     + excluded.tool_calls,
      tool_successes = agentsam_usage_rollups_daily.tool_successes + excluded.tool_successes,
      tool_failures  = agentsam_usage_rollups_daily.tool_failures  + excluded.tool_failures,
      error_count    = agentsam_usage_rollups_daily.error_count    + excluded.error_count,
      rolled_up_at   = unixepoch()
  `;

  try {
    const r = await env.DB.prepare(sql).run();
    const changes = Number(r?.meta?.changes ?? r?.changes ?? 0) || 0;
    console.log('[compaction]', 'usage_events_rollup', { changes });
    return { ok: true, changes };
  } catch (e) {
    console.warn('[usage-events-rollup]', e?.message ?? e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Delete usage events older than yesterday (rolled-up data is durable).
 * @param {any} env
 */
export async function purgeUsageEventsAfterRollup(env) {
  if (!env?.DB) return { deleted: 0 };

  const cols = await pragmaTableInfo(env.DB, 'agentsam_usage_events');
  if (!cols.has('created_at')) return { deleted: 0, skipped: true };

  const res = await env.DB.prepare(
    `DELETE FROM agentsam_usage_events
     WHERE date(created_at, 'unixepoch') < date('now', '-1 day')
     LIMIT 500`,
  )
    .run()
    .catch((e) => {
      console.warn('[usage-events-rollup] purge', e?.message ?? e);
      return null;
    });

  const deleted = Number(res?.meta?.changes ?? res?.changes ?? 0) || 0;
  console.log('[compaction]', 'usage_events_purge', { rowCount: deleted });
  return { deleted };
}
