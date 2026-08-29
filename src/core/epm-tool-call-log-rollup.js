/**
 * Daily EPM rollup from agentsam_tool_call_log (rich spine).
 * Replaces the lean agentsam_tool_chain → EPM feed that stamped identical junk JSON.
 *
 * Intentionally avoids importing retention.js (heavy cron/thompson graph).
 */

const EPM = 'agentsam_execution_performance_metrics';
const LOG = 'agentsam_tool_call_log';

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function tableExists(db, tableName) {
  const safe = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(tableName || '')) ? String(tableName) : '';
  if (!safe || !db) return false;
  const row = await db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`)
    .bind(safe)
    .first()
    .catch(() => null);
  return !!row?.ok;
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function pragmaTableInfo(db, tableName) {
  const safe = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(tableName || '')) ? String(tableName) : '';
  if (!safe || !db) return new Set();
  try {
    const { results } = await db.prepare(`PRAGMA table_info(${safe})`).all();
    if (results?.length) return new Set(results.map((r) => String(r.name || '').toLowerCase()));
  } catch {
    /* fall through */
  }
  try {
    const row = await db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`)
      .bind(safe)
      .first();
    const sql = String(row?.sql || '');
    const cols = new Set();
    for (const m of sql.matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+/gm)) {
      const n = m[1].toLowerCase();
      if (n !== 'create' && n !== 'table' && n !== 'primary' && n !== 'unique' && n !== 'foreign' && n !== 'constraint') {
        cols.add(n);
      }
    }
    return cols;
  } catch {
    return new Set();
  }
}

/**
 * @param {string | null | undefined} metricDate
 */
