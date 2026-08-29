import { parseRange, analyticsResponse } from './sources/normalize.js';
import { pragmaTableInfo, tableExists } from '../../../backend/services/retention.js';
import { supabaseQuery } from './sources/supabase.js';
import { isHyperdriveUsable } from '../../../backend/services/database/hyperdrive.js';

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function d1All(db, label, sql, binds, warnings) {
  if (!db) return [];
  try {
    const { results } = await db.prepare(sql).bind(...binds).all();
    return results || [];
  } catch (e) {
    warnings.push({ code: 'D1_QUERY_ERROR', message: `${label}: ${String(e?.message || e)}`, severity: 'warn' });
    return [];
  }
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function d1First(db, label, sql, binds, warnings) {
  if (!db) return null;
  try {
    return await db.prepare(sql).bind(...binds).first();
  } catch (e) {
    warnings.push({ code: 'D1_QUERY_ERROR', message: `${label}: ${String(e?.message || e)}`, severity: 'warn' });
    return null;
  }
}

function metricDateClause(range) {
  if (range === '24h') return `metric_date >= date('now', '-2 days')`;
  if (range === '30d') return `metric_date >= date('now', '-30 days')`;
  if (range === 'all') return `metric_date >= date('now', '-3650 days')`;
  return `metric_date >= date('now', '-7 days')`;
}

/** Unix-seconds lower bound for agentsam_reward_events.created_at_unix; null = no bound. */
function rangeSinceUnix(range) {
  const now = Math.floor(Date.now() / 1000);
  if (range === '24h') return now - 86400;
  if (range === '30d') return now - 30 * 86400;
  if (range === 'all') return null;
  return now - 7 * 86400;
}

/** agentsam_error_log.created_at is unix epoch seconds */
function errorLogCreatedClause(range) {
  if (range === '24h') return `created_at >= unixepoch('now', '-24 hours')`;
  if (range === '30d') return `created_at >= unixepoch('now', '-30 days')`;
  if (range === 'all') return `created_at >= unixepoch('now', '-3650 days')`;
  return `created_at >= unixepoch('now', '-7 days')`;
}

function truncateStr(v, max = 1800) {
  if (v == null) return null;
  const s = typeof v === 'string' ? v : String(v);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * Heuristic next steps for operators (not persisted).
 * @param {Record<string, unknown>} row
 */
function suggestedActionForErrorLogRow(row) {
  const msg = `${row.error_message || ''} ${row.error_type || ''} ${row.source || ''} ${row.error_code || ''}`.toLowerCase();
  const et = String(row.error_type || '').toLowerCase();
  const src = String(row.source || '').toLowerCase();
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'Reduce concurrency or backoff; confirm provider quota and retry-after headers.';
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden')) {
    return 'Rotate or verify API keys, session cookies, and tenant-scoped secrets for the failing route.';
  }
  if (msg.includes('timeout') || et.includes('timeout')) {
    return 'Shrink payload or split work; check Worker wall time, upstream latency, and MCP tool timeouts.';
  }
  if (src.includes('mcp') || msg.includes('tool') || msg.includes('mcp_')) {
    return 'Open Analytics → MCP; validate tool definition, inputs, and approval gates; retry with minimal repro input.';
  }
  if (msg.includes('d1') || msg.includes('sqlite') || msg.includes('sql')) {
    return 'Inspect D1 binding and query; use logs + Database browser; confirm migrations applied for referenced tables.';
  }
  if (msg.includes('webhook') || src.includes('webhook')) {
    return 'Check Analytics → Workers webhook panel and agentsam_webhook_events; verify signature secret and endpoint URL.';
  }
  if (msg.includes('deploy') || msg.includes('wrangler')) {
    return 'Compare dashboard_versions vs deployments; run npm run deploy:full if R2 dashboard bundle drift is suspected.';
  }
  if (msg.includes('r2') || msg.includes('bucket')) {
    return 'Verify R2 binding names, bucket policy, and object keys; confirm Worker has read/write on the intended bucket.';
  }
  if (et.includes('fatal') || et.includes('critical')) {
    return 'Treat as incident: capture id + session_id; check correlated workflow_run in Analytics → Agent; page on-call if production.';
  }
  return 'Triage with source_id and session_id in logs; after fix, mark resolved in D1 (UPDATE agentsam_error_log SET resolved = 1 WHERE id = ?).';
}

function pgInterval(range) {
  if (range === '24h') return "interval '24 hours'";
  if (range === '30d') return "interval '30 days'";
  if (range === 'all') return "interval '3650 days'";
  return "interval '7 days'";
}

export async function handleAnalyticsModelsLeaderboard(request, url, env, { tenantId, workspaceId }) {
  void request;
  const range = parseRange(url);
  const warnings = [];
  const db = env?.DB || null;
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;
  const wid = workspaceId && String(workspaceId).trim() ? String(workspaceId).trim() : null;

  if (!db || !(await tableExists(db, 'agentsam_execution_performance_metrics'))) {
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: { state: 'EMPTY' },
      rows: [],
      modelLeaderboard: [],
      warnings,
    });
  }

  const where = [metricDateClause(range)];
  const binds = [];
  if (tid) {
    where.push('tenant_id = ?');
    binds.push(tid);
  }
  if (wid) {
    where.push('(workspace_id = ? OR workspace_id IS NULL)');
    binds.push(wid);
  }
  const whereSql = where.join(' AND ');

  const rows = await d1All(
    db,
    'model_lb',
    `SELECT
       COALESCE(model_key, '(unknown)') AS model_key,
       COALESCE(provider, '') AS provider,
       SUM(COALESCE(execution_count, 0)) AS executions,
       SUM(COALESCE(success_count, 0)) AS successes,
       SUM(COALESCE(failure_count, 0)) AS failures,
       AVG(COALESCE(avg_duration_ms, 0)) AS avg_latency_ms,
       SUM(COALESCE(total_cost_usd, 0)) AS total_cost_usd,
       SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS tokens,
       GROUP_CONCAT(DISTINCT COALESCE(task_type, '')) AS task_types
     FROM agentsam_execution_performance_metrics
     WHERE ${whereSql}
     GROUP BY 1, 2
     HAVING executions > 0
     ORDER BY executions DESC
     LIMIT 80`,
    binds,
    warnings,
  );

  const modelLeaderboard = rows.map((r) => {
    const ex = Number(r.executions) || 0;
    const ok = Number(r.successes) || 0;
    const fail = Number(r.failures) || 0;
    const succRate = ex > 0 ? Math.round((ok / ex) * 1000) / 10 : null;
    const avgCost = ex > 0 ? (Number(r.total_cost_usd) || 0) / ex : 0;
    return {
      ...r,
      success_rate_pct: succRate,
      avg_cost_usd: Math.round(avgCost * 1e6) / 1e6,
      avg_latency_ms: Math.round(Number(r.avg_latency_ms) || 0),
    };
  });

  const scatter = modelLeaderboard.map((r) => ({
    model_key: r.model_key,
    provider: r.provider,
    avg_latency_ms: r.avg_latency_ms,
    avg_cost_usd: r.avg_cost_usd,
    success_rate_pct: r.success_rate_pct,
    executions: r.executions,
  }));

  return analyticsResponse({
    ok: true,
    backend: 'd1',
    range,
    summary: { state: rows.length ? 'LIVE' : 'EMPTY', row_count: rows.length },
    rows,
    modelLeaderboard,
    costLatencyScatter: scatter,
    warnings,
  });
}

