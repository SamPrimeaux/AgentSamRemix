import { parseRange, analyticsResponse } from './sources/normalize.js';
import { supabaseQuery } from './sources/supabase.js';
import {
  hyperdriveConnectionStringAvailable,
  isHyperdriveBindingPresent,
  isHyperdriveUsable,
} from '../../../backend/services/database/hyperdrive.js';
import { tableExists, pragmaTableInfo } from '../../../backend/services/retention.js';
import { handleAnalyticsCodebase } from './codebase.js';
import { handleAnalyticsRag } from './rag.js';

/** @type {{ hasHyperdrive: boolean; hasQueryable: boolean; hasConnectionString: boolean } | null} */
let lastHyperdriveHealthSnapshot = null;

/** @param {any} env @param {string} route */
function logHyperdriveHealthOnChange(env, route) {
  const snapshot = {
    hasHyperdrive: isHyperdriveBindingPresent(env),
    hasQueryable: isHyperdriveUsable(env),
    hasConnectionString: hyperdriveConnectionStringAvailable(env),
  };
  const prev = lastHyperdriveHealthSnapshot;
  const changed =
    !prev ||
    prev.hasHyperdrive !== snapshot.hasHyperdrive ||
    prev.hasQueryable !== snapshot.hasQueryable ||
    prev.hasConnectionString !== snapshot.hasConnectionString;
  if (!changed) return;
  console.debug('[hyperdrive.health]', {
    ...snapshot,
    route,
    runtime: 'cloudflare-worker',
  });
  lastHyperdriveHealthSnapshot = snapshot;
}

function safePct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v * 10) / 10));
}

function wfRangeClause(range) {
  if (range === '24h') return `started_at >= unixepoch('now', '-24 hours')`;
  if (range === '30d') return `started_at >= unixepoch('now', '-30 days')`;
  if (range === 'all') return `started_at >= unixepoch('now', '-3650 days')`;
  return `started_at >= unixepoch('now', '-7 days')`;
}

function usageRangeClause(range, col = 'created_at') {
  if (range === '24h') return `${col} >= unixepoch('now', '-24 hours')`;
  if (range === '30d') return `${col} >= unixepoch('now', '-30 days')`;
  if (range === 'all') return `${col} >= unixepoch('now', '-3650 days')`;
  return `${col} >= unixepoch('now', '-7 days')`;
}

function stepRangeClause(range) {
  return usageRangeClause(range, 'created_at_unix');
}

function metricDateClause(range) {
  if (range === '24h') return `metric_date >= date('now', '-2 days')`;
  if (range === '30d') return `metric_date >= date('now', '-30 days')`;
  if (range === 'all') return `metric_date >= date('now', '-3650 days')`;
  return `metric_date >= date('now', '-7 days')`;
}

