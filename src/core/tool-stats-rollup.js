/**
 * agentsam_tool_stats_compacted — calendar-day board from agentsam_tool_call_log.
 *
 * LOCKED: exact-value UPSERT (never +=). MCP execution is not a writer.
 * Preferred source: agentsam_tool_call_log via rollupToolCallLogDailyStats.
 */

import {
  costBasisForSourceClient,
  inferSourceClientForBackfill,
  normalizeSourceClient,
} from './tool-stats-source-client.js';

export { normalizeSourceClient };

const LOG = 'agentsam_tool_call_log';
const STATS = 'agentsam_tool_stats_compacted';

/**
 * @param {string | null | undefined} metricDate
 * @returns {string} YYYY-MM-DD UTC
 */
export function resolveToolStatsMetricDate(metricDate) {
  const raw = metricDate != null ? String(metricDate).trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

/**
 * @param {string | null | undefined} metricDate
 * @returns {{ metricDate: string, dayStartUnix: number, dayEndUnix: number }}
 */
export function toolStatsMetricUnixWindow(metricDate) {
  const day = resolveToolStatsMetricDate(metricDate);
  const dayStartUnix = Math.floor(Date.parse(`${day}T00:00:00.000Z`) / 1000);
  return { metricDate: day, dayStartUnix, dayEndUnix: dayStartUnix + 86_400 };
}

/**
 * @deprecated MCP execution must not feed agentsam_tool_stats_compacted.
 * Use rollupToolCallLogDailyStats instead.
 * @param {any} _env
 * @param {any} [_opts]
 */
export async function compactToolStatsCompacted(_env, _opts = {}) {
  return {
    ok: false,
    skipped: true,
    reason: 'retired_mcp_tool_execution_writer',
    preferred_source: 'agentsam_tool_call_log',
    preferred_fn: 'rollupToolCallLogDailyStats',
  };
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function pragmaTableInfo(db, tableName) {
  const safe = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(tableName || '')) ? String(tableName) : '';
  if (!safe || !db) return new Set();
  try {
    const { results } = await db.prepare(`PRAGMA table_info(${safe})`).all();
    return new Set((results || []).map((r) => String(r.name || '').toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * @param {number[]} sorted ascending
 * @param {number} p 0..1
 */
function percentileNearest(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return Math.round(Number(sorted[idx]) || 0);
}

/**
 * @param {string | null | undefined} status
 * @returns {'success'|'timeout'|'blocked'|'error'}
 */
function statusBucket(status) {
  const s = String(status || '')
    .trim()
    .toLowerCase();
  if (s === 'success' || s === 'ok' || s === 'completed') return 'success';
  if (s === 'timeout' || s === 'timed_out') return 'timeout';
  if (s === 'blocked' || s === 'denied') return 'blocked';
  return 'error';
}

/**
 * @param {string | null | undefined} toolCategory
 * @param {Map<string, number>} counts
 */
function noteCategory(counts, toolCategory) {
  const c = String(toolCategory || '').trim();
  if (!c) return;
  counts.set(c, (counts.get(c) || 0) + 1);
}

/**
 * @param {Map<string, number>} counts
 * @returns {string|null}
 */
function majorityCategory(counts) {
  let best = null;
  let n = -1;
  for (const [k, v] of counts) {
    if (v > n) {
      n = v;
      best = k;
    }
  }
  return best;
}

/**
 * Calendar-day rollup into agentsam_tool_stats_compacted.
 * DELETE day rows then exact-value INSERT … ON CONFLICT DO UPDATE (never +=).
 *
 * @param {any} env
 * @param {{ metricDate?: string }} [opts]
 */
export async function rollupToolCallLogDailyStats(env, opts = {}) {
  if (!env?.DB) return { ok: false, skipped: true, reason: 'no_db', upserted: 0 };

  const { metricDate, dayStartUnix, dayEndUnix } = toolStatsMetricUnixWindow(opts.metricDate);
  const logCols = await pragmaTableInfo(env.DB, LOG);
  const statsCols = await pragmaTableInfo(env.DB, STATS);

  const tsCol = logCols.has('created_at_unix')
    ? 'created_at_unix'
    : logCols.has('created_at')
      ? 'created_at'
      : null;
  const toolCol = logCols.has('tool_key')
    ? 'tool_key'
    : logCols.has('tool_name')
      ? 'tool_name'
      : null;

  if (!tsCol || !toolCol) {
    return {
      ok: false,
      skipped: true,
      reason: 'tool_call_log_schema',
      upserted: 0,
      metricDate,
      preferred_source: LOG,
    };
  }
  if (!statsCols.size || !statsCols.has('metric_date') || !statsCols.has('tool_key')) {
    return {
      ok: false,
      skipped: true,
      reason: 'tool_stats_compacted_schema',
      upserted: 0,
      metricDate,
    };
  }

  const hasSourceClient = logCols.has('source_client');
  const hasModel = logCols.has('model_key');
  const hasMode = logCols.has('mode');
  const hasCategory = logCols.has('tool_category');
  const hasStatus = logCols.has('status');
  const hasDuration = logCols.has('duration_ms');
  const hasCost = logCols.has('cost_usd');
  const hasInTok = logCols.has('input_tokens');
  const hasOutTok = logCols.has('output_tokens');
  const hasConv = logCols.has('conversation_id');
  const hasRun = logCols.has('agent_run_id');
  const hasTenant = logCols.has('tenant_id');
  const hasWs = logCols.has('workspace_id');

  const { results: rows = [] } = await env.DB.prepare(
    `SELECT
       ${hasTenant ? "COALESCE(NULLIF(trim(tenant_id), ''), 'system')" : "'system'"} AS tenant_id,
       ${hasWs ? "COALESCE(NULLIF(trim(workspace_id), ''), '')" : "''"} AS workspace_id,
       ${hasSourceClient ? 'source_client' : 'NULL'} AS source_client,
       ${hasModel ? "COALESCE(NULLIF(trim(model_key), ''), '')" : "''"} AS model_key,
       ${hasMode ? "COALESCE(NULLIF(trim(mode), ''), '')" : "''"} AS mode,
       COALESCE(NULLIF(trim(${toolCol}), ''), 'unknown') AS tool_key,
       ${hasCategory ? 'tool_category' : 'NULL'} AS tool_category,
       ${hasStatus ? 'status' : "'unknown'"} AS status,
       ${hasDuration ? 'duration_ms' : 'NULL'} AS duration_ms,
       ${hasCost ? 'COALESCE(cost_usd, 0)' : '0'} AS cost_usd,
       ${hasInTok ? 'COALESCE(input_tokens, 0)' : '0'} AS input_tokens,
       ${hasOutTok ? 'COALESCE(output_tokens, 0)' : '0'} AS output_tokens,
       ${hasConv ? 'conversation_id' : 'NULL'} AS conversation_id,
       ${hasRun ? 'agent_run_id' : 'NULL'} AS agent_run_id
     FROM ${LOG}
     WHERE ${tsCol} >= ? AND ${tsCol} < ?`,
  )
    .bind(dayStartUnix, dayEndUnix)
    .all()
    .catch((e) => {
      console.warn('[tool-stats-rollup] day query', e?.message ?? e);
      return { results: [] };
    });

  /** @type {Map<string, any>} */
  const groups = new Map();

  for (const r of rows) {
    const sourceClient =
      inferSourceClientForBackfill({
        source_client: r.source_client,
        mode: r.mode,
        model_key: r.model_key,
      }) || 'unknown';
    const modelKey = String(r.model_key || '').trim();
    const mode = String(r.mode || '').trim();
    const toolKey = String(r.tool_key || 'unknown').trim() || 'unknown';
    const tenantId = String(r.tenant_id || 'system').trim() || 'system';
    const workspaceId = String(r.workspace_id || '').trim();
    const groupKey = [tenantId, workspaceId, sourceClient, modelKey, mode, toolKey].join('\0');

    let g = groups.get(groupKey);
    if (!g) {
      g = {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        source_client: sourceClient,
        cost_basis: costBasisForSourceClient(sourceClient),
        model_key: modelKey,
        mode,
        tool_key: toolKey,
        categoryCounts: new Map(),
        call_count: 0,
        success_count: 0,
        error_count: 0,
        timeout_count: 0,
        blocked_count: 0,
        durations: [],
        success_duration_sum_ms: 0,
        attributed_model_cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        cost_attributed_call_count: 0,
        token_attributed_call_count: 0,
        conversations: new Set(),
        runs: new Set(),
      };
      groups.set(groupKey, g);
    }

    noteCategory(g.categoryCounts, r.tool_category);
    g.call_count += 1;

    const bucket = statusBucket(r.status);
    if (bucket === 'success') g.success_count += 1;
    else if (bucket === 'timeout') g.timeout_count += 1;
    else if (bucket === 'blocked') g.blocked_count += 1;
    else g.error_count += 1;

    const dur = Number(r.duration_ms);
    if (Number.isFinite(dur) && dur >= 0) {
      g.durations.push(dur);
      if (bucket === 'success') g.success_duration_sum_ms += Math.round(dur);
    }

    const inTok = Math.max(0, Number(r.input_tokens) || 0);
    const outTok = Math.max(0, Number(r.output_tokens) || 0);
    g.input_tokens += inTok;
    g.output_tokens += outTok;
    if (inTok + outTok > 0) g.token_attributed_call_count += 1;

    const rawCost = Math.max(0, Number(r.cost_usd) || 0);
    if (g.cost_basis === 'api_metered' && rawCost > 0) {
      g.attributed_model_cost_usd += rawCost;
      g.cost_attributed_call_count += 1;
    }

    const conv = String(r.conversation_id || '').trim();
    if (conv) g.conversations.add(conv);
    const runId = String(r.agent_run_id || '').trim();
    if (runId) g.runs.add(runId);
  }

  try {
    await env.DB.prepare(`DELETE FROM ${STATS} WHERE metric_date = ?`).bind(metricDate).run();
  } catch (e) {
    console.warn('[tool-stats-rollup] delete day', e?.message ?? e);
    return { ok: false, skipped: false, reason: 'delete_failed', upserted: 0, metricDate };
  }

  if (!groups.size) {
    return {
      ok: true,
      skipped: true,
      reason: 'no_rows',
      upserted: 0,
      metricDate,
      dayStartUnix,
      dayEndUnix,
      source_table: LOG,
    };
  }

  const upsertSql = `
    INSERT INTO ${STATS} (
      tenant_id, workspace_id, metric_date, source_client, cost_basis,
      model_key, mode, tool_key, tool_category,
      call_count, success_count, error_count, timeout_count, blocked_count,
      duration_sum_ms, duration_min_ms, duration_max_ms, p50_duration_ms, p95_duration_ms,
      success_duration_sum_ms, attributed_model_cost_usd,
      input_tokens, output_tokens,
      cost_attributed_call_count, token_attributed_call_count,
      conversation_count, run_count, computed_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, unixepoch()
    )
    ON CONFLICT (tenant_id, workspace_id, metric_date, source_client, model_key, mode, tool_key)
    DO UPDATE SET
      cost_basis = excluded.cost_basis,
      tool_category = excluded.tool_category,
      call_count = excluded.call_count,
      success_count = excluded.success_count,
      error_count = excluded.error_count,
      timeout_count = excluded.timeout_count,
      blocked_count = excluded.blocked_count,
      duration_sum_ms = excluded.duration_sum_ms,
      duration_min_ms = excluded.duration_min_ms,
      duration_max_ms = excluded.duration_max_ms,
      p50_duration_ms = excluded.p50_duration_ms,
      p95_duration_ms = excluded.p95_duration_ms,
      success_duration_sum_ms = excluded.success_duration_sum_ms,
      attributed_model_cost_usd = excluded.attributed_model_cost_usd,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cost_attributed_call_count = excluded.cost_attributed_call_count,
      token_attributed_call_count = excluded.token_attributed_call_count,
      conversation_count = excluded.conversation_count,
      run_count = excluded.run_count,
      computed_at = excluded.computed_at
  `;

  const statements = [];
  for (const g of groups.values()) {
    const sorted = g.durations.slice().sort((a, b) => a - b);
    const durationSum = sorted.reduce((a, b) => a + b, 0);
    const durationMin = sorted.length ? Math.round(sorted[0]) : null;
    const durationMax = sorted.length ? Math.round(sorted[sorted.length - 1]) : null;
    const p50 = percentileNearest(sorted, 0.5);
    const p95 = percentileNearest(sorted, 0.95);
    const attributed = Math.round(g.attributed_model_cost_usd * 1e6) / 1e6;

    statements.push(
      env.DB.prepare(upsertSql).bind(
        g.tenant_id,
        g.workspace_id,
        metricDate,
        g.source_client,
        g.cost_basis,
        g.model_key,
        g.mode,
        g.tool_key,
        majorityCategory(g.categoryCounts),
        g.call_count,
        g.success_count,
        g.error_count,
        g.timeout_count,
        g.blocked_count,
        Math.round(durationSum),
        durationMin,
        durationMax,
        p50,
        p95,
        g.success_duration_sum_ms,
        attributed,
        g.input_tokens,
        g.output_tokens,
        g.cost_attributed_call_count,
        g.token_attributed_call_count,
        g.conversations.size,
        g.runs.size,
      ),
    );
  }

  let upserted = 0;
  const BATCH = 40;
  for (let i = 0; i < statements.length; i += BATCH) {
    const chunk = statements.slice(i, i + BATCH);
    try {
      const res = await env.DB.batch(chunk);
      for (const r of res || []) {
        upserted += Number(r?.meta?.changes ?? r?.changes ?? 0) || 0;
      }
    } catch (e) {
      console.warn('[tool-stats-rollup] upsert batch', e?.message ?? e);
      return {
        ok: false,
        skipped: false,
        reason: 'upsert_failed',
        upserted,
        metricDate,
        groups: groups.size,
      };
    }
  }

  console.log('[compaction]', STATS, {
    metricDate,
    groups: groups.size,
    upserted,
    source_table: LOG,
  });

  return {
    ok: true,
    upserted,
    groups: groups.size,
    metricDate,
    dayStartUnix,
    dayEndUnix,
    source_table: LOG,
  };
}

/**
 * Recompute distinct calendar days still present in tool_call_log (newest first).
 *
 * @param {any} env
 * @param {{ limitDays?: number }} [opts]
 */
export async function backfillToolStatsFromToolCallLog(env, opts = {}) {
  if (!env?.DB) return { ok: false, skipped: true, reason: 'no_db', days: [] };

  const limitDays = Math.max(1, Math.min(90, Number(opts.limitDays) || 14));
  const logCols = await pragmaTableInfo(env.DB, LOG);
  const tsCol = logCols.has('created_at_unix')
    ? 'created_at_unix'
    : logCols.has('created_at')
      ? 'created_at'
      : null;
  if (!tsCol) {
    return { ok: false, skipped: true, reason: 'tool_call_log_schema', days: [] };
  }

  const { results: dateRows = [] } = await env.DB.prepare(
    `SELECT DISTINCT date(${tsCol}, 'unixepoch') AS metric_date
     FROM ${LOG}
     WHERE ${tsCol} IS NOT NULL
     ORDER BY metric_date DESC
     LIMIT ?`,
  )
    .bind(limitDays)
    .all()
    .catch((e) => {
      console.warn('[tool-stats-rollup] distinct dates', e?.message ?? e);
      return { results: [] };
    });

  const days = [];
  for (const row of dateRows) {
    const metricDate = String(row.metric_date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate)) continue;
    const result = await rollupToolCallLogDailyStats(env, { metricDate });
    days.push({ metricDate, ...result });
  }

  return {
    ok: true,
    limitDays,
    day_count: days.length,
    days,
    source_table: LOG,
  };
}