export async function handleAnalyticsModelsRoutingArms(request, url, env, { tenantId, workspaceId }) {
  void request;
  const range = parseRange(url);
  const warnings = [];
  const db = env?.DB || null;
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;
  const wid = workspaceId && String(workspaceId).trim() ? String(workspaceId).trim() : null;

  if (!db || !(await tableExists(db, 'agentsam_routing_arms'))) {
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: { state: 'EMPTY' },
      rows: [],
      warnings,
    });
  }

  const cols = await pragmaTableInfo(db, 'agentsam_routing_arms');
  const orderCol = cols.has('updated_at') ? 'updated_at' : cols.has('created_at') ? 'created_at' : 'rowid';
  const where = ['1=1'];
  const binds = [];
  if (tid && cols.has('tenant_id')) {
    where.push('tenant_id = ?');
    binds.push(tid);
  }
  if (cols.has('workspace_id')) {
    where.push("COALESCE(TRIM(workspace_id), '') = ''");
  }

  const rows = await d1All(
    db,
    'routing_arms',
    `SELECT * FROM agentsam_routing_arms WHERE ${where.join(' AND ')} ORDER BY ${orderCol} DESC LIMIT 120`,
    binds,
    warnings,
  );

  /** model_key × failure_category counts from reward ledger (auto_error only). */
  let failureBreakdown = [];
  if (await tableExists(db, 'agentsam_reward_events')) {
    const reCols = await pragmaTableInfo(db, 'agentsam_reward_events');
    if (reCols.has('failure_category')) {
      const sinceUnix = rangeSinceUnix(range);
      const fbWhere = [`signal_type = 'auto_error'`, `failure_category IS NOT NULL`];
      const fbBinds = [];
      if (sinceUnix != null) {
        fbWhere.push('created_at_unix >= ?');
        fbBinds.push(sinceUnix);
      }
      if (tid && reCols.has('tenant_id')) {
        fbWhere.push('tenant_id = ?');
        fbBinds.push(tid);
      }
      if (wid && reCols.has('workspace_id')) {
        fbWhere.push('(workspace_id = ? OR workspace_id IS NULL OR COALESCE(TRIM(workspace_id), \'\') = \'\')');
        fbBinds.push(wid);
      }
      failureBreakdown = await d1All(
        db,
        'reward_failure_breakdown',
        `SELECT COALESCE(model_key, '(unknown)') AS model_key,
                failure_category,
                COUNT(*) AS event_count,
                SUM(CASE WHEN COALESCE(beta_delta, 0) = 0 AND COALESCE(alpha_delta, 0) = 0 THEN 1 ELSE 0 END) AS bandit_skipped_count
         FROM agentsam_reward_events
         WHERE ${fbWhere.join(' AND ')}
         GROUP BY COALESCE(model_key, '(unknown)'), failure_category
         ORDER BY event_count DESC
         LIMIT 200`,
        fbBinds,
        warnings,
      );
    }
  }

  return analyticsResponse({
    ok: true,
    backend: 'd1',
    range,
    summary: {
      state: rows.length ? 'LIVE' : 'EMPTY',
      row_count: rows.length,
      failure_breakdown_count: failureBreakdown.length,
    },
    rows,
    failure_breakdown: failureBreakdown,
    warnings,
  });
}

