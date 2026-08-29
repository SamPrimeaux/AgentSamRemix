/**
 * Daily retention: rollup tables + hot-log purge + optional Supabase warehouse offload.
 * Uses PRAGMA table_info before writes — column names are never guessed.
 */

import { decayRoutingArms, updateArmsFromMetrics } from '../agentsam/runtime/routing/thompson.js';
import { startCronRun, completeCronRun, failCronRun } from '../jobs/cron-run-ledger.js';

const DEFAULT_TENANT = 'system';
const ETO_TABLE = 'agentsam_performance_eto_events';

/** @param {import('@cloudflare/workers-types').D1Database} db */
export async function pragmaTableInfo(db, tableName) {
  const safe = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(tableName || '')) ? String(tableName) : '';
  if (!safe || !db) return new Set();
  // PRAGMA table_info is blocked on some D1 binding paths (MCP tool lane, restricted SELECT).
  // Fall back to sqlite_master column parse which is always allowed.
  try {
    const { results } = await db.prepare(`PRAGMA table_info(${safe})`).all();
    if (results && results.length > 0) {
      return new Set(results.map((r) => String(r.name || '').toLowerCase()));
    }
  } catch {
    // PRAGMA blocked — fall through to sqlite_master
  }
  try {
    const row = await db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`
    ).bind(safe).first();
    if (!row?.sql) return new Set();
    // Parse column names from CREATE TABLE statement
    const inner = row.sql.replace(/^[^(]+\(/, '').replace(/\)[^)]*$/, '');
    const cols = new Set();
    for (const part of inner.split(',')) {
      const colName = part.trim().split(/\s+/)[0].replace(/["`[\]]/g, '').toLowerCase();
      if (colName && colName !== 'primary' && colName !== 'foreign' && colName !== 'unique' && colName !== 'check') {
        cols.add(colName);
      }
    }
    return cols;
  } catch {
    return new Set();
  }
}

export async function tableExists(db, tableName) {
  const cols = await pragmaTableInfo(db, tableName);
  return cols.size > 0;
}

async function isEtoThompsonOwner(env) {
  return Boolean(env?.DB && (await tableExists(env.DB, ETO_TABLE)));
}

/**
 * Declared column type affinity — needed because pragmaTableInfo() only returns names.
 * A purge that guesses INTEGER-epoch vs TEXT-datetime from the column *name* alone
 * (e.g. assuming every `created_at` is unixepoch) silently no-ops on TEXT columns,
 * since SQLite type affinity always sorts TEXT greater than INTEGER/REAL.
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} tableName
 * @param {string} columnName
 * @returns {Promise<string|null>} uppercased declared type, or null if unknown
 */
export async function columnTypeAffinity(db, tableName, columnName) {
  const safe = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(tableName || '')) ? String(tableName) : '';
  const col = columnName != null ? String(columnName).toLowerCase() : '';
  if (!safe || !db || !col) return null;
  try {
    const { results } = await db.prepare(`PRAGMA table_info(${safe})`).all();
    const match = (results || []).find((r) => String(r.name || '').toLowerCase() === col);
    return match?.type ? String(match.type).toUpperCase() : null;
  } catch {
    return null;
  }
}

function pickDateColumn(cols, preferences) {
  for (const p of preferences) {
    if (cols.has(p)) return p;
  }
  return null;
}

/**
 * Decide purge compare mode from declared affinity + column name.
 * Unknown affinity defaults to datetime for non-_unix names so TEXT ISO columns
 * never silently no-op under a unixepoch() compare (ETO class bug).
 * @param {string|null|undefined} declaredType
 * @param {string} columnName
 * @returns {'date'|'unixepoch'|'datetime'}
 */
export function choosePurgeCompare(declaredType, columnName) {
  const col = String(columnName || '').toLowerCase();
  if (col === 'date') return 'date';
  if (col.endsWith('_unix')) return 'unixepoch';
  const typ = declaredType != null ? String(declaredType).toUpperCase() : '';
  if (typ && /INT/.test(typ)) return 'unixepoch';
  if (typ) return 'datetime';
  // Affinity unknown: *_unix handled above; started_at/occurred_at/timestamp are
  // integer in this schema; everything else prefer datetime (safe for TEXT ISO).
  if (col === 'started_at' || col === 'occurred_at' || col === 'timestamp') {
    return 'unixepoch';
  }
  return 'datetime';
}

/**
 * Sunday-start week for an INTEGER unixepoch seconds column (Law 2).
 * @param {string} unixCol
 */
export function sqlSundayWeekStartUnix(unixCol = 'created_at_unix') {
  const c = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(unixCol || ''))
    ? String(unixCol)
    : 'created_at_unix';
  return `date(${c}, 'unixepoch', '-' || strftime('%w', ${c}, 'unixepoch') || ' days')`;
}

/** Current week start (Sunday, UTC) as a SQLite date() expression. */
export function sqlCurrentSundayWeekStart() {
  return `date('now', '-' || strftime('%w', 'now') || ' days')`;
}

