import { parseRange, analyticsResponse } from './sources/normalize.js';
import { pragmaTableInfo, tableExists } from '../../../backend/services/retention.js';

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

function depRangeClause(range, col = 'created_at') {
  if (range === '24h') return `${col} >= unixepoch('now', '-24 hours')`;
  if (range === '30d') return `${col} >= unixepoch('now', '-30 days')`;
  if (range === 'all') return `${col} >= unixepoch('now', '-3650 days')`;
  return `${col} >= unixepoch('now', '-7 days')`;
}

function wfRangeClause(range) {
  if (range === '24h') return `started_at >= unixepoch('now', '-24 hours')`;
  if (range === '30d') return `started_at >= unixepoch('now', '-30 days')`;
  if (range === 'all') return `started_at >= unixepoch('now', '-3650 days')`;
  return `started_at >= unixepoch('now', '-7 days')`;
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

function truncateJsonField(v, max = 1200) {
  if (v == null) return null;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function stepRowIsFailed(st) {
  const s = String(st?.status || '').toLowerCase();
  return s === 'failed' || s === 'timeout' || s === 'timed_out';
}

/**
 * GET /api/analytics/agent/runs
 * Query: range, limit (default 40, max 200), run_id (detail for one run).
 */
export async function handleAgentAnalyticsRuns(request, url, env, { tenantId, workspaceId, userId }) {
  void request;
  const range = parseRange(url);
  const warnings = [];
  const db = env?.DB || null;
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;
  const wid = workspaceId && String(workspaceId).trim() ? String(workspaceId).trim() : null;
  const uid = userId && String(userId).trim() ? String(userId).trim() : null;
  const runId = (url.searchParams.get('run_id') || '').trim() || null;
  let limit = Number(url.searchParams.get('limit') || 40) || 40;
  if (limit < 1) limit = 1;
  if (limit > 200) limit = 200;

  if (!db) {
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: { state: 'EMPTY', detail: false },
      rows: [],
      warnings: [
        {
          code: 'D1_BINDING_MISSING',
          message: 'env.DB missing; workflow runs unavailable.',
          severity: 'warn',
        },
      ],
    });
  }

  if (!(await tableExists(db, 'agentsam_workflow_runs'))) {
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: { state: 'EMPTY', detail: false, reason: 'no_agentsam_workflow_runs_table' },
      rows: [],
      warnings,
    });
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
  if (uid) {
    wfWhere.push('user_id = ?');
    wfBinds.push(uid);
  }
  const wfWhereSql = wfWhere.join(' AND ');

  if (!runId) {
    const statusAgg = await d1All(
      db,
      'runs_status',
      `SELECT status, COUNT(*) AS c FROM agentsam_workflow_runs WHERE ${wfWhereSql} GROUP BY status`,
      wfBinds,
      warnings,
    );
    const rows = await d1All(
      db,
      'runs_list',
      `SELECT id, workflow_id, workflow_key, display_name, tenant_id, workspace_id, status,
              trigger_type, environment, model_used, started_at, completed_at, duration_ms,
              input_tokens, output_tokens, cost_usd, error_message, current_node_key,
              steps_completed, steps_total, supabase_sync_status
       FROM agentsam_workflow_runs
       WHERE ${wfWhereSql}
       ORDER BY started_at DESC
       LIMIT ${limit}`,
      wfBinds,
      warnings,
    );
    const total = statusAgg.reduce((a, r) => a + (Number(r.c) || 0), 0);
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: {
        state: total ? 'LIVE' : 'EMPTY',
        detail: false,
        run_count: total,
        by_status: Object.fromEntries(statusAgg.map((r) => [String(r.status || 'unknown'), Number(r.c) || 0])),
      },
      rows,
      warnings,
    });
  }

  const runBinds = [runId];
  let runSql = `SELECT * FROM agentsam_workflow_runs WHERE id = ?`;
  if (wid) {
    runSql += ` AND workspace_id = ?`;
    runBinds.push(wid);
  }
  if (uid) {
    runSql += ` AND user_id = ?`;
    runBinds.push(uid);
  }
  if (tid) {
    runSql += ` AND tenant_id = ?`;
    runBinds.push(tid);
  }
  runSql += ` LIMIT 1`;
  const run = await d1First(db, 'run_one', runSql, runBinds, warnings);
  if (!run) {
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: { state: 'NOT_FOUND', detail: true, run_id: runId },
      rows: [],
      warnings: [
        {
          code: 'RUN_NOT_FOUND',
          message: `No workflow run ${runId}`,
          severity: 'info',
        },
      ],
    });
  }
  if (tid && run.tenant_id && String(run.tenant_id) !== tid) {
    warnings.push({
      code: 'RUN_TENANT_MISMATCH',
      message: `Run tenant ${run.tenant_id} does not match request tenant ${tid}.`,
      severity: 'warn',
    });
  }

  let steps = [];
  if (await tableExists(db, 'agentsam_execution_steps')) {
    steps = await d1All(
      db,
      'run_steps',
      `SELECT id, execution_id, node_key, node_type, status, latency_ms, tokens_in, tokens_out, cost_usd,
              started_at, completed_at, created_at_unix AS created_at, attempt, edge_taken,
              substr(COALESCE(error_json,''),1,800) AS error_json_preview,
              substr(COALESCE(output_json,''),1,400) AS output_json_preview
       FROM agentsam_execution_steps
       WHERE workflow_run_id = ?
       ORDER BY created_at_unix ASC, id ASC`,
      [runId],
      warnings,
    );
  }

  const wfJson = waterfallFromStepResultsJson(run.step_results_json);
  let waterfall = wfJson;
  if (!waterfall?.length && steps.length) {
    const lat = steps.map((s) => Number(s.latency_ms) || 0);
    const maxLat = Math.max(1, ...lat);
    waterfall = steps.map((s) => ({
      node_key: s.node_key,
      status: s.status,
      latency_ms: Number(s.latency_ms) || 0,
      tokens_in: Number(s.tokens_in) || 0,
      tokens_out: Number(s.tokens_out) || 0,
      cost_usd: Number(s.cost_usd) || 0,
      bar: maxLat ? (Number(s.latency_ms) || 0) / maxLat : 0,
    }));
  }

  const failurePath = [];
  for (const s of steps) {
    if (stepRowIsFailed(s)) {
      failurePath.push({
        id: s.id,
        node_key: s.node_key,
        status: s.status,
        error_json_preview: s.error_json_preview,
      });
    }
  }
  if (!failurePath.length && String(run.status || '').toLowerCase() === 'failed') {
    failurePath.push({
      id: run.id,
      node_key: run.current_node_key || null,
      status: run.status,
      error_json_preview: truncateJsonField(run.error_message, 800),
    });
  }

  const commandRuns = [];
  const crCols = await pragmaTableInfo(db, 'agentsam_command_run');

  const toolLedger = steps.map((s) => ({
    step_id: s.id,
    node_key: s.node_key,
    node_type: s.node_type,
    status: s.status,
    latency_ms: s.latency_ms,
    preview: s.output_json_preview,
  }));

  const safeRun = { ...run };
  if (safeRun.step_results_json != null) {
    safeRun.step_results_json = truncateJsonField(safeRun.step_results_json, 4000);
  }
  if (safeRun.input_json != null) safeRun.input_json = truncateJsonField(safeRun.input_json, 2000);
  if (safeRun.output_json != null) safeRun.output_json = truncateJsonField(safeRun.output_json, 2000);
  if (safeRun.metadata_json != null) safeRun.metadata_json = truncateJsonField(safeRun.metadata_json, 2000);

  const hasExecSteps = await tableExists(db, 'agentsam_execution_steps');
  const hasExecutions = await tableExists(db, 'agentsam_executions');
  const hasCommandRun = crCols.size > 0;

  return analyticsResponse({
    ok: true,
    backend: 'd1',
    range,
    summary: {
      state: 'LIVE',
      detail: true,
      run: safeRun,
      step_count: steps.length,
      failure_step_count: failurePath.length,
    },
    rows: steps,
    waterfall: waterfall || [],
    failurePath,
    commandRuns,
    toolLedger,
    verifiedTrace: {
      agentsam_execution_steps: hasExecSteps,
      agentsam_executions: hasExecutions,
      agentsam_command_run: hasCommandRun,
    },
    warnings,
  });
}