export async function handleAnalyticsModelsRoutingDecisions(request, url, env, { tenantId }) {
  void request;
  const range = parseRange(url);
  const warnings = [];
  if (!isHyperdriveUsable(env)) {
    warnings.push({ code: 'HYPERDRIVE_MISSING', message: 'Supabase routing decisions require Hyperdrive.', severity: 'warn' });
    return analyticsResponse({ ok: true, backend: 'supabase', range, summary: { state: 'EMPTY' }, rows: [], warnings });
  }
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;
  const r = await supabaseQuery(
    env,
    `SELECT *
     FROM agentsam.agentsam_routing_decisions
     WHERE ($1::text IS NULL OR tenant_id = $1)
       AND created_at >= now() - ${pgInterval(range)}
     ORDER BY created_at DESC
     LIMIT 150`,
    [tid],
  );
  if (!r.ok) {
    warnings.push({ code: 'PG_QUERY_FAILED', message: r.warning || 'query_failed', severity: 'warn' });
    return analyticsResponse({ ok: true, backend: 'supabase', range, summary: { state: 'BLOCKED' }, rows: [], warnings });
  }
  return analyticsResponse({
    ok: true,
    backend: 'supabase',
    range,
    summary: { state: r.rows.length ? 'LIVE' : 'EMPTY', row_count: r.rows.length },
    rows: r.rows,
    warnings,
  });
}

export async function handleAnalyticsModelsEvals(request, url, env, { tenantId }) {
  void request;
  const range = parseRange(url);
  const warnings = [];
  if (!isHyperdriveUsable(env)) {
    warnings.push({ code: 'HYPERDRIVE_MISSING', message: 'Supabase eval runs require Hyperdrive.', severity: 'warn' });
    return analyticsResponse({ ok: true, backend: 'supabase', range, summary: { state: 'EMPTY' }, rows: [], warnings });
  }
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;
  const r = await supabaseQuery(
    env,
    `SELECT *
     FROM agentsam.agentsam_eval_runs
     WHERE ($1::text IS NULL OR tenant_id = $1)
       AND created_at >= now() - ${pgInterval(range)}
     ORDER BY created_at DESC
     LIMIT 200`,
    [tid],
  );
  if (!r.ok) {
    warnings.push({ code: 'PG_QUERY_FAILED', message: r.warning || 'query_failed', severity: 'warn' });
    return analyticsResponse({ ok: true, backend: 'supabase', range, summary: { state: 'BLOCKED' }, rows: [], warnings });
  }
  return analyticsResponse({
    ok: true,
    backend: 'supabase',
    range,
    summary: { state: r.rows.length ? 'LIVE' : 'EMPTY', row_count: r.rows.length },
    rows: r.rows,
    warnings,
  });
}

export async function handleAnalyticsModelsDrift(request, url, env) {
  void request;
  const range = parseRange(url);
  const warnings = [];
  const db = env?.DB || null;
  
  const where =
    range === '24h'
      ? `detected_at >= unixepoch('now','-24 hours')`
      : range === '30d'
        ? `detected_at >= unixepoch('now','-30 days')`
        : range === 'all'
          ? `detected_at >= unixepoch('now','-3650 days')`
          : `detected_at >= unixepoch('now','-7 days')`;
  const rows = await d1All(
    db,
    'drift',
    [],
    warnings,
  );
  return analyticsResponse({
    ok: true,
    backend: 'd1',
    range,
    summary: { state: rows.length ? 'LIVE' : 'EMPTY', row_count: rows.length },
    rows,
    warnings,
  });
}