async function ensureAgentsamUsageRollupsDaily(db) {
  if (await tableExists(db, 'agentsam_usage_rollups_daily')) return true;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS agentsam_usage_rollups_daily (
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        day TEXT NOT NULL,
        ai_calls INTEGER DEFAULT 0,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        tool_calls INTEGER DEFAULT 0,
        tool_successes INTEGER DEFAULT 0,
        tool_failures INTEGER DEFAULT 0,
        mcp_calls INTEGER DEFAULT 0,
        deployments INTEGER DEFAULT 0,
        webhook_events INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        provider_breakdown_json TEXT,
        top_tools_json TEXT,
        rollup_source TEXT,
        rolled_up_at INTEGER,
        PRIMARY KEY (tenant_id, workspace_id, day)
      )
    `).run();
    return true;
  } catch {
    return false;
  }
}

export async function rollupAgentsamUsageDaily(env) {
  if (!env?.DB) return { ok: false, skipped: true, reason: 'no_db' };
  await ensureAgentsamUsageRollupsDaily(env.DB);

  const telCols = await pragmaTableInfo(env.DB, 'agentsam_usage_events');
  if (!telCols.has('created_at')) {
    return { ok: false, skipped: true, reason: 'agentsam_usage_events_missing_created_at' };
  }

  const costExpr = telCols.has('cost_usd') ? 'SUM(COALESCE(t.cost_usd,0))' : '0';
  const wsExpr = telCols.has('workspace_id')
    ? "COALESCE(t.workspace_id, 'default')"
    : "'default'";
  const tenantGroup = telCols.has('tenant_id')
    ? `COALESCE(t.tenant_id, '${DEFAULT_TENANT}')`
    : `'${DEFAULT_TENANT}'`;

  const toolCols = await pragmaTableInfo(env.DB, 'agentsam_tool_call_log');
  const toolTsCol = toolCols.has('created_at_unix')
    ? 'created_at_unix'
    : toolCols.has('created_at')
      ? 'created_at'
      : null;
  const toolDay = toolTsCol
    ? `date(datetime(${toolTsCol}, 'unixepoch')) = date('now','-1 day')`
    : '1=0';
  const succExpr = toolCols.has('status')
    ? `(LOWER(COALESCE(status,'')) IN ('success','ok','completed'))`
    : null;

  const depCols = await pragmaTableInfo(env.DB, 'deployments');
  const depDay =
    depCols.has('created_at')
      ? `date(datetime(created_at, 'unixepoch')) = date('now','-1 day')`
      : '1=0';

  const whCols = await pragmaTableInfo(env.DB, 'agentsam_webhook_events');
  const whCol = pickDateColumn(whCols, ['received_at_unix', 'processed_at_unix']);
  const whDay = whCol
    ? `date(datetime(${whCol}, 'unixepoch')) = date('now','-1 day')`
    : '1=0';

  const errCols = await pragmaTableInfo(env.DB, 'worker_analytics_errors');
  const errDay =
    errCols.has('created_at')
      ? `date(datetime(created_at, 'unixepoch')) = date('now','-1 day')`
      : '1=0';

  const tenantMatch = telCols.has('tenant_id')
    ? `COALESCE(t2.tenant_id, '${DEFAULT_TENANT}') = COALESCE(t.tenant_id, '${DEFAULT_TENANT}')`
    : '1=1';
  const wsMatch = telCols.has('workspace_id')
    ? `COALESCE(t2.workspace_id, 'default') = COALESCE(t.workspace_id, 'default')`
    : '1=1';

  const providerBreakdownExpr = `
    COALESCE(
      (SELECT json_group_object(prov, breakdown_obj)
       FROM (
         SELECT
           CASE
             WHEN LOWER(COALESCE(NULLIF(TRIM(t2.provider), ''), 'unknown')) IN ('workers_ai', 'cloudflare')
               THEN 'cloudflare_workers_ai'
             WHEN LOWER(COALESCE(NULLIF(TRIM(t2.provider), ''), 'unknown')) = 'unknown'
               THEN NULL
             ELSE LOWER(COALESCE(NULLIF(TRIM(t2.provider), ''), 'unknown'))
           END AS prov,
           json_object(
             'requests', COUNT(*),
             'tokens_in', SUM(COALESCE(t2.tokens_in, 0)),
             'tokens_out', SUM(COALESCE(t2.tokens_out, 0)),
             'cost_usd', SUM(COALESCE(t2.cost_usd, 0))
           ) AS breakdown_obj
         FROM agentsam_usage_events t2
         WHERE date(datetime(t2.created_at, 'unixepoch')) = date('now','-1 day')
           AND ${tenantMatch}
           AND ${wsMatch}
         GROUP BY prov
         HAVING prov IS NOT NULL
       )),
      '{}'
    )`;

  const sql = `
    INSERT INTO agentsam_usage_rollups_daily (
      tenant_id, workspace_id, day, ai_calls, tokens_in, tokens_out, cost_usd,
      tool_calls, tool_successes, tool_failures, mcp_calls, deployments,
      webhook_events, error_count, provider_breakdown_json, top_tools_json, rollup_source, rolled_up_at
    )
    SELECT
      ${tenantGroup} AS tenant_id,
      ${wsExpr} AS workspace_id,
      date('now','-1 day') AS day,
      COUNT(*) AS ai_calls,
      SUM(COALESCE(t.tokens_in,0)) AS tokens_in,
      SUM(COALESCE(t.tokens_out,0)) AS tokens_out,
      ${costExpr} AS cost_usd,
      (SELECT COUNT(*) FROM agentsam_tool_call_log WHERE ${toolDay}) AS tool_calls,
      (SELECT ${succExpr ? `COUNT(*) FROM agentsam_tool_call_log WHERE ${toolDay} AND ${succExpr}` : '0'}) AS tool_successes,
      (SELECT ${succExpr ? `COUNT(*) FROM agentsam_tool_call_log WHERE ${toolDay} AND NOT (${succExpr})` : '0'}) AS tool_failures,
      (SELECT COUNT(*) FROM agentsam_tool_call_log WHERE ${toolDay} AND COALESCE(tool_category,'') = 'mcp') AS mcp_calls,
      (SELECT COUNT(*) FROM deployments WHERE ${depDay}) AS deployments,
      (SELECT COUNT(*) FROM agentsam_webhook_events WHERE ${whDay}) AS webhook_events,
      (SELECT COUNT(*) FROM worker_analytics_errors WHERE ${errDay}) AS error_count,
      ${providerBreakdownExpr} AS provider_breakdown_json,
      '[]' AS top_tools_json,
      'nightly_cron' AS rollup_source,
      unixepoch() AS rolled_up_at
    FROM agentsam_usage_events t
    WHERE date(datetime(t.created_at, 'unixepoch')) = date('now','-1 day')
    GROUP BY ${tenantGroup}, ${wsExpr}
    ON CONFLICT(tenant_id, workspace_id, day) DO UPDATE SET
      ai_calls = excluded.ai_calls,
      tokens_in = excluded.tokens_in,
      tokens_out = excluded.tokens_out,
      cost_usd = excluded.cost_usd,
      tool_calls = excluded.tool_calls,
      tool_successes = excluded.tool_successes,
      tool_failures = excluded.tool_failures,
      mcp_calls = excluded.mcp_calls,
      deployments = excluded.deployments,
      webhook_events = excluded.webhook_events,
      error_count = excluded.error_count,
      provider_breakdown_json = excluded.provider_breakdown_json,
      top_tools_json = excluded.top_tools_json,
      rollup_source = excluded.rollup_source,
      rolled_up_at = excluded.rolled_up_at
  `;

  try {
    const r = await env.DB.prepare(sql).run();
    let breakdownRepair = { repaired: 0 };
    try {
      const { repairRollupProviderBreakdowns } = await import('../telemetry/usage-rollups.js');
      breakdownRepair = await repairRollupProviderBreakdowns(env.DB, { daysBack: 35 });
    } catch (repairErr) {
      console.warn('[rollupAgentsamUsageDaily] breakdown repair failed', repairErr?.message || repairErr);
    }
    const topToolsPatch = await patchDailyTopToolsJson(env);
    return {
      ok: true,
      changes: r.meta?.changes ?? r.changes ?? 0,
      breakdown_repair: breakdownRepair,
      top_tools_patched: topToolsPatch?.patched ?? 0,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Snapshot per-workspace top tools into agentsam_usage_rollups_daily before 24h tool log purge. */
export async function patchDailyTopToolsJson(env) {
  if (!env?.DB) return { patched: 0 };
  const toolCols = await pragmaTableInfo(env.DB, 'agentsam_tool_call_log');
  const rollCols = await pragmaTableInfo(env.DB, 'agentsam_usage_rollups_daily');
  const toolCol = toolCols.has('tool_key')
    ? 'tool_key'
    : toolCols.has('tool_name')
      ? 'tool_name'
      : null;
  const tsCol = toolCols.has('created_at_unix')
    ? 'created_at_unix'
    : toolCols.has('created_at')
      ? 'created_at'
      : null;
  if (!toolCol || !tsCol || !rollCols.has('top_tools_json')) {
    return { patched: 0, skipped: true };
  }

  const wsExpr = toolCols.has('workspace_id')
    ? `COALESCE(NULLIF(trim(workspace_id), ''), 'default')`
    : `'default'`;
  const tenantExpr = toolCols.has('tenant_id')
    ? `COALESCE(NULLIF(trim(tenant_id), ''), '${DEFAULT_TENANT}')`
    : `'${DEFAULT_TENANT}'`;
  const toolDay = `date(datetime(${tsCol}, 'unixepoch')) = date('now','-1 day')`;
  const toolExpr = `COALESCE(NULLIF(trim(${toolCol}), ''), 'unknown')`;

  const { results = [] } = await env.DB.prepare(
    `SELECT ${tenantExpr} AS tenant_id, ${wsExpr} AS workspace_id, ${toolExpr} AS tool_name, COUNT(*) AS c
     FROM agentsam_tool_call_log
     WHERE ${toolDay} AND ${toolExpr} != 'unknown'
     GROUP BY ${tenantExpr}, ${wsExpr}, ${toolExpr}
     ORDER BY c DESC`,
  )
    .all()
    .catch(() => ({ results: [] }));

  const byWs = new Map();
  for (const row of results) {
    const tenantId = String(row.tenant_id || DEFAULT_TENANT);
    const workspaceId = String(row.workspace_id || 'default');
    const key = `${tenantId}\0${workspaceId}`;
    if (!byWs.has(key)) byWs.set(key, []);
    const arr = byWs.get(key);
    if (arr.length < 5) arr.push({ tool: String(row.tool_name), count: Number(row.c) || 0 });
  }

  let patched = 0;
  for (const [key, tools] of byWs) {
    const [tenantId, workspaceId] = key.split('\0');
    const topJson = JSON.stringify(tools);
    const ur = await env.DB.prepare(
      `UPDATE agentsam_usage_rollups_daily
       SET top_tools_json = ?
       WHERE tenant_id = ? AND workspace_id = ? AND day = date('now','-1 day')`,
    )
      .bind(topJson, tenantId, workspaceId)
      .run()
      .catch(() => null);
    patched += Number(ur?.meta?.changes ?? ur?.changes ?? 0) || 0;
  }
  return { patched };
}

export async function rollupMcpToolCallStats(env) {
  // Disabled: agentsam_mcp_tool_execution must not write agentsam_tool_stats_compacted.
  // Preferred source is agentsam_tool_call_log via rollupToolCallLogDaily /
  // compactToolCallLogBeforePurge (src/core/tool-call-log-compaction.js).
  return {
    ok: false,
    skipped: true,
    reason: 'retired_mcp_tool_execution_writer',
    preferred_source: 'agentsam_tool_call_log',
  };
}

export async function rollupWorkspaceUsageMetrics(env) {
  if (!env?.DB) return { ok: false, skipped: true };
  const wCols = await pragmaTableInfo(env.DB, 'workspace_usage_metrics');
  if (!wCols.has('workspace_id') || !wCols.has('metric_date')) {
    return { ok: false, skipped: true, reason: 'workspace_usage_metrics_schema' };
  }
  if (!(await tableExists(env.DB, 'agentsam_usage_rollups_daily'))) {
    return { ok: false, skipped: true, reason: 'no_rollups_source' };
  }

  const wfCols = await pragmaTableInfo(env.DB, 'workflow_runs');
  const wfSql =
    wfCols.has('created_at') && wfCols.has('workspace_id')
      ? `(SELECT COUNT(*) FROM workflow_runs wf WHERE date(wf.created_at) = r.day AND wf.workspace_id = r.workspace_id)`
      : wfCols.has('created_at')
        ? `(SELECT COUNT(*) FROM workflow_runs wf WHERE date(wf.created_at) = r.day)`
        : '0';

  const rdCols = await pragmaTableInfo(env.DB, 'routing_decisions');
  const rdSql = rdCols.has('created_at')
    ? `(SELECT COUNT(*) FROM routing_decisions WHERE date(datetime(created_at,'unixepoch')) = r.day)`
    : '0';

  const parts = [
    'INSERT INTO workspace_usage_metrics (',
    [
      'workspace_id',
      'metric_date',
      wCols.has('ai_calls') && 'ai_calls',
      wCols.has('tokens_used') && 'tokens_used',
      wCols.has('cost_estimate_cents') && 'cost_estimate_cents',
      wCols.has('tool_calls') && 'tool_calls',
      wCols.has('workflow_runs') && 'workflow_runs',
      wCols.has('deployments_count') && 'deployments_count',
      wCols.has('mcp_calls') && 'mcp_calls',
      wCols.has('routing_decisions_count') && 'routing_decisions_count',
      wCols.has('top_models_json') && 'top_models_json',
      wCols.has('top_tools_json') && 'top_tools_json',
      wCols.has('rollup_source') && 'rollup_source',
      wCols.has('updated_at') && 'updated_at',
    ]
      .filter(Boolean)
      .join(', '),
    ') SELECT ',
    [
      'r.workspace_id',
      'r.day',
      wCols.has('ai_calls') && 'r.ai_calls',
      wCols.has('tokens_used') && '(r.tokens_in + r.tokens_out)',
      wCols.has('cost_estimate_cents') && 'CAST(r.cost_usd * 100 AS REAL)',
      wCols.has('tool_calls') && 'r.tool_calls',
      wCols.has('workflow_runs') && wfSql,
      wCols.has('deployments_count') && 'r.deployments',
      wCols.has('mcp_calls') && 'r.mcp_calls',
      wCols.has('routing_decisions_count') && rdSql,
      wCols.has('top_models_json') && `'[]'`,
      wCols.has('top_tools_json') && 'r.top_tools_json',
      wCols.has('rollup_source') && `'nightly_cron'`,
      wCols.has('updated_at') && 'unixepoch()',
    ]
      .filter(Boolean)
      .join(', '),
    ` FROM agentsam_usage_rollups_daily r WHERE r.day = date('now','-1 day')`,
    ` ON CONFLICT(workspace_id, metric_date) DO UPDATE SET `,
    [
      wCols.has('ai_calls') && 'ai_calls = excluded.ai_calls',
      wCols.has('tokens_used') && 'tokens_used = excluded.tokens_used',
      wCols.has('cost_estimate_cents') && 'cost_estimate_cents = excluded.cost_estimate_cents',
      wCols.has('tool_calls') && 'tool_calls = excluded.tool_calls',
      wCols.has('workflow_runs') && 'workflow_runs = excluded.workflow_runs',
      wCols.has('deployments_count') && 'deployments_count = excluded.deployments_count',
      wCols.has('mcp_calls') && 'mcp_calls = excluded.mcp_calls',
      wCols.has('routing_decisions_count') && 'routing_decisions_count = excluded.routing_decisions_count',
      wCols.has('top_models_json') && 'top_models_json = excluded.top_models_json',
      wCols.has('top_tools_json') && 'top_tools_json = excluded.top_tools_json',
      wCols.has('rollup_source') && 'rollup_source = excluded.rollup_source',
      wCols.has('updated_at') && 'updated_at = excluded.updated_at',
    ]
      .filter(Boolean)
      .join(', '),
  ].join('');

  try {
    const r = await env.DB.prepare(parts).run();
    return { ok: true, changes: r.meta?.changes ?? r.changes ?? 0 };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function updateModelRoutingRulesFromScores(env) {
  if (!env?.DB) return { ok: false, skipped: true };
  const scores = await pragmaTableInfo(env.DB, 'model_performance_scores');
  const rules = await pragmaTableInfo(env.DB, 'agentsam_routing_arms');
  if (!scores.size || !rules.has('task_type') || !scores.has('task_type')) {
    return { ok: false, skipped: true, reason: 'schema_incomplete' };
  }
  // Arm promotion from model_performance_scores — SQL incomplete; skip until implemented.
  return { ok: false, skipped: true, reason: 'routing_scores_update_not_implemented' };
}

export async function rollupAgentsamHealthDaily(env) {
  if (!env?.DB) return { ok: false, skipped: true };
  const out = await pragmaTableInfo(env.DB, 'agentsam_health_daily');
  if (!out.size) return { ok: false, skipped: true };

  const iam = await pragmaTableInfo(env.DB, 'iam_system_health');
  const iamInsertCols = [
    out.has('tenant_id') && 'tenant_id',
    out.has('day') && 'day',
    out.has('health_status') && 'health_status',
    out.has('snapshot_count') && 'snapshot_count',
    out.has('green_count') && 'green_count',
    out.has('yellow_count') && 'yellow_count',
    out.has('red_count') && 'red_count',
    out.has('worst_status') && 'worst_status',
    out.has('rolled_up_at') && 'rolled_up_at',
  ].filter(Boolean);

  if (
    iam.has('last_checked_at') &&
    iam.has('status') &&
    iamInsertCols.length >= 4 &&
    out.has('tenant_id') &&
    out.has('day')
  ) {
    try {
      const r = await env.DB.prepare(`
        INSERT INTO agentsam_health_daily (
          ${iamInsertCols.join(', ')}
        )
        SELECT
          ${[
            out.has('tenant_id') && `'${DEFAULT_TENANT}'`,
            out.has('day') && `date('now','-1 day')`,
            out.has('health_status') &&
              `CASE
            WHEN SUM(CASE WHEN status='red' THEN 1 ELSE 0 END) > 0 THEN 'red'
            WHEN SUM(CASE WHEN status='yellow' THEN 1 ELSE 0 END) > 2 THEN 'yellow'
            ELSE 'green' END`,
            out.has('snapshot_count') && 'COUNT(*)',
            out.has('green_count') && `SUM(CASE WHEN status='green' THEN 1 ELSE 0 END)`,
            out.has('yellow_count') && `SUM(CASE WHEN status='yellow' THEN 1 ELSE 0 END)`,
            out.has('red_count') && `SUM(CASE WHEN status='red' THEN 1 ELSE 0 END)`,
            out.has('worst_status') && 'MAX(status)',
            out.has('rolled_up_at') && `datetime('now')`,
          ]
            .filter(Boolean)
            .join(', ')}
        FROM iam_system_health
        WHERE date(last_checked_at) = date('now','-1 day')
        ON CONFLICT(tenant_id, day) DO UPDATE SET
          ${[
            out.has('health_status') && 'health_status = excluded.health_status',
            out.has('snapshot_count') && 'snapshot_count = excluded.snapshot_count',
            out.has('green_count') && 'green_count = excluded.green_count',
            out.has('yellow_count') && 'yellow_count = excluded.yellow_count',
            out.has('red_count') && 'red_count = excluded.red_count',
            out.has('worst_status') && 'worst_status = excluded.worst_status',
            out.has('rolled_up_at') && 'rolled_up_at = excluded.rolled_up_at',
          ]
            .filter(Boolean)
            .join(', ')}
      `).run();
      return { ok: true, changes: r.meta?.changes ?? r.changes ?? 0 };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  const snap = await pragmaTableInfo(env.DB, 'system_health_snapshots');
  const statusField = snap.has('health_status')
    ? 'health_status'
    : snap.has('status')
      ? 'status'
      : null;
  if (!statusField || !snap.has('snapshot_at')) {
    return { ok: false, skipped: true, reason: 'no_health_source' };
  }

  const snapFallbackCols = [
    'tenant_id',
    'day',
    'snapshot_count',
    'green_count',
    'yellow_count',
    'red_count',
    'avg_tools_degraded',
    'avg_tel_cost_24h',
    'health_status',
  ];
  if (!snapFallbackCols.every((c) => out.has(c))) {
    return { ok: false, skipped: true, reason: 'agentsam_health_daily_missing_snapshot_fallback_columns' };
  }

  const snapDayExpr = snap.has('snapshot_at')
    ? `date(datetime(snapshot_at,'unixepoch')) = date('now','-1 day')`
    : '1=0';

  try {
    const r = await env.DB.prepare(`
      INSERT INTO agentsam_health_daily (
        tenant_id, day, snapshot_count, green_count, yellow_count, red_count,
        avg_tools_degraded, avg_tel_cost_24h, health_status
      )
      SELECT
        '${DEFAULT_TENANT}',
        date('now','-1 day'),
        COUNT(*),
        SUM(CASE WHEN ${statusField}='green' THEN 1 ELSE 0 END),
        SUM(CASE WHEN ${statusField}='yellow' THEN 1 ELSE 0 END),
        SUM(CASE WHEN ${statusField}='red' THEN 1 ELSE 0 END),
        0,
        0,
        CASE
          WHEN SUM(CASE WHEN ${statusField}='red' THEN 1 ELSE 0 END) > 0 THEN 'red'
          WHEN SUM(CASE WHEN ${statusField}='yellow' THEN 1 ELSE 0 END) > 0 THEN 'yellow'
          ELSE 'green' END
      FROM system_health_snapshots
      WHERE ${snapDayExpr}
      ON CONFLICT(tenant_id, day) DO UPDATE SET
        snapshot_count = excluded.snapshot_count,
        green_count = excluded.green_count,
        yellow_count = excluded.yellow_count,
        red_count = excluded.red_count,
        health_status = excluded.health_status
    `).run();
    return { ok: true, changes: r.meta?.changes ?? r.changes ?? 0 };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Daily dashboard aggregates from agentsam_usage_rollups_daily — binds workspace_id per tenant/workspace row.
 */
export async function rollupAgentsamAnalyticsDaily(env) {
  if (!env?.DB) return { ok: false, skipped: true };
  const ana = await pragmaTableInfo(env.DB, 'agentsam_analytics');
  if (!ana.size || !ana.has('workspace_id')) return { ok: true, skipped: true, reason: 'analytics_workspace' };
  const src = await pragmaTableInfo(env.DB, 'agentsam_usage_rollups_daily');
  if (!src.has('tenant_id') || !src.has('workspace_id') || !src.has('day')) {
    return { ok: true, skipped: true, reason: 'rollups_source' };
  }

  const parts = [
    `SELECT
      'aan_' || lower(hex(randomblob(8))) AS id,
      r.tenant_id AS tenant_id,
      r.workspace_id AS workspace_id,
      'daily' AS period,
      r.day AS period_date`,
  ];
  if (ana.has('total_cost_usd')) parts.push(', COALESCE(r.cost_usd, 0) AS total_cost_usd');
  if (ana.has('total_input_tokens')) parts.push(', COALESCE(r.tokens_in, 0) AS total_input_tokens');
  if (ana.has('total_output_tokens')) parts.push(', COALESCE(r.tokens_out, 0) AS total_output_tokens');
  if (ana.has('computed_at')) parts.push(', unixepoch() AS computed_at');

  const inner = `${parts.join('')}
    FROM agentsam_usage_rollups_daily r
    WHERE r.day = date('now','-1 day')
      AND r.workspace_id IS NOT NULL AND trim(r.workspace_id) != ''
      AND r.tenant_id IS NOT NULL AND trim(r.tenant_id) != ''`;

  const insertCols = ['id', 'tenant_id', 'workspace_id', 'period', 'period_date'];
  const selCols = ['id', 'tenant_id', 'workspace_id', 'period', 'period_date'];
  if (ana.has('total_cost_usd')) {
    insertCols.push('total_cost_usd');
    selCols.push('total_cost_usd');
  }
  if (ana.has('total_input_tokens')) {
    insertCols.push('total_input_tokens');
    selCols.push('total_input_tokens');
  }
  if (ana.has('total_output_tokens')) {
    insertCols.push('total_output_tokens');
    selCols.push('total_output_tokens');
  }
  if (ana.has('computed_at')) {
    insertCols.push('computed_at');
    selCols.push('computed_at');
  }

  const conflictTarget =
    ana.has('tenant_id') &&
    ana.has('workspace_id') &&
    ana.has('period') &&
    ana.has('period_date')
      ? '(tenant_id, workspace_id, period, period_date)'
      : null;

  const updates = [
    ana.has('total_cost_usd') && 'total_cost_usd = excluded.total_cost_usd',
    ana.has('total_input_tokens') && 'total_input_tokens = excluded.total_input_tokens',
    ana.has('total_output_tokens') && 'total_output_tokens = excluded.total_output_tokens',
    ana.has('computed_at') && 'computed_at = excluded.computed_at',
    ana.has('workspace_id') && 'workspace_id = excluded.workspace_id',
  ].filter(Boolean);

  const sqlWithConflict =
    conflictTarget && updates.length
      ? `
    INSERT INTO agentsam_analytics (${insertCols.join(', ')})
    SELECT ${selCols.join(', ')} FROM (${inner}) AS x
    ON CONFLICT${conflictTarget} DO UPDATE SET ${updates.join(', ')}
  `
      : null;

  try {
    if (sqlWithConflict) {
      const r = await env.DB.prepare(sqlWithConflict).run();
      return { ok: true, changes: r.meta?.changes ?? r.changes ?? 0 };
    }
    const r = await env.DB.prepare(`
      INSERT INTO agentsam_analytics (${insertCols.join(', ')})
      SELECT ${selCols.join(', ')} FROM (${inner}) AS x
    `).run();
    return { ok: true, changes: r.meta?.changes ?? r.changes ?? 0 };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function rollupDeploymentsWeekly(env) {
  if (!env?.DB) return { ok: false, skipped: true };

  // system-scoped cron: no authenticated user context at this path
  const tenantId =
    typeof env?.TENANT_ID === 'string' && env.TENANT_ID.trim() ? env.TENANT_ID.trim() : 'system';
  const workspaceId =
    typeof env?.WORKSPACE_ID === 'string' && env.WORKSPACE_ID.trim() ? env.WORKSPACE_ID.trim() : 'system';

  const out = await pragmaTableInfo(env.DB, 'deployments_weekly_rollup');
  const dep = await pragmaTableInfo(env.DB, 'deployments');
  if (!out.size || !dep.has('created_at_unix')) {
    return { ok: false, skipped: true, reason: 'created_at_unix_required' };
  }

  const rollBegun = await startCronRun(env, {
    jobName: 'deployments_weekly_rollup',
    cronExpression: '0 1 * * sun',
    tenantId,
    workspaceId,
  });
  const rollStartedAt = rollBegun?.startedAt ?? Date.now();
  const rollId = rollBegun?.runId ?? null;

  const statusOkExpr = `(LOWER(COALESCE(status,'')) IN ('success','ok','completed'))`;
  const weekStartExpr = sqlSundayWeekStartUnix('created_at_unix');
  const currentWeekExpr = sqlCurrentSundayWeekStart();
  const completeWeekWhere = `${weekStartExpr} < ${currentWeekExpr}`;
  const tenantSql = String(tenantId || DEFAULT_TENANT).replace(/'/g, "''");

  const insertCols = [];
  const selectExprs = [];
  if (out.has('tenant_id')) {
    insertCols.push('tenant_id');
    selectExprs.push(`'${tenantSql}'`);
  }
  if (out.has('week_start')) {
    insertCols.push('week_start');
    selectExprs.push(weekStartExpr);
  }
  if (out.has('week_end')) {
    insertCols.push('week_end');
    selectExprs.push(`date(${weekStartExpr}, '+6 days')`);
  }
  if (out.has('total_deploys')) {
    insertCols.push('total_deploys');
    selectExprs.push('COUNT(*)');
  }
  if (out.has('success_count')) {
    insertCols.push('success_count');
    selectExprs.push(
      dep.has('status')
        ? `SUM(CASE WHEN ${statusOkExpr} THEN 1 ELSE 0 END)`
        : '0',
    );
  }
  if (out.has('failed_count')) {
    insertCols.push('failed_count');
    selectExprs.push(
      dep.has('status')
        ? `SUM(CASE WHEN NOT (${statusOkExpr}) THEN 1 ELSE 0 END)`
        : '0',
    );
  }
  if (out.has('total_duration_ms')) {
    insertCols.push('total_duration_ms');
    selectExprs.push(
      dep.has('deploy_duration_ms')
        ? 'COALESCE(SUM(deploy_duration_ms), 0)'
        : dep.has('deploy_time_seconds')
          ? 'COALESCE(SUM(deploy_time_seconds), 0) * 1000'
          : '0',
    );
  }
  if (out.has('avg_duration_ms')) {
    insertCols.push('avg_duration_ms');
    selectExprs.push(
      dep.has('deploy_duration_ms')
        ? 'AVG(deploy_duration_ms)'
        : dep.has('deploy_time_seconds')
          ? 'AVG(deploy_time_seconds) * 1000'
          : '0',
    );
  }
  if (out.has('notes')) {
    insertCols.push('notes');
    selectExprs.push(`'retention_weekly'`);
  }
  if (out.has('rolled_up_at')) {
    insertCols.push('rolled_up_at');
    selectExprs.push('unixepoch()');
  }

  if (insertCols.length === 0) {
    return { ok: false, skipped: true, reason: 'deployments_weekly_empty_columns' };
  }

  const sql = `
    INSERT OR IGNORE INTO deployments_weekly_rollup (${insertCols.join(', ')})
    SELECT ${selectExprs.join(', ')}
    FROM deployments
    WHERE created_at_unix IS NOT NULL
      AND ${completeWeekWhere}
    GROUP BY ${weekStartExpr}
  `;

  try {
    let rowsRead = 0;
    try {
      const cnt = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM deployments
         WHERE created_at_unix IS NOT NULL AND ${completeWeekWhere}`,
      ).first();
      rowsRead = Number(cnt?.c ?? 0);
    } catch {
      rowsRead = 0;
    }

    const r = await env.DB.prepare(sql).run();
    const changes = r.meta?.changes ?? r.changes ?? 0;

    const purged = await env.DB.prepare(
      `DELETE FROM deployments
       WHERE created_at_unix IS NOT NULL AND ${completeWeekWhere}`,
    ).run();
    const deploymentsDeleted = purged.meta?.changes ?? purged.changes ?? 0;

    let trackingDeleted = 0;
    const track = await pragmaTableInfo(env.DB, 'deployment_tracking');
    if (track.has('created_at')) {
      const tr = await env.DB.prepare(
        `DELETE FROM deployment_tracking
         WHERE date(created_at) < ${currentWeekExpr}`,
      ).run();
      trackingDeleted = tr.meta?.changes ?? tr.changes ?? 0;
    }

    if (rollId) {
      await completeCronRun(env, rollId, rollStartedAt, {
        rowsRead,
        rowsWritten: changes,
        metadata: {
          deployments_weekly_rollup: true,
          changes,
          deployments_deleted: deploymentsDeleted,
          deployment_tracking_deleted: trackingDeleted,
        },
      });
    }

    return {
      ok: true,
      changes,
      deployments_deleted: deploymentsDeleted,
      deployment_tracking_deleted: trackingDeleted,
    };
  } catch (e) {
    if (rollId) await failCronRun(env, rollId, rollStartedAt, e);
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function purgeHotLogs(env) {
  if (!env?.DB) return { purges: {}, ok: false };
  const purges = {};
  const specs = [
    { table: 'agentsam_usage_events', days: 1, prefs: ['created_at'] },
    { table: 'agentsam_mcp_tool_execution', days: 7, prefs: ['created_at_unix', 'created_at'] },
    { table: 'spend_ledger', days: 30, prefs: ['occurred_at', 'created_at'] },
    { table: 'worker_analytics_events', days: 7, prefs: ['timestamp', 'created_at'] },
    { table: 'worker_analytics_errors', days: 30, prefs: ['created_at'] },
    { table: 'routing_decisions', days: 30, prefs: ['created_at'] },
    { table: 'rag_query_log', days: 60, prefs: ['created_at'] },
    { table: 'rag_ingest_log', days: 60, prefs: ['created_at'] },
    // Telemetry retention — rolled up, raw rows beyond window are noise
    { table: 'agentsam_cron_runs', days: 3, prefs: ['started_at'] },
    { table: 'agentsam_performance_eto_events', days: 2, prefs: ['created_at_unix', 'created_at'] },
    { table: 'agentsam_error_log', days: 90, prefs: ['created_at'] },
  ];

  for (const spec of specs) {
    const cols = await pragmaTableInfo(env.DB, spec.table);
    if (!cols.size) {
      purges[spec.table] = { skipped: true };
      continue;
    }
    const dc = pickDateColumn(cols, spec.prefs);
    if (!dc) {
      purges[spec.table] = { skipped: true, reason: 'no_date_column' };
      continue;
    }

    // Never guess numeric-vs-text from the column *name* alone — TEXT sorts greater
    // than INTEGER under SQLite type affinity, so `created_at < unixepoch(...)`
    // silently matches zero rows when created_at is a TEXT ISO datetime string.
    const declaredType = await columnTypeAffinity(env.DB, spec.table, dc);
    const compare = choosePurgeCompare(declaredType, dc);

    let sql;
    if (compare === 'date') {
      sql = `DELETE FROM ${spec.table} WHERE date(${dc}) < date('now', '-${spec.days} days')`;
    } else if (compare === 'unixepoch') {
      sql = `DELETE FROM ${spec.table} WHERE ${dc} < unixepoch('now', '-${spec.days} days')`;
    } else {
      sql = `DELETE FROM ${spec.table} WHERE datetime(${dc}) < datetime('now', '-${spec.days} days')`;
    }

    // ETO events feed Thompson sampling — never purge a row still waiting to be
    // scored, even if it has aged past the hot-log window. Losing unapplied
    // training signal to a purge is worse than a few extra days of storage.
    if (spec.table === 'agentsam_performance_eto_events') {
      sql += ` AND NOT (is_training_eligible = 1 AND applied_to_thompson_at IS NULL)`;
    }

    try {
      const r = await env.DB.prepare(sql).run();
      const deleted = r.meta?.changes ?? r.changes ?? 0;
      purges[spec.table] = {
        deleted,
        column: dc,
        compare,
        days: spec.days,
        declared_type: declaredType || null,
      };
      console.info(
        `[purgeHotLogs] ${spec.table}: deleted=${deleted} column=${dc} compare=${compare} days=${spec.days}`,
      );
    } catch (e) {
      purges[spec.table] = {
        error: String(e?.message || e),
        column: dc,
        compare,
      };
    }
  }
  return { purges, ok: true };
}

export async function offloadRetentionToSupabase(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !env?.DB) return { ok: false, skipped: true };

  try {
    const dayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const usage = await env.DB.prepare(
      `SELECT * FROM agentsam_usage_rollups_daily WHERE day = ? LIMIT 100`,
    )
      .bind(dayStr)
      .all()
      .catch(() => ({ results: [] }));

    const perf = await env.DB.prepare(
    )
      .all()
      .catch(() => ({ results: [] }));

    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    };

    if (usage.results?.length) {
      await fetch(`${String(url).replace(/\/$/, '')}/rest/v1/cost_forecasts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(
          usage.results.map((row) => ({
            ...row,
            metric_date: row.day,
            offload_source: 'retention',
          })),
        ),
      }).catch(() => {});
    }

    if (perf.results?.length) {
      await fetch(`${String(url).replace(/\/$/, '')}/rest/v1/agent_decisions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(
          perf.results.map((row) => ({
            ...row,
          })),
        ),
      }).catch(() => {});
    }

    return { ok: true };
  } catch {
    return { ok: false, skipped: true };
  }
}

export async function runMasterDailyRetention(env) {
  const started = Date.now();
  const rollups = {
    agentsam_usage_rollups_daily: await rollupAgentsamUsageDaily(env),
    agentsam_analytics: await rollupAgentsamAnalyticsDaily(env),
    agentsam_tool_stats_compacted: await rollupMcpToolCallStats(env),
    workspace_usage_metrics: await rollupWorkspaceUsageMetrics(env),
    agentsam_routing_arms: await updateModelRoutingRulesFromScores(env),
    thompson_arm_update: await updateArmsFromMetrics(env),
    thompson_decay: await decayRoutingArms(env),
    agentsam_health_daily: await rollupAgentsamHealthDaily(env),
    deployments_weekly_rollup: await rollupDeploymentsWeekly(env),
  };

  try {
    await offloadRetentionToSupabase(env);
  } catch {
    /* never block purge */
  }

  let purges = {};
  try {
    purges = (await purgeHotLogs(env)).purges || {};
  } catch (e) {
    purges = { error: String(e?.message || e) };
  }

  return {
    rollups,
    purges,
    duration_ms: Date.now() - started,
  };
}
