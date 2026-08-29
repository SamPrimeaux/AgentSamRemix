/**
 * Batch 2 — feed existing intelligence tables from tool telemetry spines.
 *
 * EPM source: agentsam_tool_call_log (rich: cost/tokens/model/errors) via epm-tool-call-log-rollup.js
 * Usage source: agentsam_tool_chain (lean index) — unchanged.
 *
 * ETO: not written per tool_chain row (CHECK excludes source; catalog ledgers via tool_call_log).
 * Reward stays on applyRewardEvent.
 */

import { pragmaTableInfo, tableExists } from '../../backend/services/retention.js';
import { rollupToolCallLogToExecutionPerformanceMetrics } from './epm-tool-call-log-rollup.js';

export { rollupToolCallLogToExecutionPerformanceMetrics };

/** @deprecated lean chain has no output_summary; kept for call-site compat */
export const EXEC_JOURNAL_SUMMARY_MIN = 0;

/** Write-path settle cutoff (QC writepath Tier 2). Pre-cutoff empties are not gated. */
export const COMPACT_JOURNAL_FEED_CUTOFF_UNIX = 1_785_520_900;

const EPM = 'agentsam_execution_performance_metrics';
const USAGE = 'agentsam_usage_rollups_daily';
const CHAIN = 'agentsam_tool_chain';

const EPM_ON_CONFLICT = `ON CONFLICT(
       tenant_id,
       workspace_id,
       metric_date,
       metric_grain,
       source_table,
       command_id,
       command_slug,
       tool_name,
       tool_category,
       workflow_id,
       task_type,
       intent_category,
       model_key,
       provider,
       trigger_key
     ) DO UPDATE SET
       execution_count = excluded.execution_count,
       success_count = excluded.success_count,
       failure_count = excluded.failure_count,
       timeout_count = COALESCE(excluded.timeout_count, timeout_count),
       avg_duration_ms = excluded.avg_duration_ms,
       min_duration_ms = excluded.min_duration_ms,
       max_duration_ms = excluded.max_duration_ms,
       success_rate_percent = excluded.success_rate_percent,
       failure_rate_percent = COALESCE(excluded.failure_rate_percent, failure_rate_percent),
       total_tokens_consumed = excluded.total_tokens_consumed,
       input_tokens = COALESCE(excluded.input_tokens, input_tokens),
       output_tokens = COALESCE(excluded.output_tokens, output_tokens),
       total_cost_usd = excluded.total_cost_usd,
       avg_cost_usd = COALESCE(excluded.avg_cost_usd, avg_cost_usd),
       total_cost_cents = excluded.total_cost_cents,
       error_types_json = COALESCE(excluded.error_types_json, error_types_json),
       metadata_json = COALESCE(excluded.metadata_json, metadata_json),
       last_computed_at = unixepoch()`;

/**
 * @param {string | null | undefined} metricDate YYYY-MM-DD or empty → yesterday UTC
 */