function pgRangeInterval(range) {
  if (range === '24h') return "interval '24 hours'";
  if (range === '30d') return "interval '30 days'";
  if (range === 'all') return "interval '3650 days'";
  return "interval '7 days'";
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function d1First(db, label, sql, binds, ctx) {
  if (!db) return null;
  try {
    return await db.prepare(sql).bind(...binds).first();
  } catch (e) {
    ctx.sourceStatus.errors.push(`D1 ${label}: ${String(e?.message || e)}`);
    return null;
  }
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function d1All(db, label, sql, binds, ctx) {
  if (!db) return [];
  try {
    const { results } = await db.prepare(sql).bind(...binds).all();
    return results || [];
  } catch (e) {
    ctx.sourceStatus.errors.push(`D1 ${label}: ${String(e?.message || e)}`);
    return [];
  }
}

function kpi(value, sourceTables, timeWindow, isLive, warning = null, extra = {}) {
  return {
    value,
    sourceTables,
    timeWindow,
    isLive,
    warning,
    ...extra,
  };
}

/** Aligns with workflow-executor step_results_json entries. */
function usageFromGraphStepResult(s) {
  const o = s?.output;
  if (!o || typeof o !== 'object') return { tin: 0, tout: 0, cost: 0 };
  const u = o.usage && typeof o.usage === 'object' ? o.usage : o;
  const tin = Number(u.input_tokens ?? u.prompt_tokens ?? o.tokens_in ?? 0) || 0;
  const tout = Number(u.output_tokens ?? u.completion_tokens ?? o.tokens_out ?? 0) || 0;
  const cost = Number(o.cost_usd ?? u.cost_usd ?? 0) || 0;
  return { tin, tout, cost };
}

/**
 * Build waterfall steps from agentsam_workflow_runs.step_results_json when
 * agentsam_execution_steps is sparse or missing (e.g. ledger not linked).
 */
function coerceStepResultsJsonField(row) {
  if (!row || row.step_results_json == null) return row;
  const sr = row.step_results_json;
  if (typeof sr === 'string') return row;
  try {
    return { ...row, step_results_json: JSON.stringify(sr) };
  } catch {
    return row;
  }
}

function waterfallFromStepResultsJson(stepResultsJson) {
  let arr = [];
  const raw =
    stepResultsJson != null && typeof stepResultsJson !== 'string'
      ? JSON.stringify(stepResultsJson)
      : stepResultsJson;
  try {
    arr = JSON.parse(raw || '[]');
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || !arr.length) return null;
  const rows = arr.map((s) => {
    const u = usageFromGraphStepResult(s);
    const ok = s?.ok !== false && s?.error == null;
    return {
      node_key: s.node_key ?? s.nodeKey ?? null,
      status: ok ? 'completed' : 'failed',
      latency_ms: Number(s.latency_ms ?? 0) || 0,
      tokens_in: u.tin,
      tokens_out: u.tout,
      cost_usd: u.cost,
    };
  });
  const maxLat = Math.max(1, ...rows.map((r) => Number(r.latency_ms) || 0));
  return rows.map((r) => ({
    ...r,
    bar: maxLat ? (Number(r.latency_ms) || 0) / maxLat : 0,
  }));
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function fetchWorkflowRunRowById(db, runId, tid, ctx, warnings) {
  if (!runId || !db) return null;
  const id = String(runId);
  const cols =
    'id, run_group_id, model_used, input_tokens, output_tokens, cost_usd, step_results_json, status, tenant_id, workspace_id';
  const strictBinds = [id];
  let strictSql = `SELECT ${cols} FROM agentsam_workflow_runs WHERE id = ?`;
  if (tid) {
    strictSql += ' AND tenant_id = ?';
    strictBinds.push(tid);
  }
  strictSql += ' LIMIT 1';
  let row = await d1First(db, 'wrun_highlight_strict', strictSql, strictBinds, ctx);
  if (!row && tid) {
    row = await d1First(
      db,
      'wrun_highlight_loose',
      `SELECT ${cols} FROM agentsam_workflow_runs WHERE id = ? LIMIT 1`,
      [id],
      ctx,
    );
    if (row?.tenant_id && row.tenant_id !== tid) {
      warnings.push({
        code: 'HIGHLIGHT_RUN_TENANT_MISMATCH',
        message: `highlightRun ${id} belongs to tenant ${row.tenant_id}; request tenant ${tid}.`,
        backend: 'd1',
        severity: 'warn',
      });
    }
  }
  return row || null;
}

async function loadWorkflowRunFromSupabase(env, runId) {
  const r = await supabaseQuery(
    env,
    `SELECT id, run_group_id, model_used, input_tokens, output_tokens, cost_usd,
            step_results_json, status, tenant_id
     FROM agentsam.agentsam_workflow_runs
     WHERE id = $1
     LIMIT 1`,
    [runId],
  );
  if (!r.ok || !r.rows?.[0]) return null;
  return coerceStepResultsJsonField(r.rows[0]);
}

async function loadSubJson(request, url, env, path, range, tenantId) {
  const u = new URL(url);
  u.pathname = path;
  u.search = `?range=${encodeURIComponent(range)}`;
  try {
    if (path === '/api/analytics/codebase') {
      const res = await handleAnalyticsCodebase(request, u, env, { tenantId });
      return { ok: res.ok, json: await res.json() };
    }
    if (path === '/api/analytics/rag') {
      const res = await handleAnalyticsRag(request, u, env, { tenantId });
      return { ok: res.ok, json: await res.json() };
    }
  } catch (e) {
    return { ok: false, json: { error: String(e?.message || e) } };
  }
  return { ok: false, json: {} };
}

export async function handleAnalyticsOverview(request, url, env, { tenantId, workspaceId }) {
  const range = parseRange(url);
  const warnings = [];
  const db = env?.DB || null;
  const hasBindingShell = isHyperdriveBindingPresent(env);
  const hyperdriveReady = isHyperdriveUsable(env);
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;
  const wid = workspaceId && String(workspaceId).trim() ? String(workspaceId).trim() : null;

  logHyperdriveHealthOnChange(env, url.pathname);

  const ctx = {
    sourceStatus: { live: [], empty: [], blocked: [], errors: [] },
  };

  const markLive = (s) => {
    if (!ctx.sourceStatus.live.includes(s)) ctx.sourceStatus.live.push(s);
  };
  const markEmpty = (s) => {
    if (!ctx.sourceStatus.empty.includes(s)) ctx.sourceStatus.empty.push(s);
  };
  const markBlocked = (s) => {
    if (!ctx.sourceStatus.blocked.includes(s)) ctx.sourceStatus.blocked.push(s);
  };

  if (!tid) {
    warnings.push({
      code: 'TENANT_ID_MISSING',
      message: 'No tenant_id resolved; metrics are tenant-unscoped where optional.',
      backend: 'mixed',
      severity: 'warn',
    });
  }

  if (!db) {
    warnings.push({
      code: 'D1_BINDING_MISSING',
      message: 'D1 binding env.DB is not configured; D1-backed observability is unavailable.',
      backend: 'd1',
      severity: 'critical',
    });
    markBlocked('D1 env.DB');
    return analyticsResponse({
      ok: true,
      backend: hyperdriveReady ? 'mixed' : 'd1',
      range,
      summary: {},
      rows: [],
      warnings,
      kpis: {
        workflowRuns: kpi(null, [], range, false, 'D1 not configured'),
        evalPassRate: kpi(null, [], range, false, 'D1 not configured'),
        toolSuccess: kpi(null, [], range, false, 'D1 not configured'),
        openErrors: kpi(null, [], range, false, 'D1 not configured'),
        tokenUsage: kpi(null, [], range, false, 'D1 not configured'),
        aiCost: kpi(null, [], range, false, 'D1 not configured'),
        avgLatency: kpi(null, [], range, false, 'D1 not configured'),
        dataHealth: kpi(null, [], range, false, 'D1 not configured'),
      },
      workflowRunsOverTime: [],
      latestExecutionWaterfall: { workflow_run_id: null, run_group_id: null, steps: [], state: 'BLOCKED', reason: 'D1 missing' },
      verifiedTrace: null,
      errorInbox: [],
      modelLeaderboard: [],
      costLatencyScatter: [],
      tokensOverTime: [],
      codebaseOverview: {
        ok: false,
        state: 'BLOCKED',
        endpoint: '/api/analytics/codebase',
        reason: 'Worker D1 unavailable',
        nextStep: 'Configure env.DB',
      },
      ragHealth: {
        ok: false,
        state: 'BLOCKED',
        endpoint: '/api/analytics/rag',
        reason: 'Worker D1 unavailable',
        nextStep: 'Configure env.DB',
      },
      deployments: {
        state: 'BLOCKED',
        reason: 'D1 missing',
        nextStep: 'Configure env.DB and/or Hyperdrive for build_deploy_events',
        rows: [],
      },
      sourceStatus: ctx.sourceStatus,
      meta: {
        generatedAt: new Date().toISOString(),
        timeRange: range,
        workspaceId: wid,
        tenantId: tid,
      },
    });
  }

  if (!hasBindingShell) {
    warnings.push({
      code: 'HYPERDRIVE_BINDING_MISSING',
      message: 'Hyperdrive binding env.HYPERDRIVE is not present; Supabase panels (errors, evals) are unavailable.',
      backend: 'supabase',
      severity: 'warn',
    });
    markBlocked('Supabase via env.HYPERDRIVE');
  } else if (!hyperdriveReady) {
    warnings.push({
      code: 'HYPERDRIVE_BINDING_MISSING',
      message:
        'Hyperdrive binding is present but not usable (no native .query and no connectionString); Supabase panels may be partial.',
      backend: 'supabase',
      severity: 'warn',
    });
    markBlocked('Supabase via env.HYPERDRIVE');
  } else {
    const probe = await supabaseQuery(env, 'SELECT 1 AS one', []);
    if (!probe.ok) {
      warnings.push({
        code: 'HYPERDRIVE_QUERY_FAILED',
        message: `Supabase/Hyperdrive query probe failed: ${probe.warning || 'unknown'}`.slice(0, 500),
        backend: 'supabase',
        severity: 'warn',
      });
    }
  }

  const wfWhere = [wfRangeClause(range)];
  const wfBinds = [];
  if (tid) {
    wfWhere.push('tenant_id = ?');
    wfBinds.push(tid);
  }
  if (wid) {
    wfWhere.push('workspace_id = ?');
    wfBinds.push(wid);
  }
  const wfWhereSql = wfWhere.join(' AND ');

  const usageWhere = [usageRangeClause(range, 'created_at')];
  const usageBinds = [];
  if (tid) {
    usageWhere.push('tenant_id = ?');
    usageBinds.push(tid);
  }
  if (wid) {
    usageWhere.push('workspace_id = ?');
    usageBinds.push(wid);
  }
  // Exclude legacy provider_daily_rollup mirror rows (model_key = 'rollup')
  usageWhere.push("(model_key IS NULL OR model_key != 'rollup')");
  const usageWhereSql = usageWhere.join(' AND ');

  const usageCols = await pragmaTableInfo(db, 'agentsam_usage_events');
  const hasTotalTokensCol = usageCols.has('total_tokens');
  const tokensExpr = hasTotalTokensCol
    ? 'COALESCE(SUM(COALESCE(total_tokens, tokens_in + tokens_out)), 0)'
    : 'COALESCE(SUM(COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)), 0)';

  const usageAgg = await d1First(
    db,
    'usage_agg',
    `SELECT
       COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
       ${tokensExpr} AS total_tokens,
       COALESCE(SUM(COALESCE(tokens_in, 0)), 0) AS tokens_in,
       COALESCE(SUM(COALESCE(tokens_out, 0)), 0) AS tokens_out
     FROM agentsam_usage_events
     WHERE ${usageWhereSql}`,
    usageBinds,
    ctx,
  );
  if (usageAgg) {
    const tt = Number(usageAgg.total_tokens ?? 0) || 0;
    const tc = Number(usageAgg.total_cost_usd ?? 0) || 0;
    const tin0 = Number(usageAgg.tokens_in ?? 0) || 0;
    const tout0 = Number(usageAgg.tokens_out ?? 0) || 0;
    if (tt === 0 && tc === 0 && tin0 + tout0 === 0) markEmpty('D1 agentsam_usage_events (window)');
    else markLive('D1 agentsam_usage_events');
  }

  const wfRunAgg = await d1First(
    db,
    'wf_run_agg',
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
       SUM(CASE WHEN status NOT IN ('completed','failed','running') THEN 1 ELSE 0 END) AS other
     FROM agentsam_workflow_runs
     WHERE ${wfWhereSql}`,
    wfBinds,
    ctx,
  );
  if (wfRunAgg) {
    if (Number(wfRunAgg.total ?? 0) === 0) markEmpty('D1 agentsam_workflow_runs (window)');
    else markLive('D1 agentsam_workflow_runs');
  }

  const wfCostFallback = await d1First(
    db,
    'wf_cost_fallback',
    `SELECT
       COALESCE(SUM(cost_usd), 0) AS cost_usd,
       COALESCE(SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0)), 0) AS tokens
     FROM agentsam_workflow_runs
     WHERE ${wfWhereSql}`,
    wfBinds,
    ctx,
  );

  let totalCost = Number(usageAgg?.total_cost_usd ?? 0) || 0;
  let totalTokens = Number(usageAgg?.total_tokens ?? 0) || 0;
  let tokensIn = Number(usageAgg?.tokens_in ?? 0) || 0;
  let tokensOut = Number(usageAgg?.tokens_out ?? 0) || 0;
  let costWarning = null;
  if (totalCost <= 0 && Number(wfCostFallback?.cost_usd ?? 0) > 0) {
    totalCost = Number(wfCostFallback.cost_usd) || 0;
    costWarning = 'Primary cost from agentsam_workflow_runs.cost_usd (usage_events had no cost in window)';
    markLive('D1 agentsam_workflow_runs (cost fallback)');
  }
  if (totalTokens <= 0 && Number(wfCostFallback?.tokens ?? 0) > 0) {
    totalTokens = Number(wfCostFallback.tokens) || 0;
    if (!costWarning) costWarning = 'Token total from agentsam_workflow_runs (usage_events had no tokens in window)';
  }

  const wfStatusRows = await d1All(
    db,
    'wf_status',
    `SELECT status, COUNT(*) AS c FROM agentsam_workflow_runs WHERE ${wfWhereSql} GROUP BY status`,
    wfBinds,
    ctx,
  );

  const wfTrend = await d1All(
    db,
    'wf_trend',
    `SELECT date(datetime(started_at, 'unixepoch')) AS day, status, COUNT(*) AS c
     FROM agentsam_workflow_runs
     WHERE ${wfWhereSql}
     GROUP BY 1, 2
     ORDER BY 1 ASC`,
    wfBinds,
    ctx,
  );

  const wfSpark = await d1All(
    db,
    'wf_spark',
    `SELECT date(datetime(started_at, 'unixepoch')) AS day, COUNT(*) AS c
     FROM agentsam_workflow_runs
     WHERE ${wfWhereSql}
     GROUP BY 1 ORDER BY 1 ASC`,
    wfBinds,
    ctx,
  );

  const stepCols = await pragmaTableInfo(db, 'agentsam_execution_steps');
  const stepTimeSql = stepCols.has('created_at_unix') ? stepRangeClause(range) : '1=1';
  const stepWhere = [stepTimeSql];
  const stepBinds = [];
  if (tid && stepCols.has('tenant_id')) {
    stepWhere.push('tenant_id = ?');
    stepBinds.push(tid);
  }
  if (wid && stepCols.has('workspace_id')) {
    stepWhere.push('workspace_id = ?');
    stepBinds.push(wid);
  }
  const stepWhereSql = stepWhere.join(' AND ');

  let toolRow = await d1First(
    db,
    'exec_steps_tool',
    `SELECT
       COUNT(*) AS call_count,
       SUM(CASE WHEN status IN ('success','completed') THEN 1 ELSE 0 END) AS success_count
     FROM agentsam_execution_steps
     WHERE ${stepWhereSql}`,
    stepBinds,
    ctx,
  );
  let toolSource = 'agentsam_execution_steps';
  const toolCalls = Number(toolRow?.call_count ?? 0) || 0;
  if (toolCalls === 0 && (await tableExists(db, 'agentsam_mcp_tool_execution'))) {
    const mcpWhere = [usageRangeClause(range, 'created_at')];
    const mcpBinds = [];
    if (tid) {
      mcpWhere.push('tenant_id = ?');
      mcpBinds.push(tid);
    }
    toolRow = await d1First(
      db,
      'mcp_tool',
      `SELECT
         COUNT(*) AS call_count,
         SUM(CASE WHEN COALESCE(success, 0) = 1 THEN 1 ELSE 0 END) AS success_count
       FROM agentsam_mcp_tool_execution
       WHERE ${mcpWhere.join(' AND ')}`,
      mcpBinds,
      ctx,
    );
    toolSource = 'agentsam_mcp_tool_execution';
  }
  const toolCalls2 = Number(toolRow?.call_count ?? 0) || 0;
  const toolSuccess =
    toolCalls2 > 0 ? safePct((Number(toolRow?.success_count ?? 0) || 0) / toolCalls2 * 100) : null;
  if (toolCalls2 === 0) markEmpty(`D1 ${toolSource} (window)`);
  else markLive(`D1 ${toolSource}`);

  let openErr = 0;
  let errTableUsed = 'agentsam_error_events (Supabase)';
  if (hyperdriveReady) {
    const errTry = await supabaseQuery(
      env,
      `SELECT COUNT(*)::int AS c
       FROM agentsam.agentsam_error_events
       WHERE ($1::text IS NULL OR tenant_id = $1)
         AND (resolved IS NOT TRUE)
         AND created_at >= now() - ${pgRangeInterval(range)}`,
      [tid],
    );
    if (errTry.ok) {
      openErr = Number(errTry.rows?.[0]?.c ?? 0) || 0;
      markLive('Supabase agentsam_error_events');
      if (openErr === 0) markEmpty('Supabase agentsam_error_events (window)');
    } else {
      const errTry2 = await supabaseQuery(
        env,
        `SELECT COUNT(*)::int AS c FROM agentsam.agentsam_error_events LIMIT 1`,
        [],
      );
      if (!errTry2.ok) {
        markBlocked(`Supabase agentsam_error_events: ${errTry.warning || 'query_failed'}`);
        errTableUsed = 'agentsam_error_events';
      } else {
        openErr = 0;
        markEmpty('Supabase agentsam_error_events');
      }
    }
  }

  if (openErr === 0 && (await tableExists(db, 'agentsam_error_log'))) {
    const elWhere = [
      usageRangeClause(range, 'created_at'),
      `COALESCE(status,'') NOT IN ('resolved','closed')`,
    ];
    const elBinds = [];
    if (tid) {
      elWhere.push('tenant_id = ?');
      elBinds.push(tid);
    }
    const elRow = await d1First(
      db,
      'error_log',
      `SELECT COUNT(*) AS c FROM agentsam_error_log WHERE ${elWhere.join(' AND ')}`,
      elBinds,
      ctx,
    );
    const c = Number(elRow?.c ?? 0) || 0;
    if (c > 0) {
      openErr = c;
      errTableUsed = 'agentsam_error_log (D1)';
      markLive('D1 agentsam_error_log');
    } else if (!hyperdriveReady) {
      markEmpty('D1 agentsam_error_log (window)');
    }
  }

  const perfWhere = [metricDateClause(range)];
  const perfBinds = [];
  if (tid) {
    perfWhere.push('tenant_id = ?');
    perfBinds.push(tid);
  }
  if (wid) {
    perfWhere.push('workspace_id = ?');
    perfBinds.push(wid);
  }
  let perfAvg = await d1First(
    db,
    'perf_avg',
    `SELECT ROUND(AVG(avg_duration_ms), 0) AS avg_latency_ms
     FROM agentsam_execution_performance_metrics
     WHERE ${perfWhere.join(' AND ')}`,
    perfBinds,
    ctx,
  );
  let avgMs = Number(perfAvg?.avg_latency_ms ?? 0) || 0;
  if (avgMs <= 0) {
    const wrDur = await d1First(
      db,
      'wf_dur',
      `SELECT ROUND(AVG(duration_ms), 0) AS avg_ms
       FROM agentsam_workflow_runs
       WHERE ${wfWhereSql} AND status = 'completed' AND duration_ms IS NOT NULL`,
      wfBinds,
      ctx,
    );
    avgMs = Number(wrDur?.avg_ms ?? 0) || 0;
    if (avgMs > 0) markLive('D1 agentsam_workflow_runs.duration_ms');
  } else {
    markLive('D1 agentsam_execution_performance_metrics');
  }

  const latSamples = await d1All(
    db,
    'lat_samples',
    `SELECT latency_ms FROM agentsam_execution_steps
     WHERE ${stepWhereSql} AND latency_ms IS NOT NULL AND latency_ms > 0
     ORDER BY latency_ms ASC LIMIT 400`,
    stepBinds,
    ctx,
  );
  let p95 = null;
  if (latSamples.length) {
    const idx = Math.min(latSamples.length - 1, Math.floor(latSamples.length * 0.95));
    p95 = Number(latSamples[idx]?.latency_ms) || null;
  }

  const latestUsageLat = await d1First(
    db,
    'usage_lat',
    `SELECT duration_ms, model, provider
     FROM agentsam_usage_events
     WHERE ${usageWhereSql} AND duration_ms IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    usageBinds,
    ctx,
  );

  let evalPassRate = null;
  let evalTotal = 0;
  let evalPassed = 0;
  let evalSource = 'agentsam_eval_runs';
  let supabaseEvalProbeOk = false;
  const d1HasEvalTable = await tableExists(db, 'agentsam_eval_runs');

  if (hyperdriveReady) {
    const evInterval = pgRangeInterval(range);
    let ev = await supabaseQuery(
      env,
      `SELECT
         COUNT(*)::int AS total,
         SUM(CASE WHEN COALESCE(passed::text,'') IN ('true','t','1') THEN 1 ELSE 0 END)::int AS passed
       FROM agentsam.agentsam_eval_runs
       WHERE ($1::text IS NULL OR tenant_id = $1)
         AND created_at >= now() - ${evInterval}`,
      [tid],
    );
    if (!ev.ok) {
      ev = await supabaseQuery(
        env,
        `SELECT
           COUNT(*)::int AS total,
           SUM(CASE WHEN COALESCE(passed::text,'') IN ('true','t','1') THEN 1 ELSE 0 END)::int AS passed
         FROM agentsam.agentsam_eval_runs
         WHERE ($1::text IS NULL OR tenant_id = $1)
           AND run_at::timestamptz >= now() - ${evInterval}`,
        [tid],
      );
    }
    if (ev.ok && ev.rows?.[0]) {
      supabaseEvalProbeOk = true;
      evalTotal = Number(ev.rows[0].total ?? 0) || 0;
      evalPassed = Number(ev.rows[0].passed ?? 0) || 0;
      evalPassRate = evalTotal > 0 ? safePct((evalPassed / evalTotal) * 100) : null;
      evalSource = 'Supabase agentsam_eval_runs';
      if (evalTotal === 0) markEmpty('Supabase agentsam_eval_runs (window)');
      else markLive('Supabase agentsam_eval_runs');
    } else {
      const ev2 = await supabaseQuery(
        env,
        `SELECT COUNT(*)::int AS c FROM agentsam.agentsam_eval_runs LIMIT 1`,
        [],
      );
      if (!ev2.ok) {
        markBlocked(`Supabase agentsam_eval_runs: ${ev.warning || 'query_failed'}`);
      }
    }
  }

  if (evalTotal === 0 && d1HasEvalTable) {
    const evWhere = [`datetime(run_at) >= datetime('now', ${range === '30d' ? "'-30 days'" : range === 'all' ? "'-3650 days'" : "'-7 days'"})`];
    const evBinds = [];
    if (tid) {
      evWhere.push('tenant_id = ?');
      evBinds.push(tid);
    }
    const evRow = await d1First(
      db,
      'eval_d1',
      `SELECT COUNT(*) AS total, SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) AS passed
       FROM agentsam_eval_runs
       WHERE ${evWhere.join(' AND ')}`,
      evBinds,
      ctx,
    );
    const t = Number(evRow?.total ?? 0) || 0;
    const p = Number(evRow?.passed ?? 0) || 0;
    if (t > 0) {
      evalTotal = t;
      evalPassed = p;
      evalPassRate = safePct((p / t) * 100);
      evalSource = 'D1 agentsam_eval_runs';
      markLive('D1 agentsam_eval_runs');
    }
  }

  const tokensDaily = await d1All(
    db,
    'tokens_daily',
    `SELECT date(datetime(created_at, 'unixepoch')) AS day,
            COALESCE(SUM(COALESCE(tokens_in,0)), 0) AS tin,
            COALESCE(SUM(COALESCE(tokens_out,0)), 0) AS tout
     FROM agentsam_usage_events
     WHERE ${usageWhereSql}
     GROUP BY 1 ORDER BY 1 ASC`,
    usageBinds,
    ctx,
  );

  const tokenSpark = tokensDaily.map((r) => Number(r.tin ?? 0) + Number(r.tout ?? 0));

  const scatterRows = await d1All(
    db,
    'scatter',
    `SELECT model, provider,
            COALESCE(cost_usd, 0) AS cost_usd,
            COALESCE(duration_ms, 0) AS latency_ms,
            (COALESCE(tokens_in,0) + COALESCE(tokens_out,0)) AS total_tokens
     FROM agentsam_usage_events
     WHERE ${usageWhereSql}
       AND (COALESCE(cost_usd,0) > 0 OR COALESCE(duration_ms,0) > 0)
     ORDER BY created_at DESC
     LIMIT 120`,
    usageBinds,
    ctx,
  );

  const leaderboardRows = await d1All(
    db,
    'leader_usage',
    `SELECT
       model,
       provider,
       COUNT(*) AS runs,
       SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS succ,
       AVG(COALESCE(duration_ms, 0)) AS avg_latency_ms,
       SUM(COALESCE(cost_usd, 0)) AS sum_cost,
       SUM(COALESCE(tokens_in,0) + COALESCE(tokens_out,0)) AS sum_tokens
     FROM agentsam_usage_events
     WHERE ${usageWhereSql}
     GROUP BY model, provider
     ORDER BY runs DESC
     LIMIT 25`,
    usageBinds,
    ctx,
  );

  const catalogCols = await pragmaTableInfo(db, 'agentsam_model_catalog');
  const modelLeaderboard = [];
  for (const row of leaderboardRows) {
    const mk = String(row.model || '').trim();
    let priced = false;
    let routable = false;
    let qualityScore = null;
    if (mk && catalogCols.size) {
      const catRow = await d1First(
        db,
        'cat',
        `SELECT cost_per_1k_in, cost_per_1k_out, is_active
         FROM agentsam_model_catalog
         WHERE model_key = ?
         LIMIT 1`,
        [mk],
        ctx,
      );
      const cin = Number(catRow?.cost_per_1k_in ?? 0) || 0;
      const cout = Number(catRow?.cost_per_1k_out ?? 0) || 0;
      priced = cin + cout > 0 && Number(catRow?.is_active ?? 0) === 1;
    }
    if (wid) {
      const ra = await d1First(
        db,
        'ra',
        `SELECT 1 AS ok FROM agentsam_routing_arms
         WHERE workspace_id = ? AND model_key = ? AND COALESCE(is_eligible,0) = 1 AND COALESCE(is_paused,0) = 0
         LIMIT 1`,
        [wid, mk],
        ctx,
      );
      routable = !!ra?.ok;
    }
    const runs = Number(row.runs ?? 0) || 0;
    const succ = Number(row.succ ?? 0) || 0;
    modelLeaderboard.push({
      model: mk,
      provider: String(row.provider || ''),
      runs,
      success_rate: runs > 0 ? safePct((succ / runs) * 100) : null,
      avg_latency_ms: Math.round(Number(row.avg_latency_ms ?? 0) || 0),
      avg_cost: runs > 0 ? Number(row.sum_cost ?? 0) / runs : 0,
      tokens: Number(row.sum_tokens ?? 0) || 0,
      quality_score: qualityScore,
      priced,
      routable,
      eligible_pricing: priced,
    });
  }
  if (leaderboardRows.length) markLive('D1 agentsam_usage_events (leaderboard)');
  else markEmpty('D1 agentsam_usage_events (leaderboard window)');

  const latestRun = await d1First(
    db,
    'latest_wrun',
    `SELECT id, run_group_id, model_used, status, completed_at, started_at
     FROM agentsam_workflow_runs
     WHERE ${wfWhereSql} AND status = 'completed' AND completed_at IS NOT NULL
     ORDER BY completed_at DESC LIMIT 1`,
    wfBinds,
    ctx,
  );

  let waterfallRunId = latestRun?.id ? String(latestRun.id) : null;
  const highlightRaw = url.searchParams.get('highlightRun');
  const highlight =
    highlightRaw && /^wrun_[a-zA-Z0-9_]+$/.test(String(highlightRaw)) ? String(highlightRaw) : null;

  /** Full row for the run driving the waterfall (tokens, run_group, step_results_json). */
  let waterfallRunRow = null;

  if (highlight) {
    let hlRow = await fetchWorkflowRunRowById(db, highlight, tid, ctx, warnings);
    if (!hlRow && hyperdriveReady) {
      hlRow = await loadWorkflowRunFromSupabase(env, highlight);
      if (hlRow) markLive('Supabase agentsam_workflow_runs (highlightRun)');
    }
    if (hlRow?.id) {
      waterfallRunId = String(hlRow.id);
      waterfallRunRow = coerceStepResultsJsonField(hlRow);
    }
  }

  if (waterfallRunId && !waterfallRunRow) {
    let wr = await fetchWorkflowRunRowById(db, waterfallRunId, tid, ctx, warnings);
    if (!wr && hyperdriveReady) {
      wr = await loadWorkflowRunFromSupabase(env, waterfallRunId);
      if (wr) markLive('Supabase agentsam_workflow_runs (waterfall run row)');
    }
    waterfallRunRow = coerceStepResultsJsonField(wr);
  }

  let verifiedTrace = null;
  if (highlight && waterfallRunRow?.id != null && String(waterfallRunRow.id) === highlight) {
    const tin = Number(waterfallRunRow.input_tokens ?? 0) || 0;
    const tout = Number(waterfallRunRow.output_tokens ?? 0) || 0;
    verifiedTrace = {
      workflow_run_id: String(waterfallRunRow.id),
      run_group_id: waterfallRunRow.run_group_id != null ? String(waterfallRunRow.run_group_id) : null,
      model: waterfallRunRow.model_used != null ? String(waterfallRunRow.model_used) : null,
      input_tokens: tin,
      output_tokens: tout,
      total_tokens: tin + tout,
      cost_usd: Number(waterfallRunRow.cost_usd ?? 0) || 0,
      status: waterfallRunRow.status != null ? String(waterfallRunRow.status) : null,
    };
  }

  let latestExecutionWaterfall = [];
  if (waterfallRunId) {
    const wfSteps = await d1All(
      db,
      'wf_steps',
      `SELECT node_key, status, latency_ms, tokens_in, tokens_out, cost_usd, execution_id, workflow_run_id
       FROM agentsam_execution_steps
       WHERE workflow_run_id = ?
       ORDER BY created_at_unix ASC`,
      [waterfallRunId],
      ctx,
    );
    const maxLat = Math.max(1, ...wfSteps.map((s) => Number(s.latency_ms ?? 0) || 0));
    let fromLedger = wfSteps.map((s) => ({
      node_key: s.node_key,
      status: s.status,
      latency_ms: Number(s.latency_ms ?? 0) || 0,
      bar: maxLat ? (Number(s.latency_ms ?? 0) || 0) / maxLat : 0,
      tokens_in: Number(s.tokens_in ?? 0) || 0,
      tokens_out: Number(s.tokens_out ?? 0) || 0,
      cost_usd: Number(s.cost_usd ?? 0) || 0,
    }));

    const fromJson = waterfallRunRow?.step_results_json
      ? waterfallFromStepResultsJson(waterfallRunRow.step_results_json)
      : null;
    const highlightAligned = Boolean(
      highlight && waterfallRunId && String(waterfallRunId) === highlight,
    );
    if (highlightAligned && fromJson?.length) {
      latestExecutionWaterfall = fromJson;
      markLive('agentsam_workflow_runs.step_results_json (highlightRun trace)');
    } else if (fromJson?.length && (!fromLedger.length || fromJson.length > fromLedger.length)) {
      latestExecutionWaterfall = fromJson;
      markLive('agentsam_workflow_runs.step_results_json (waterfall)');
    } else if (fromLedger.length) {
      latestExecutionWaterfall = fromLedger;
      markLive('D1 agentsam_execution_steps (waterfall)');
    } else if (fromJson?.length) {
      latestExecutionWaterfall = fromJson;
      markLive('agentsam_workflow_runs.step_results_json (waterfall)');
    } else {
      latestExecutionWaterfall = [];
      markEmpty('D1 agentsam_execution_steps (no rows for latest run)');
    }
  } else {
    latestExecutionWaterfall = [];
    markEmpty('D1 agentsam_workflow_runs (no completed run in window)');
  }

  let toolSuccessKpi = toolSuccess;
  let toolCallsKpi = toolCalls2;
  let toolSourceKpi = toolSource;
  let toolSuccessWarning = toolCalls2 === 0 ? 'No execution steps in window' : null;
  if (toolCalls2 === 0 && latestExecutionWaterfall.length) {
    const succN = latestExecutionWaterfall.filter((s) =>
      ['success', 'completed'].includes(String(s.status || '').toLowerCase()),
    ).length;
    toolCallsKpi = latestExecutionWaterfall.length;
    toolSuccessKpi = toolCallsKpi > 0 ? safePct((succN / toolCallsKpi) * 100) : null;
    toolSourceKpi = 'agentsam_execution_steps (highlighted workflow run)';
    toolSuccessWarning =
      'KPI used latest/highlight workflow steps because the global execution_steps time window had no rows';
    markLive('D1 agentsam_execution_steps (latest-run KPI fallback)');
  }

  let errorInbox = [];
  if (hyperdriveReady) {
    let inbox = await supabaseQuery(
      env,
      `SELECT created_at, severity, message, run_group_id, resolved
       FROM agentsam.agentsam_error_events
       WHERE ($1::text IS NULL OR tenant_id = $1)
       ORDER BY created_at DESC NULLS LAST
       LIMIT 40`,
      [tid],
    );
    if (!inbox.ok) {
      inbox = await supabaseQuery(
        env,
        `SELECT created_at, message, run_group_id
         FROM agentsam.agentsam_error_events
         WHERE ($1::text IS NULL OR tenant_id = $1)
         ORDER BY created_at DESC NULLS LAST
         LIMIT 40`,
        [tid],
      );
    }
    if (inbox.ok) {
      errorInbox = (inbox.rows || []).map((r) => ({
        time: r.created_at,
        source: r.source ?? r.error_type ?? 'agentsam_error_events',
        message: r.message ?? '',
        severity: r.severity ?? 'info',
        run_group_id: r.run_group_id ?? null,
        resolved: r.resolved ?? false,
      }));
    } else {
      errorInbox = [];
      ctx.sourceStatus.errors.push(`Supabase error inbox: ${inbox.warning}`);
    }
  }

  const monthWhere = [usageRangeClause('30d', 'created_at')];
  const monthBinds = [];
  if (tid) {
    monthWhere.push('tenant_id = ?');
    monthBinds.push(tid);
  }
  if (wid) {
    monthWhere.push('workspace_id = ?');
    monthBinds.push(wid);
  }
  const monthlyCostRow = await d1First(
    db,
    'cost_month',
    `SELECT COALESCE(SUM(cost_usd), 0) AS c
     FROM agentsam_usage_events
     WHERE ${monthWhere.join(' AND ')}`,
    monthBinds,
    ctx,
  );
  const monthlyCost = Number(monthlyCostRow?.c ?? 0) || 0;

  let routingCostSupabase = null;
  if (hyperdriveReady) {
    const rc = await supabaseQuery(
      env,
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS s
       FROM agentsam.agentsam_routing_decisions
       WHERE ($1::text IS NULL OR tenant_id = $1)
         AND created_at >= now() - ${pgRangeInterval(range)}`,
      [tid],
    );
    if (rc.ok) routingCostSupabase = Number(rc.rows?.[0]?.s ?? 0) || 0;
    else if (rc.warning) {
      warnings.push({
        code: 'ROUTING_DECISIONS_COST_SUM_SKIPPED',
        message: String(rc.warning).slice(0, 500),
        backend: 'supabase',
        severity: 'info',
      });
    }
  }

  const [codebasePack, ragPack] = await Promise.all([
    loadSubJson(request, url, env, '/api/analytics/codebase', range, tid),
    loadSubJson(request, url, env, '/api/analytics/rag', range, tid),
  ]);

  let deployments = { state: 'BLOCKED', rows: [], reason: 'No deployment query', nextStep: 'Wire build_deploy_events or D1 deployments' };
  if (hyperdriveReady) {
    const dep = await supabaseQuery(
      env,
      `SELECT id, status, created_at, event_type, metadata
       FROM public.build_deploy_events
       WHERE ($1::text IS NULL OR tenant_id = $1)
       ORDER BY created_at DESC NULLS LAST
       LIMIT 20`,
      [tid],
    );
    if (dep.ok) {
      deployments = {
        state: dep.rows?.length ? 'LIVE' : 'EMPTY',
        backend: 'supabase',
        table: 'build_deploy_events',
        rows: dep.rows || [],
      };
      if (dep.rows?.length) markLive('Supabase build_deploy_events');
      else markEmpty('Supabase build_deploy_events');
    } else {
      const alt = await supabaseQuery(
        env,
        `SELECT id, status, created_at FROM public.cicd_github_runs ORDER BY created_at DESC NULLS LAST LIMIT 15`,
        [],
      );
      if (alt.ok) {
        deployments = {
          state: alt.rows?.length ? 'LIVE' : 'EMPTY',
          backend: 'supabase',
          table: 'cicd_github_runs',
          rows: alt.rows || [],
        };
      } else {
        deployments = {
          state: 'BLOCKED',
          reason: dep.warning || 'build_deploy_events query failed',
          nextStep: 'Verify Hyperdrive role and table public.build_deploy_events',
        };
      }
    }
  } else if (await tableExists(db, 'deployments')) {
    const dr = await d1All(
      db,
      'deploy_d1',
      `SELECT id, status, timestamp FROM deployments ORDER BY timestamp DESC LIMIT 15`,
      [],
      ctx,
    );
    deployments = {
      state: dr.length ? 'LIVE' : 'EMPTY',
      backend: 'd1',
      table: 'deployments',
      rows: dr,
    };
  }

  const okTouches = ctx.sourceStatus.live.length + ctx.sourceStatus.empty.length;
  const badTouches = ctx.sourceStatus.blocked.length + ctx.sourceStatus.errors.length;
  const allTouches = okTouches + badTouches;

  const kpis = {
    workflowRuns: kpi(
      {
        total: Number(wfRunAgg?.total ?? 0) || 0,
        completed: Number(wfRunAgg?.completed ?? 0) || 0,
        failed: Number(wfRunAgg?.failed ?? 0) || 0,
        running: Number(wfRunAgg?.running ?? 0) || 0,
        by_status: wfStatusRows,
      },
      ['agentsam_workflow_runs'],
      range,
      true,
      null,
      { sparkline: wfSpark.map((r) => Number(r.c ?? 0) || 0) },
    ),
    evalPassRate: kpi(
      {
        pass_rate_percent: evalPassRate,
        passed: evalPassed,
        total: evalTotal,
        source: evalSource,
      },
      [evalSource.includes('Supabase') ? 'agentsam_eval_runs (Supabase)' : 'agentsam_eval_runs (D1)'],
      range,
      supabaseEvalProbeOk || d1HasEvalTable,
      evalTotal === 0 && (supabaseEvalProbeOk || d1HasEvalTable)
        ? 'No eval rows in window (sources reachable)'
        : null,
    ),
    toolSuccess: kpi(
      {
        success_rate_percent: toolSuccessKpi,
        calls: toolCallsKpi,
        source_table: toolSourceKpi,
      },
      [toolSourceKpi],
      range,
      toolCallsKpi > 0,
      toolSuccessWarning,
    ),
    openErrors: kpi(
      { count: openErr, source_table: errTableUsed },
      [errTableUsed],
      range,
      true,
      null,
    ),
    tokenUsage: kpi(
      {
        total: totalTokens,
        input: tokensIn,
        output: tokensOut,
        monthly_hint: null,
      },
      ['agentsam_usage_events', 'agentsam_workflow_runs'],
      range,
      totalTokens > 0,
      costWarning && totalTokens <= 0 ? costWarning : null,
      { sparkline: tokenSpark },
    ),
    aiCost: kpi(
      {
        period_usd: totalCost,
        monthly_30d_usd: monthlyCost,
        routing_decisions_usd: routingCostSupabase,
      },
      ['agentsam_usage_events', 'agentsam_workflow_runs', 'agentsam_routing_decisions (Supabase)'],
      range,
      totalCost > 0 || monthlyCost > 0 || (routingCostSupabase ?? 0) > 0,
      costWarning,
    ),
    avgLatency: kpi(
      {
        avg_ms: avgMs,
        p95_ms: p95,
        latest_model_latency_ms: latestUsageLat?.duration_ms != null ? Number(latestUsageLat.duration_ms) : null,
        latest_model: latestUsageLat?.model ?? null,
        latest_provider: latestUsageLat?.provider ?? null,
      },
      ['agentsam_execution_performance_metrics', 'agentsam_workflow_runs', 'agentsam_usage_events'],
      range,
      avgMs > 0 || (latestUsageLat?.duration_ms ?? 0) > 0,
      avgMs <= 0 && !(latestUsageLat?.duration_ms > 0) ? 'No latency samples in window' : null,
    ),
    dataHealth: kpi(
      {
        live_sources: ctx.sourceStatus.live.length,
        empty_sources: ctx.sourceStatus.empty.length,
        blocked_sources: ctx.sourceStatus.blocked.length,
        errors: ctx.sourceStatus.errors.length,
        score: allTouches ? `${okTouches}/${allTouches}` : '0/0',
      },
      ['/api/analytics/source-health', 'D1', 'Supabase'],
      range,
      true,
      ctx.sourceStatus.blocked.length ? 'Some sources blocked — see sourceStatus.blocked' : null,
    ),
  };

  const summary = {
    workflow_run_count: kpis.workflowRuns.value.total,
    workflow_status: kpis.workflowRuns.value,
    tool_success_rate: toolSuccess,
    open_error_count: openErr,
    total_tokens: totalTokens,
    total_cost_usd: totalCost,
    avg_latency_ms: avgMs,
    eval_pass_rate: evalPassRate,
    eval_runs: evalTotal,
    rag_document_count: ragPack.json?.summary?.document_count,
    codebase_file_count: codebasePack.json?.summary?.file_count,
    monthly_cost_usd: monthlyCost,
    waterfall_run_id: waterfallRunId,
    latest_run_group_id: waterfallRunRow?.run_group_id ?? latestRun?.run_group_id ?? null,
  };

  const rows = [
    { key: 'workflowRuns', backend: 'd1', value: kpis.workflowRuns.value.total, table: 'agentsam_workflow_runs' },
      { key: 'toolSuccess', backend: 'd1', value: toolSuccessKpi, table: toolSourceKpi },
    { key: 'openErrors', backend: 'mixed', value: openErr, table: errTableUsed },
    { key: 'tokenUsage', backend: 'd1', value: totalTokens, table: 'agentsam_usage_events' },
    { key: 'aiCost', backend: 'd1', value: totalCost, table: 'agentsam_usage_events' },
    { key: 'avgLatency', backend: 'd1', value: avgMs, table: 'agentsam_execution_performance_metrics' },
  ];

  return analyticsResponse({
    ok: true,
    backend: hyperdriveReady ? 'mixed' : 'd1',
    range,
    summary,
    rows,
    warnings,
    kpis,
    workflowRunsOverTime: wfTrend,
    latestExecutionWaterfall: {
      workflow_run_id: waterfallRunId,
      run_group_id: waterfallRunRow?.run_group_id ?? latestRun?.run_group_id ?? null,
      steps: latestExecutionWaterfall,
    },
    verifiedTrace,
    errorInbox,
    modelLeaderboard,
    costLatencyScatter: scatterRows,
    tokensOverTime: tokensDaily,
    codebaseOverview: codebasePack.json || { ok: false, blocked: true },
    ragHealth: ragPack.json || { ok: false, blocked: true },
    deployments,
    sourceStatus: ctx.sourceStatus,
    meta: {
      generatedAt: new Date().toISOString(),
      timeRange: range,
      workspaceId: wid,
      tenantId: tid,
    },
  });
}