/**
 * GET /api/analytics/agent/graph — workflow nodes + edges (D1).
 * Optional: ?workflow_id= — otherwise picks the active workflow with the most nodes in tenant scope.
 */
export async function handleAgentAnalyticsGraph(request, url, env, { tenantId, workspaceId }) {
  void request;
  const range = parseRange(url);
  const warnings = [];
  const db = env?.DB || null;
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;
  const wid = workspaceId && String(workspaceId).trim() ? String(workspaceId).trim() : null;
  const workflowIdParam = (url.searchParams.get('workflow_id') || '').trim() || null;

  if (!db) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[analytics.agent.graph] no D1 binding on env (expected DB in production)');
    }
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: { state: 'EMPTY', workflow: null, nodes: [], edges: [], node_count: 0, edge_count: 0 },
      rows: [],
      warnings,
    });
  }

  const wfMetaCols = await pragmaTableInfo(db, 'agentsam_workflows');
  const hasNodes = await tableExists(db, 'agentsam_workflow_nodes');
  const hasEdges = await tableExists(db, 'agentsam_workflow_edges');
  if (!hasNodes || !hasEdges) {
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: { state: 'EMPTY', workflow: null, nodes: [], edges: [], node_count: 0, edge_count: 0 },
      rows: [],
      warnings,
    });
  }

  const wfWhere = [`COALESCE(w.is_active, 1) = 1`];
  const wfBinds = [];
  if (tid && wfMetaCols.has('tenant_id')) {
    if (wfMetaCols.has('is_platform_global')) {
      wfWhere.push(`(w.tenant_id = ? OR COALESCE(w.is_platform_global, 0) = 1)`);
      wfBinds.push(tid);
    } else {
      wfWhere.push(`(w.tenant_id = ? OR w.tenant_id IS NULL)`);
      wfBinds.push(tid);
    }
  }
  if (wid && wfMetaCols.has('workspace_id')) {
    wfWhere.push(`(w.workspace_id = ? OR w.workspace_id IS NULL)`);
    wfBinds.push(wid);
  }
  const wfWhereSql = wfWhere.join(' AND ');

  let selectedId = workflowIdParam;
  if (!selectedId) {
    const pick = await d1First(
      db,
      'graph_pick',
      `SELECT w.id AS workflow_id
       FROM agentsam_workflows w
       LEFT JOIN agentsam_workflow_nodes n ON n.workflow_id = w.id AND COALESCE(n.is_active, 1) = 1
       WHERE ${wfWhereSql}
       GROUP BY w.id
       ORDER BY COUNT(DISTINCT n.id) DESC, w.display_name ASC
       LIMIT 1`,
      wfBinds,
      warnings,
    );
    selectedId = pick?.workflow_id ? String(pick.workflow_id) : null;
  }

  if (!selectedId) {
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: {
        state: 'EMPTY',
        workflow: null,
        nodes: [],
        edges: [],
        meta: { tenantId: tid, workspaceId: wid, requestedWorkflowId: workflowIdParam },
      },
      rows: [],
      warnings,
    });
  }

  const workflow = await d1First(
    db,
    'graph_wf',
    `SELECT * FROM agentsam_workflows WHERE id = ? LIMIT 1`,
    [selectedId],
    warnings,
  );

  const nodes = await d1All(
    db,
    'graph_nodes',
    `SELECT * FROM agentsam_workflow_nodes
     WHERE workflow_id = ? AND COALESCE(is_active, 1) = 1
     ORDER BY sort_order ASC, node_key ASC`,
    [selectedId],
    warnings,
  );

  const edges = await d1All(
    db,
    'graph_edges',
    `SELECT * FROM agentsam_workflow_edges
     WHERE workflow_id = ?
     ORDER BY priority ASC, from_node_key ASC, to_node_key ASC`,
    [selectedId],
    warnings,
  );

  const rowEdges = edges.map((e) => ({
    from: e.from_node_key,
    to: e.to_node_key,
    condition_type: e.condition_type,
    priority: e.priority,
    label: e.label,
  }));

  return analyticsResponse({
    ok: true,
    backend: 'd1',
    range,
    summary: {
      state: 'LIVE',
      workflow: workflow || { id: selectedId },
      nodes,
      edges,
      node_count: nodes.length,
      edge_count: edges.length,
      meta: { tenantId: tid, workspaceId: wid },
    },
    rows: rowEdges,
    warnings,
  });
}