export function resolveEpmMetricDate(metricDate) {
  const raw = metricDate != null ? String(metricDate).trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

/**
 * @param {string} metricDate
 */
export function epmMetricUnixWindow(metricDate) {
  const day = resolveEpmMetricDate(metricDate);
  const dayStartUnix = Math.floor(Date.parse(`${day}T00:00:00.000Z`) / 1000);
  return { metricDate: day, dayStartUnix, dayEndUnix: dayStartUnix + 86_400 };
}

/**
 * @param {number[]} sorted
 * @param {number} p 0..1
 */
function percentileNearest(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return Math.round(Number(sorted[idx]) || 0);
}

/**
 * @param {string | null | undefined} msg
 */
function normalizeErrorKey(msg) {
  const s = String(msg || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return s || 'error';
}

/**
 * @param {string | null | undefined} modelKey
 */
function deriveProvider(modelKey) {
  const mk = String(modelKey || '').trim();
  if (!mk) return '';
  if (mk.includes('/')) return mk.split('/')[0].slice(0, 64);
  if (mk.startsWith('claude')) return 'anthropic';
  if (mk.startsWith('gpt') || mk.startsWith('o1') || mk.startsWith('o3') || mk.startsWith('o4')) {
    return 'openai';
  }
  if (mk.startsWith('gemini')) return 'google';
  if (mk.startsWith('deepseek')) return 'deepseek';
  return mk.split('-')[0].slice(0, 64);
}

/**
 * @param {string | null | undefined} status
 */
function statusBucket(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'success' || s === 'completed' || s === 'ok') return 'success';
  if (s === 'blocked' || s === 'denied') return 'blocked';
  if (s === 'timeout' || s === 'timed_out') return 'timeout';
  if (s === 'cancelled' || s === 'canceled' || s === 'skipped') return 'skipped';
  if (s === 'error' || s === 'failed' || s === 'failure') return 'error';
  return s || 'unknown';
}

/**
 * @param {Record<string, number>} counts
 */
function modeKey(counts) {
  let best = null;
  let n = -1;
  for (const [k, v] of Object.entries(counts || {})) {
    if (v > n) {
      n = v;
      best = k;
    }
  }
  return best;
}

/**
 * @param {any} env
 * @param {{ metricDate?: string }} [opts]
 */
export async function rollupToolCallLogToExecutionPerformanceMetrics(env, opts = {}) {
  if (!env?.DB) return { ok: false, skipped: true, reason: 'no_db', changes: 0 };
  if (!(await tableExists(env.DB, EPM))) {
    return { ok: false, skipped: true, reason: 'epm_missing', changes: 0 };
  }
  if (!(await tableExists(env.DB, LOG))) {
    return { ok: false, skipped: true, reason: 'tool_call_log_missing', changes: 0 };
  }

  const { metricDate, dayStartUnix, dayEndUnix } = epmMetricUnixWindow(opts.metricDate);
  const logCols = await pragmaTableInfo(env.DB, LOG);
  const tsCol = logCols.has('created_at_unix')
    ? 'created_at_unix'
    : logCols.has('created_at')
      ? 'created_at'
      : null;
  if (!tsCol || !logCols.has('tool_key')) {
    return { ok: false, skipped: true, reason: 'tool_call_log_schema', changes: 0 };
  }

  const hasAgentRun = logCols.has('agent_run_id');
  const hasHandler = logCols.has('handler_key');
  const hasArm = logCols.has('routing_arm_id');
  const hasMode = logCols.has('mode');
  const hasUser = logCols.has('user_id');

  const { results: rows } = await env.DB.prepare(
    `SELECT
       COALESCE(NULLIF(trim(tenant_id), ''), 'platform') AS tenant_id,
       COALESCE(NULLIF(trim(workspace_id), ''), '') AS workspace_id,
       COALESCE(NULLIF(trim(tool_key), ''), 'unknown') AS tool_key,
       COALESCE(NULLIF(trim(tool_category), ''), '') AS tool_category,
       COALESCE(NULLIF(trim(model_key), ''), '') AS model_key,
       ${hasArm ? "COALESCE(NULLIF(trim(routing_arm_id), ''), '')" : "''"} AS routing_arm_id,
       ${hasHandler ? "COALESCE(NULLIF(trim(handler_key), ''), '')" : "''"} AS handler_key,
       ${hasMode ? "COALESCE(NULLIF(trim(mode), ''), '')" : "''"} AS mode,
       ${hasUser ? "COALESCE(NULLIF(trim(user_id), ''), '')" : "''"} AS user_id,
       ${hasAgentRun ? "COALESCE(NULLIF(trim(agent_run_id), ''), '')" : "''"} AS agent_run_id,
       status,
       duration_ms,
       error_message,
       COALESCE(cost_usd, 0) AS cost_usd,
       COALESCE(input_tokens, 0) AS input_tokens,
       COALESCE(output_tokens, 0) AS output_tokens,
       ${tsCol} AS ts
     FROM ${LOG}
     WHERE ${tsCol} >= ? AND ${tsCol} < ?
       AND COALESCE(NULLIF(trim(workspace_id), ''), '') != ''`,
  )
    .bind(dayStartUnix, dayEndUnix)
    .all()
    .catch((e) => {
      throw new Error(`epm_tool_call_log_rollup: query_failed: ${e?.message ?? e}`);
    });

  if (!rows?.length) {
    return {
      ok: true,
      skipped: true,
      reason: 'no_eligible_rows',
      changes: 0,
      metricDate,
      source_table: LOG,
    };
  }

  /** @type {Map<string, any>} */
  const groups = new Map();
  for (const r of rows) {
    const provider = deriveProvider(r.model_key);
    const toolCategory =
      r.tool_category ||
      (String(r.tool_key).startsWith('agentsam_')
        ? 'agentsam'
        : String(r.tool_key).startsWith('mcp')
          ? 'mcp'
          : 'tool');
    const key = [r.tenant_id, r.workspace_id, r.tool_key, toolCategory, r.model_key, provider].join(
      '\0',
    );

    let g = groups.get(key);
    if (!g) {
      g = {
        tenant_id: r.tenant_id,
        workspace_id: r.workspace_id,
        tool_name: r.tool_key,
        tool_category: toolCategory,
        model_key: r.model_key,
        provider,
        durations: [],
        statusCounts: Object.create(null),
        errorCounts: Object.create(null),
        armCounts: Object.create(null),
        modeCounts: Object.create(null),
        handlerCounts: Object.create(null),
        users: new Set(),
        runs: new Set(),
        success: 0,
        failure: 0,
        timeout: 0,
        blocked: 0,
        skipped: 0,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        first_seen_at: Number(r.ts) || dayStartUnix,
        last_seen_at: Number(r.ts) || dayStartUnix,
      };
      groups.set(key, g);
    }

    const bucket = statusBucket(r.status);
    g.statusCounts[bucket] = (g.statusCounts[bucket] || 0) + 1;
    if (bucket === 'success') g.success += 1;
    else if (bucket === 'timeout') g.timeout += 1;
    else if (bucket === 'blocked') g.blocked += 1;
    else if (bucket === 'skipped') g.skipped += 1;
    else g.failure += 1;

    if (bucket !== 'success' && r.error_message) {
      const ek = normalizeErrorKey(r.error_message);
      g.errorCounts[ek] = (g.errorCounts[ek] || 0) + 1;
    }

    const dur = Number(r.duration_ms);
    if (Number.isFinite(dur) && dur >= 0) g.durations.push(dur);

    g.input_tokens += Math.max(0, Number(r.input_tokens) || 0);
    g.output_tokens += Math.max(0, Number(r.output_tokens) || 0);
    g.cost_usd += Math.max(0, Number(r.cost_usd) || 0);

    const ts = Number(r.ts) || 0;
    if (ts && ts < g.first_seen_at) g.first_seen_at = ts;
    if (ts && ts > g.last_seen_at) g.last_seen_at = ts;

    if (r.routing_arm_id) g.armCounts[r.routing_arm_id] = (g.armCounts[r.routing_arm_id] || 0) + 1;
    if (r.mode) g.modeCounts[r.mode] = (g.modeCounts[r.mode] || 0) + 1;
    if (r.handler_key) g.handlerCounts[r.handler_key] = (g.handlerCounts[r.handler_key] || 0) + 1;
    if (r.user_id) g.users.add(r.user_id);
    if (r.agent_run_id) g.runs.add(r.agent_run_id);
  }

  const epmCols = await pragmaTableInfo(env.DB, EPM);
  const statements = [];

  for (const g of groups.values()) {
    const n = Object.values(g.statusCounts).reduce((a, b) => a + b, 0) || 1;
    const sorted = g.durations.slice().sort((a, b) => a - b);
    const avg =
      sorted.length > 0 ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0;
    const min = sorted.length ? Math.round(sorted[0]) : 0;
    const max = sorted.length ? Math.round(sorted[sorted.length - 1]) : 0;
    const median = percentileNearest(sorted, 0.5);
    const p95 = percentileNearest(sorted, 0.95);
    const p99 = percentileNearest(sorted, 0.99);
    const modeArm = modeKey(g.armCounts);

    const topHandlers = Object.fromEntries(
      Object.entries(g.handlerCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8),
    );
    const metadata = {
      distinct_agent_runs: g.runs.size,
      distinct_users: g.users.size,
      mode_counts: g.modeCounts,
      routing_arm_counts: g.armCounts,
      handler_key_counts: topHandlers,
      feed: 'tool_call_log_epm',
    };

    /** @type {Record<string, unknown>} */
    const binds = {
      id: `epm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      tenant_id: g.tenant_id,
      workspace_id: g.workspace_id,
      metric_date: metricDate,
      metric_grain: 'daily',
      source_table: LOG,
      // Empty strings (not NULL) so SQLite UNIQUE/ON CONFLICT matches reliably.
      command_id: '',
      command_slug: '',
      workflow_id: '',
      task_type: '',
      intent_category: '',
      trigger_key: '',
      tool_name: g.tool_name,
      tool_category: g.tool_category,
      model_key: g.model_key,
      provider: g.provider,
      routing_arm_id: modeArm,
      execution_count: n,
      success_count: g.success,
      failure_count: g.failure,
      timeout_count: g.timeout,
      blocked_count: g.blocked,
      skipped_count: g.skipped,
      avg_duration_ms: avg,
      min_duration_ms: min,
      max_duration_ms: max,
      median_duration_ms: median,
      p95_duration_ms: p95,
      p99_duration_ms: p99,
      success_rate_percent: Math.round((1000 * g.success) / n) / 10,
      failure_rate_percent: Math.round((1000 * g.failure) / n) / 10,
      timeout_rate_percent: Math.round((1000 * g.timeout) / n) / 10,
      total_tokens_consumed: g.input_tokens + g.output_tokens,
      input_tokens: g.input_tokens,
      output_tokens: g.output_tokens,
      total_cost_usd: Math.round(g.cost_usd * 1e6) / 1e6,
      total_cost_cents: Math.round(g.cost_usd * 10000) / 100,
      avg_cost_usd: Math.round((g.cost_usd / n) * 1e6) / 1e6,
      error_types_json: JSON.stringify(g.errorCounts),
      status_counts_json: JSON.stringify(g.statusCounts),
      metadata_json: JSON.stringify(metadata),
      first_seen_at: g.first_seen_at,
      last_seen_at: g.last_seen_at,
      last_computed_at: Math.floor(Date.now() / 1000),
    };

    const colOrder = Object.keys(binds).filter((c) => epmCols.has(c.toLowerCase()));
    if (colOrder.length < 8) {
      return { ok: false, skipped: true, reason: 'epm_columns_missing', changes: 0 };
    }

    const updateCols = colOrder.filter(
      (c) =>
        ![
          'id',
          'tenant_id',
          'workspace_id',
          'metric_date',
          'metric_grain',
          'source_table',
          'tool_name',
          'tool_category',
          'model_key',
          'provider',
        ].includes(c),
    );

    const sql = `
      INSERT INTO ${EPM} (${colOrder.join(', ')})
      VALUES (${colOrder.map(() => '?').join(', ')})
      ON CONFLICT(
        tenant_id, workspace_id, metric_date, metric_grain, source_table,
        command_id, command_slug, tool_name, tool_category, workflow_id,
        task_type, intent_category, model_key, provider, trigger_key
      ) DO UPDATE SET
        ${updateCols.map((c) => `${c} = excluded.${c}`).join(',\n        ')}
    `;

    statements.push(env.DB.prepare(sql).bind(...colOrder.map((c) => binds[c])));
  }

  let changes = 0;
  for (let i = 0; i < statements.length; i += 40) {
    const chunk = statements.slice(i, i + 40);
    const res = await env.DB.batch(chunk);
    for (const r of res || []) {
      changes += Number(r?.meta?.changes ?? 0) || 0;
    }
  }

  return {
    ok: true,
    changes,
    groups: groups.size,
    metricDate,
    source_table: LOG,
  };
}