export async function handleAnalyticsModelsPromptCache(request, url, env, { tenantId }) {
  void request;
  const range = parseRange(url);
  const warnings = [];
  const db = env?.DB || null;
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;
  if (!db || !(await tableExists(db, 'agentsam_prompt_cache_keys'))) {
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: { state: 'EMPTY' },
      rows: [],
      warnings,
    });
  }
  const cols = await pragmaTableInfo(db, 'agentsam_prompt_cache_keys');
  const legacy = cols.has('read_count');
  const readCol = legacy ? 'read_count' : 'cache_read_count';
  const savingsCol = legacy ? 'total_read_savings_usd' : 'total_cache_savings_usd';
  const writeCostCol = legacy ? 'write_cost_usd' : 'cache_creation_cost_usd';
  const where = ['1=1'];
  const binds = [];
  if (tid && cols.has('tenant_id')) {
    where.push('tenant_id = ?');
    binds.push(tid);
  }
  const whereSql = where.join(' AND ');
  const agg = await d1First(
    db,
    'pck_agg',
    `SELECT
       COUNT(*) AS key_rows,
       SUM(COALESCE(${readCol}, 0)) AS read_hits,
       SUM(COALESCE(${savingsCol}, 0)) AS savings_usd,
       SUM(COALESCE(${writeCostCol}, 0)) AS write_cost_usd
     FROM agentsam_prompt_cache_keys
     WHERE ${whereSql}`,
    binds,
    warnings,
  );
  const top = await d1All(
    db,
    'pck_top',
    `SELECT model_key, provider, SUM(COALESCE(${readCol},0)) AS reads, SUM(COALESCE(${savingsCol},0)) AS savings
     FROM agentsam_prompt_cache_keys
     WHERE ${whereSql}
     GROUP BY 1,2
     ORDER BY savings DESC
     LIMIT 30`,
    binds,
    warnings,
  );
  return analyticsResponse({
    ok: true,
    backend: 'd1',
    range,
    summary: { state: Number(agg?.key_rows) > 0 ? 'LIVE' : 'EMPTY', aggregate: agg || {} },
    rows: top,
    warnings,
  });
}

export async function handleAnalyticsWorkersR2(request, url, env) {
  void request;
  const range = parseRange(url);
  const warnings = [];
  const db = env?.DB || null;
  if (!db) {
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: { state: 'EMPTY' },
      rows: [],
      warnings,
    });
  }
  let inv = [];
  if (await tableExists(db, 'r2_object_inventory')) {
    inv = await d1All(
      db,
      'r2inv',
      `SELECT bucket, COUNT(*) AS objects, SUM(COALESCE(size_bytes,0)) AS bytes
       FROM r2_object_inventory
       GROUP BY bucket
       ORDER BY objects DESC
       LIMIT 40`,
      [],
      warnings,
    );
  }
  let summary = null;
  if (await tableExists(db, 'r2_bucket_summary')) {
    summary = await d1All(db, 'r2sum', `SELECT * FROM r2_bucket_summary ORDER BY rowid DESC LIMIT 20`, [], warnings);
  }
  return analyticsResponse({
    ok: true,
    backend: 'd1',
    range,
    summary: { state: inv.length || (summary && summary.length) ? 'LIVE' : 'EMPTY', by_bucket: inv },
    rows: summary || [],
    warnings,
  });
}

export async function handleAnalyticsWorkersDashboardVersions(request, url, env) {
  void request;
  const range = parseRange(url);
  const warnings = [];
  const db = env?.DB || null;
  if (!db || !(await tableExists(db, 'dashboard_versions'))) {
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: { state: 'EMPTY' },
      rows: [],
      warnings,
    });
  }
  const rows = await d1All(
    db,
    'dashv',
    `SELECT * FROM dashboard_versions ORDER BY rowid DESC LIMIT 40`,
    [],
    warnings,
  );
  return analyticsResponse({
    ok: true,
    backend: 'd1',
    range,
    summary: { state: rows.length ? 'LIVE' : 'EMPTY' },
    rows,
    warnings,
  });
}