/**
 * GET /api/analytics/agent/dependencies — agentsam_execution_dependency_graph (D1).
 */
export async function handleAgentAnalyticsDependencies(request, url, env, { tenantId, workspaceId }) {
  void request;
  const range = parseRange(url);
  const warnings = [];
  const db = env?.DB || null;
  const tid = tenantId && String(tenantId).trim() ? String(tenantId).trim() : null;
  const wid = workspaceId && String(workspaceId).trim() ? String(workspaceId).trim() : null;

  if (!db) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[analytics.agent.dependencies] no D1 binding on env (expected DB in production)');
    }
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: { state: 'EMPTY', row_count: 0 },
      rows: [],
      warnings,
    });
  }

  if (!(await tableExists(db, 'agentsam_execution_dependency_graph'))) {
    return analyticsResponse({
      ok: true,
      backend: 'd1',
      range,
      summary: { state: 'EMPTY', row_count: 0 },
      rows: [],
      warnings,
    });
  }

  const depCols = await pragmaTableInfo(db, 'agentsam_execution_dependency_graph');
  const timeCol = depCols.has('created_at') ? 'created_at' : null;
  const where = [];
  const binds = [];
  if (timeCol) {
    where.push(depRangeClause(range, timeCol));
  } else {
    where.push('1=1');
  }
  if (tid && depCols.has('tenant_id')) {
    where.push('tenant_id = ?');
    binds.push(tid);
  }
  if (wid && depCols.has('workspace_id')) {
    where.push('workspace_id = ?');
    binds.push(wid);
  }
  const whereSql = where.join(' AND ');

  const rows = await d1All(
    db,
    'dep_graph',
    `SELECT * FROM agentsam_execution_dependency_graph
     WHERE ${whereSql}
     ORDER BY rowid DESC
     LIMIT 200`,
    binds,
    warnings,
  );

  return analyticsResponse({
    ok: true,
    backend: 'd1',
    range,
    summary: {
      state: rows.length ? 'LIVE' : 'EMPTY',
      row_count: rows.length,
      meta: { tenantId: tid, workspaceId: wid },
    },
    rows,
    warnings,
  });
}