export function resolveFeedMetricDate(metricDate) {
  const raw = metricDate != null ? String(metricDate).trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

/**
 * @param {string} metricDate
 * @returns {{ dayStartUnix: number, dayEndUnix: number }}
 */
export function metricDateUnixWindow(metricDate) {
  const day = resolveFeedMetricDate(metricDate);
  const dayStartUnix = Math.floor(Date.parse(`${day}T00:00:00.000Z`) / 1000);
  const dayEndUnix = dayStartUnix + 86_400;
  return { dayStartUnix, dayEndUnix };
}

/**
 * Eligible completed/failed lean chain rows for a metric day (no summary gate).
 * @param {any} env
 * @param {{ metricDate?: string, cutoffUnix?: number }} [opts]
 */
export async function assertToolChainSummariesForFeed(env, opts = {}) {
  if (!env?.DB) throw new Error('execution_journal_learning_feed: no_db');
  const metricDate = resolveFeedMetricDate(opts.metricDate);
  const { dayStartUnix, dayEndUnix } = metricDateUnixWindow(metricDate);
  const cutoff = Math.max(
    Number(opts.cutoffUnix) || COMPACT_JOURNAL_FEED_CUTOFF_UNIX,
    dayStartUnix,
  );
  const gateStart = Math.max(cutoff, dayStartUnix);

  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS eligible
     FROM ${CHAIN}
     WHERE tool_status IN ('completed', 'failed')
       AND started_at >= ?
       AND started_at < ?`,
  )
    .bind(gateStart, dayEndUnix)
    .first()
    .catch((e) => {
      throw new Error(`execution_journal_learning_feed: eligible_gate_query_failed: ${e?.message ?? e}`);
    });

  const eligible = Number(row?.eligible) || 0;

  return {
    metricDate,
    dayStartUnix,
    dayEndUnix,
    gateStartUnix: gateStart,
    cutoffUnix: cutoff,
    eligible,
    withSummary: eligible,
    missingSummary: 0,
    summaryMin: EXEC_JOURNAL_SUMMARY_MIN,
  };
}

/**
 * @deprecated Prefer rollupToolCallLogToExecutionPerformanceMetrics — kept as no-op shim
 * so old imports don't crash. Lean tool_chain must not feed EPM (junk identical JSON).
 * @param {any} env
 * @param {{ metricDate?: string }} [opts]
 */
export async function rollupToolChainToExecutionPerformanceMetrics(env, opts = {}) {
  return rollupToolCallLogToExecutionPerformanceMetrics(env, opts);
}

/**
 * Upsert tool_* counters on usage_rollups_daily from lean tool_chain rows.
 * Uses MAX so nightly tool_call_log counts are not clobbered downward.
 * @param {any} env
 * @param {{ metricDate?: string, gate?: Awaited<ReturnType<typeof assertToolChainSummariesForFeed>> }} [opts]
 */
export async function rollupToolChainToUsageDaily(env, opts = {}) {
  if (!env?.DB) return { ok: false, skipped: true, reason: 'no_db', changes: 0 };
  if (!(await tableExists(env.DB, USAGE))) {
    return { ok: false, skipped: true, reason: 'usage_rollups_missing', changes: 0 };
  }
  if (!(await tableExists(env.DB, CHAIN))) {
    return { ok: false, skipped: true, reason: 'tool_chain_missing', changes: 0 };
  }

  const gate = opts.gate || (await assertToolChainSummariesForFeed(env, opts));
  if (gate.eligible <= 0) {
    return {
      ok: true,
      skipped: true,
      reason: 'no_eligible_rows',
      changes: 0,
      gate,
    };
  }

  const rollCols = await pragmaTableInfo(env.DB, USAGE);
  if (!rollCols.has('tool_calls') || !rollCols.has('day')) {
    return { ok: false, skipped: true, reason: 'usage_schema', changes: 0 };
  }

  const sql = `
    INSERT INTO ${USAGE} (
      tenant_id, workspace_id, day,
      tool_calls, tool_successes, tool_failures,
      rollup_source, rolled_up_at
    )
    SELECT
      COALESCE(NULLIF(trim(tc.tenant_id), ''), 'platform'),
      COALESCE(NULLIF(trim(tc.workspace_id), ''), ''),
      ?,
      COUNT(*),
      SUM(CASE WHEN tc.tool_status = 'completed' THEN 1 ELSE 0 END),
      SUM(CASE WHEN tc.tool_status = 'failed' THEN 1 ELSE 0 END),
      'tool_chain_learning_feed',
      unixepoch()
    FROM ${CHAIN} tc
    WHERE tc.tool_status IN ('completed', 'failed')
      AND tc.started_at >= ?
      AND tc.started_at < ?
      AND COALESCE(NULLIF(trim(tc.workspace_id), ''), '') != ''
    GROUP BY
      COALESCE(NULLIF(trim(tc.tenant_id), ''), 'platform'),
      COALESCE(NULLIF(trim(tc.workspace_id), ''), '')
    ON CONFLICT(tenant_id, workspace_id, day) DO UPDATE SET
      tool_calls = MAX(${USAGE}.tool_calls, excluded.tool_calls),
      tool_successes = MAX(${USAGE}.tool_successes, excluded.tool_successes),
      tool_failures = MAX(${USAGE}.tool_failures, excluded.tool_failures),
      rolled_up_at = unixepoch(),
      rollup_source = CASE
        WHEN ${USAGE}.rollup_source IS NULL OR trim(${USAGE}.rollup_source) = ''
          THEN 'tool_chain_learning_feed'
        WHEN ${USAGE}.rollup_source LIKE '%tool_chain_learning_feed%'
          THEN ${USAGE}.rollup_source
        ELSE ${USAGE}.rollup_source || '+tool_chain_learning_feed'
      END
  `;

  const r = await env.DB.prepare(sql)
    .bind(gate.metricDate, gate.dayStartUnix, gate.dayEndUnix)
    .run();

  const changes = Number(r.meta?.changes ?? r.changes ?? 0) || 0;
  return { ok: true, changes, gate };
}

/**
 * Full Batch 2 feed for one metric day.
 * @param {any} env
 * @param {{ metricDate?: string, cutoffUnix?: number, allowMissingSummaries?: boolean }} [opts]
 */
export async function runExecutionJournalLearningFeed(env, opts = {}) {
  if (!env?.DB) {
    throw new Error('execution_journal_learning_feed: no_db');
  }

  const gate = await assertToolChainSummariesForFeed(env, opts);
  const epm = await rollupToolCallLogToExecutionPerformanceMetrics(env, {
    metricDate: gate.metricDate,
  });
  const usage = await rollupToolChainToUsageDaily(env, { ...opts, gate });

  return {
    ok: true,
    metricDate: gate.metricDate,
    gate,
    epm,
    usage,
    eto: {
      skipped: true,
      reason:
        'agentsam_performance_eto_events CHECK excludes agentsam_tool_chain; catalog already writes via tool_call_log; avoid duplicate/bloat',
    },
  };
}