export async function handleAnalyticsWorkersSummary(request, url, env, { tenantId }) {
  void request;
  const range = parseRange(url);
  const warnings = [];
  const db = env?.DB || null;
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;
  const out = {
    deployments: [],
    deployment_tracking: [],
    deployment_health: [],
    cron_runs: [],
    webhook_events: [],
    perf_headline: null,
  };

  if (!db) {
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: { state: 'EMPTY', bundle: out },
      rows: [],
      warnings,
    });
  }

  if (await tableExists(db, 'deployments')) {
    out.deployments = await d1All(
      db,
      'dep',
      `SELECT id, timestamp, version, git_hash, status, environment, duration_seconds, created_at, notes
       FROM deployments
       ORDER BY rowid DESC
       LIMIT 25`,
      [],
      warnings,
    );
  }

  if (await tableExists(db, 'deployment_tracking')) {
    out.deployment_tracking = await d1All(
      db,
      'dept',
      `SELECT * FROM deployment_tracking
       ORDER BY datetime(COALESCE(updated_at, completed_at, started_at, queued_at)) DESC
       LIMIT 20`,
      [],
      warnings,
    );
  }

  if (await tableExists(db, 'agentsam_deployment_health')) {
    const dhWhere = ['1=1'];
    const dhBinds = [];
    if (tid) {
      const dhc = await pragmaTableInfo(db, 'agentsam_deployment_health');
      if (dhc.has('tenant_id')) {
        dhWhere.push('tenant_id = ?');
        dhBinds.push(tid);
      }
    }
    out.deployment_health = await d1All(
      db,
      'dh',
      `SELECT * FROM agentsam_deployment_health WHERE ${dhWhere.join(' AND ')} ORDER BY rowid DESC LIMIT 30`,
      dhBinds,
      warnings,
    );
  }

  if (await tableExists(db, 'agentsam_cron_runs')) {
    const crWhere =
      range === '24h'
        ? `started_at >= unixepoch('now','-24 hours')`
        : range === '30d'
          ? `started_at >= unixepoch('now','-30 days')`
          : range === 'all'
            ? `started_at >= unixepoch('now','-3650 days')`
            : `started_at >= unixepoch('now','-7 days')`;
    out.cron_runs = await d1All(
      db,
      'cron',
      `SELECT id, job_name, status, started_at, completed_at, duration_ms, error_message
       FROM agentsam_cron_runs
       WHERE ${crWhere}
       ORDER BY started_at DESC
       LIMIT 40`,
      [],
      warnings,
    );
  }

  if (await tableExists(db, 'agentsam_webhook_events')) {
    const whCols = await pragmaTableInfo(db, 'agentsam_webhook_events');
    const whWhere = ['1=1'];
    const whBinds = [];
    if (tid && whCols.has('tenant_id')) {
      whWhere.push('tenant_id = ?');
      whBinds.push(tid);
    }
    if (whCols.has('received_at_unix')) {
      if (range === '24h') whWhere.push(`received_at_unix >= unixepoch('now', '-24 hours')`);
      else if (range === '30d') whWhere.push(`received_at_unix >= unixepoch('now', '-30 days')`);
      else if (range === 'all') whWhere.push(`received_at_unix >= unixepoch('now', '-3650 days')`);
      else whWhere.push(`received_at_unix >= unixepoch('now', '-7 days')`);
    }
    const errCol = whCols.has('processing_error') ? 'processing_error' : 'NULL';
    out.webhook_events = await d1All(
      db,
      'wh',
      `SELECT id, provider, event_type, status, received_at_unix AS received_at, ${errCol} AS error_message,
              json_extract(metadata_json, '$.commit_sha') AS commit_sha,
              json_extract(metadata_json, '$.branch') AS branch
       FROM agentsam_webhook_events
       WHERE ${whWhere.join(' AND ')}
       ORDER BY received_at_unix DESC
       LIMIT 40`,
      whBinds,
      warnings,
    );
  }

  if (await tableExists(db, 'agentsam_execution_performance_metrics')) {
    const phWhere = [metricDateClause(range)];
    const phBinds = [];
    if (tid) {
      phWhere.push('tenant_id = ?');
      phBinds.push(tid);
    }
    out.perf_headline = await d1First(
      db,
      'perf_h',
      `SELECT
         SUM(execution_count) AS executions,
         SUM(success_count) AS successes,
         SUM(failure_count) AS failures,
         AVG(avg_duration_ms) AS avg_latency_ms,
         SUM(total_cost_usd) AS total_cost_usd
       FROM agentsam_execution_performance_metrics
       WHERE ${phWhere.join(' AND ')}`,
      phBinds,
      warnings,
    );
  }

  const live =
    out.deployments.length +
      out.cron_runs.length +
      out.webhook_events.length +
      out.deployment_health.length >
    0;

  return analyticsResponse({
    ok: true,
    backend: 'd1',
    range,
    summary: { state: live ? 'LIVE' : 'EMPTY', bundle: out },
    rows: [],
    deployments: out,
    warnings,
  });
}

export async function handleAnalyticsMcpTools(request, url, env, { tenantId, workspaceId }) {
  void request;
  void workspaceId;
  const range = parseRange(url);
  const warnings = [];
  const db = env?.DB || null;
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;

  if (!db) {
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: { state: 'EMPTY' },
      rows: [],
      warnings,
    });
  }

  const timeClause =
    range === '24h'
      ? `datetime(created_at) >= datetime('now', '-24 hours')`
      : range === '30d'
        ? `datetime(created_at) >= datetime('now', '-30 days')`
        : range === 'all'
          ? `datetime(created_at) >= datetime('now', '-3650 days')`
          : `datetime(created_at) >= datetime('now', '-7 days')`;

  let rows = [];
  if (await tableExists(db, 'agentsam_mcp_tool_execution')) {
    const where = [timeClause];
    const binds = [];
    if (tid) {
      where.push('tenant_id = ?');
      binds.push(tid);
    }
    rows = await d1All(
      db,
      'mcp_agg',
      `SELECT
         COALESCE(NULLIF(trim(tool_name), ''), NULLIF(trim(tool_key), ''), '(unknown)') AS tool_name,
         COUNT(*) AS calls,
         SUM(CASE WHEN COALESCE(success, 0) = 1 THEN 1 ELSE 0 END) AS successes,
         AVG(COALESCE(duration_ms, 0)) AS avg_ms,
         MAX(COALESCE(duration_ms, 0)) AS max_ms
       FROM agentsam_mcp_tool_execution
       WHERE ${where.join(' AND ')}
       GROUP BY 1
       ORDER BY calls DESC
       LIMIT 60`,
      binds,
      warnings,
    );
  }

  if (!rows.length && (await tableExists(db, 'agentsam_tool_call_log'))) {
    const tclCols = await pragmaTableInfo(db, 'agentsam_tool_call_log');
    const where = [];
    const binds = [];
    if (tclCols.has('created_at')) {
      const tc =
        range === '24h'
          ? `created_at >= unixepoch('now', '-24 hours')`
          : range === '30d'
            ? `created_at >= unixepoch('now', '-30 days')`
            : range === 'all'
              ? `created_at >= unixepoch('now', '-3650 days')`
              : `created_at >= unixepoch('now', '-7 days')`;
      where.push(tc);
    } else {
      where.push('1=1');
    }
    if (tid && tclCols.has('tenant_id')) {
      where.push('tenant_id = ?');
      binds.push(tid);
    }
    rows = await d1All(
      db,
      'tcl_agg',
      `SELECT
         COALESCE(NULLIF(trim(tool_name), ''), '(unknown)') AS tool_name,
         COUNT(*) AS calls,
         SUM(CASE WHEN COALESCE(status, '') IN ('success','completed','ok') THEN 1 ELSE 0 END) AS successes,
         AVG(COALESCE(duration_ms, 0)) AS avg_ms,
         MAX(COALESCE(duration_ms, 0)) AS max_ms
       FROM agentsam_tool_call_log
       WHERE ${where.join(' AND ')}
       GROUP BY 1
       ORDER BY calls DESC
       LIMIT 60`,
      binds,
      warnings,
    );
  }

  let chainBreaks = [];
  if (await tableExists(db, 'agentsam_tool_chain')) {
    chainBreaks = await d1All(
      db,
      'chain_fail',
      `SELECT id, tool_status, tool_key, started_at, completed_at, duration_ms
       FROM agentsam_tool_chain
       WHERE tool_status = 'failed'
       ORDER BY started_at DESC
       LIMIT 40`,
      [],
      warnings,
    );
  }

  const slowest = [...rows]
    .sort((a, b) => (Number(b.avg_ms) || 0) - (Number(a.avg_ms) || 0))
    .slice(0, 15)
    .map((r) => ({
      tool_name: r.tool_name,
      avg_ms: Math.round(Number(r.avg_ms) || 0),
      calls: r.calls,
    }));

  return analyticsResponse({
    ok: true,
    backend: 'd1',
    range,
    summary: { state: rows.length ? 'LIVE' : 'EMPTY', slowest_tools: slowest, chain_break_rows: chainBreaks.length },
    rows,
    breakdowns: [{ key: 'chain_breaks', rows: chainBreaks }],
    warnings,
  });
}

/**
 * GET /api/analytics/errors/d1-log
 * Query: range, resolved=open|resolved|all, limit (max 200), source=substring
 * Full readout of agentsam_error_log for analytics triage + suggested_action heuristics.
 */
export async function handleAnalyticsErrorLogD1(request, url, env, { tenantId, workspaceId }) {
  void request;
  const range = parseRange(url);
  const warnings = [];
  const db = env?.DB || null;
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;
  const wid = workspaceId && String(workspaceId).trim() ? String(workspaceId).trim() : null;
  const resolvedRaw = (url.searchParams.get('resolved') || 'open').toLowerCase();
  let limit = Number(url.searchParams.get('limit') || 80) || 80;
  if (limit < 1) limit = 1;
  if (limit > 200) limit = 200;
  const sourceNeedle = (url.searchParams.get('source') || '').trim();

  if (!db || !(await tableExists(db, 'agentsam_error_log'))) {
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: { state: 'EMPTY', reason: 'no_table' },
      rows: [],
      warnings,
    });
  }

  const timeSql = errorLogCreatedClause(range);
  const baseWhere = [timeSql];
  const baseBinds = [];
  if (tid) {
    baseWhere.push('tenant_id = ?');
    baseBinds.push(tid);
  }
  if (wid) {
    baseWhere.push('workspace_id = ?');
    baseBinds.push(wid);
  }
  if (sourceNeedle) {
    baseWhere.push('LOWER(source) LIKE ?');
    baseBinds.push(`%${sourceNeedle.toLowerCase()}%`);
  }

  const listWhere = [...baseWhere];
  const listBinds = [...baseBinds];
  if (resolvedRaw === 'open' || resolvedRaw === '0' || resolvedRaw === 'false') {
    listWhere.push('COALESCE(resolved, 0) = 0');
  } else if (resolvedRaw === 'resolved' || resolvedRaw === '1' || resolvedRaw === 'true') {
    listWhere.push('COALESCE(resolved, 0) = 1');
  }

  const listWhereSql = listWhere.join(' AND ');
  const baseWhereSql = baseWhere.join(' AND ');

  const byType = await d1All(
    db,
    'err_by_type',
    `SELECT error_type, COUNT(*) AS c
     FROM agentsam_error_log
     WHERE ${listWhereSql}
     GROUP BY error_type
     ORDER BY c DESC
     LIMIT 30`,
    listBinds,
    warnings,
  );
  const bySource = await d1All(
    db,
    'err_by_source',
    `SELECT source, COUNT(*) AS c
     FROM agentsam_error_log
     WHERE ${listWhereSql}
     GROUP BY source
     ORDER BY c DESC
     LIMIT 30`,
    listBinds,
    warnings,
  );
  const openWhere = [...baseWhere, 'COALESCE(resolved, 0) = 0'];
  const openBinds = [...baseBinds];
  const openCountRow = await d1First(
    db,
    'err_open',
    `SELECT COUNT(*) AS c FROM agentsam_error_log WHERE ${openWhere.join(' AND ')}`,
    openBinds,
    warnings,
  );

  const rawRows = await d1All(
    db,
    'err_list',
    `SELECT id, workspace_id, tenant_id, session_id, error_code, error_type, error_message,
            source, source_id, context_json, stack_trace, resolved, created_at
     FROM agentsam_error_log
     WHERE ${listWhereSql}
     ORDER BY created_at DESC
     LIMIT ${limit}`,
    listBinds,
    warnings,
  );

  const rows = rawRows.map((r) => ({
    id: r.id,
    workspace_id: r.workspace_id,
    tenant_id: r.tenant_id,
    session_id: r.session_id,
    error_code: r.error_code,
    error_type: r.error_type,
    error_message: r.error_message,
    source: r.source,
    source_id: r.source_id,
    context_json: truncateStr(r.context_json, 1600),
    stack_trace: truncateStr(r.stack_trace, 2400),
    resolved: r.resolved,
    created_at: r.created_at,
    suggested_action: suggestedActionForErrorLogRow(r),
  }));

  return analyticsResponse({
    ok: true,
    backend: 'd1',
    range,
    summary: {
      state: rows.length ? 'LIVE' : 'EMPTY',
      resolved_filter: resolvedRaw,
      open_in_window: Number(openCountRow?.c ?? 0) || 0,
      row_count: rows.length,
      by_error_type: byType,
      by_source: bySource,
    },
    rows,
    warnings,
  });
}

export async function handleAnalyticsAdvisorsGuardrails(request, url, env, { tenantId }) {
  void request;
  const range = parseRange(url);
  const warnings = [];
  const db = env?.DB || null;
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;
  if (!db || !(await tableExists(db, 'agentsam_guardrail_events'))) {
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: { state: 'EMPTY' },
      rows: [],
      warnings,
    });
  }
  const cols = await pragmaTableInfo(db, 'agentsam_guardrail_events');
  const where = ['1=1'];
  const binds = [];
  if (tid && cols.has('tenant_id')) {
    where.push('tenant_id = ?');
    binds.push(tid);
  }
  if (cols.has('created_at')) {
    if (range === '24h') where.push(`datetime(created_at) >= datetime('now', '-24 hours')`);
    else if (range === '30d') where.push(`datetime(created_at) >= datetime('now', '-30 days')`);
    else if (range === 'all') where.push(`datetime(created_at) >= datetime('now', '-3650 days')`);
    else where.push(`datetime(created_at) >= datetime('now', '-7 days')`);
  }
  const rows = await d1All(
    db,
    'gr',
    `SELECT * FROM agentsam_guardrail_events WHERE ${where.join(' AND ')} ORDER BY rowid DESC LIMIT 120`,
    binds,
    warnings,
  );
  return analyticsResponse({
    ok: true,
    backend: 'd1',
    range,
    summary: { state: rows.length ? 'LIVE' : 'EMPTY' },
    rows,
    warnings,
  });
}

export async function handleAnalyticsAdvisors(request, url, env, { tenantId, workspaceId }) {
  void request;
  const range = parseRange(url);
  const warnings = [];
  const db = env?.DB || null;
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;
  const wid = workspaceId && String(workspaceId).trim() ? String(workspaceId).trim() : null;

  const findings = [];

  if (!tid) {
    findings.push({
      severity: 'warn',
      code: 'TENANT_CONTEXT_MISSING',
      title: 'Tenant context missing',
      detail: 'Analytics identity did not resolve tenant_id; scoped diagnostics may be incomplete.',
    });
  }
  if (!wid) {
    findings.push({
      severity: 'info',
      code: 'WORKSPACE_CONTEXT_MISSING',
      title: 'Workspace context missing',
      detail: 'workspace_id was not resolved on the request identity.',
    });
  }

  if (db && (await tableExists(db, 'agentsam_error_log'))) {
    const elWhere = [errorLogCreatedClause(range), `COALESCE(resolved, 0) = 0`];
    const elBinds = [];
    if (tid) {
      elWhere.push('tenant_id = ?');
      elBinds.push(tid);
    }
    const errs = await d1All(
      db,
      'adv_err',
      `SELECT id, source, error_type, error_message, created_at, resolved
       FROM agentsam_error_log
       WHERE ${elWhere.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT 40`,
      elBinds,
      warnings,
    );
    for (const e of errs.slice(0, 15)) {
      const et = String(e.error_type || '').toLowerCase();
      findings.push({
        severity: et.includes('fatal') || et.includes('critical') ? 'critical' : 'warn',
        code: 'ERROR_LOG_OPEN',
        title: `Open error: ${String(e.source || 'unknown')} · ${String(e.error_type || 'type')}`,
        detail: String(e.error_message || '').slice(0, 500),
        ref: e.id,
      });
    }
  }

  if (db && (await tableExists(db, 'agentsam_deployment_health'))) {
    const dh = await d1All(
      db,
      'adv_dh',
      `SELECT * FROM agentsam_deployment_health ORDER BY rowid DESC LIMIT 5`,
      [],
      warnings,
    );
    for (const row of dh) {
      const st = String(row.status || row.health || row.overall_status || '').toLowerCase();
      if (st && st !== 'ok' && st !== 'healthy' && st !== 'success') {
        findings.push({
          severity: 'warn',
          code: 'DEPLOYMENT_HEALTH',
          title: 'Deployment health signal',
          detail: JSON.stringify(row).slice(0, 600),
        });
      }
    }
  }

  if (db && (await tableExists(db, 'dashboard_versions')) && (await tableExists(db, 'deployments'))) {
    const dv = await d1First(db, 'adv_dv', `SELECT * FROM dashboard_versions ORDER BY rowid DESC LIMIT 1`, [], warnings);
    const dep = await d1First(db, 'adv_dep', `SELECT * FROM deployments ORDER BY rowid DESC LIMIT 1`, [], warnings);
    if (dv && dep) {
      const dvHash = String(dv.git_hash || dv.commit_sha || dv.build_hash || '').trim();
      const depHash = String(dep.git_hash || '').trim();
      if (dvHash && depHash && dvHash !== depHash) {
        findings.push({
          severity: 'info',
          code: 'DASHBOARD_WORKER_VERSION_DRIFT',
          title: 'Dashboard vs deployment git hash differ',
          detail: `dashboard_versions.git_hash=${dvHash} deployments.git_hash=${depHash}`,
        });
      }
    }
  }

  const critical = findings.filter((f) => f.severity === 'critical');
  const warns = findings.filter((f) => f.severity === 'warn');
  const infos = findings.filter((f) => f.severity === 'info');

  return analyticsResponse({
    ok: true,
    backend: 'mixed',
    range,
    summary: {
      state: findings.length ? 'LIVE' : 'EMPTY',
      counts: { critical: critical.length, warnings: warns.length, info: infos.length },
    },
    rows: findings,
    warnings,
  });
}
