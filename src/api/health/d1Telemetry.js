/**
 * D1 Agent Sam analytics surfaces for the Health dashboard.
 *
 * ## agentsam_execution_performance_metrics — how it gets populated
 *
 * 1. **Real-time (per command finish)** — `recordCommandPerformance` in
 *    `backend/telemetry/commands/performance.js` runs when `finishCommandRun` finalizes a row
 *    in `agentsam_command_run` with `selected_command_id` + `tenant_id`. It upserts one aggregate
 *    row per `(tenant_id, command_id, metric_date)` for the current UTC date.
 *
 * 2. **Daily batch (yesterday’s command runs)** — `rollupExecutionPerformanceMetrics` in
 *    `src/core/memory.js` (invoked from the Worker cron in `src/index.js`) recomputes aggregates
 *    from `agentsam_command_run` for the prior local day and merges via `ON CONFLICT`.
 *
 * 3. **Compact journal feed (Batch 2)** — `runExecutionJournalLearningFeed` rolls
 *    `agentsam_tool_chain` completed/failed rows with `output_summary` ≥20 into EPM
 *    (`source_table='agentsam_tool_chain'`) + `agentsam_usage_rollups_daily` tool_* counters.
 *    Fail-loud if post-compact-cutoff rows lack summaries.
 *
 * Requirements for useful rows: `tenant_id`, `command_id` (FK to `agentsam_commands`), and
 * successful inserts into `agentsam_command_run` from the agent/command pipeline.
 *
 * @module
 */

import { pragmaTableInfo, tableExists } from '../../../backend/services/retention.js';

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function all(db, sql, binds = []) {
  if (!db) return [];
  try {
    const { results } = await db.prepare(sql).bind(...binds).all();
    return results || [];
  } catch {
    return [];
  }
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function first(db, sql, binds = []) {
  if (!db) return null;
  try {
    return await db.prepare(sql).bind(...binds).first();
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {{ tenantId: string | null, userId: string | null, superadmin: boolean }} scope
 */
export async function fetchAgentsamD1Telemetry(env, scope) {
  const db = env?.DB;
  const tid = scope.tenantId && String(scope.tenantId).trim() ? String(scope.tenantId).trim() : null;
  const uid = scope.userId && String(scope.userId).trim() ? String(scope.userId).trim() : null;
  const sa = !!scope.superadmin;

  if (!db) {
    return {
      ok: false,
      error: 'DB not configured',
      tables: {},
      agentsam_execution_performance_metrics_doc: {
        realtime: 'backend/telemetry/commands/performance.js → recordCommandPerformance',
        daily_cron: 'src/core/memory.js → rollupExecutionPerformanceMetrics',
        source_rows: 'agentsam_command_run (selected_command_id, tenant_id, duration, tokens, cost)',
      },
    };
  }

  const out = {
    ok: true,
    scope: { tenant_id: tid, user_id: uid, superadmin: sa },
    agentsam_execution_performance_metrics_doc: {
      realtime: 'Upsert on each command run completion (same calendar day bucket).',
      daily_cron: 'Rollup from agentsam_command_run for the previous local day.',
      code: [
        'backend/telemetry/commands/performance.js — recordCommandPerformance',
        'src/core/memory.js — rollupExecutionPerformanceMetrics',
      ],
    },
    tables: {},
  };

  // --- agentsam_execution_performance_metrics ---
  if (await tableExists(db, 'agentsam_execution_performance_metrics')) {
    const summary = tid
      ? await first(
          db,
          `SELECT
             COUNT(*) AS row_count,
             COALESCE(SUM(execution_count), 0) AS total_executions,
             COALESCE(AVG(success_rate_percent), 0) AS avg_success_rate,
             COALESCE(AVG(avg_duration_ms), 0) AS avg_duration_ms,
             COALESCE(SUM(total_cost_cents), 0) AS total_cost_cents
           FROM agentsam_execution_performance_metrics
           WHERE tenant_id = ? AND metric_date >= date('now', '-30 days')`,
          [tid],
        )
      : null;
    const recent = tid
      ? await all(
          db,
          `SELECT *
           FROM agentsam_execution_performance_metrics
           WHERE tenant_id = ?
           ORDER BY metric_date DESC, last_computed_at DESC
           LIMIT 40`,
          [tid],
        )
      : [];
    out.tables.agentsam_execution_performance_metrics = {
      available: true,
      summary: summary || {},
      recent,
    };
  } else {
    out.tables.agentsam_execution_performance_metrics = { available: false, summary: {}, recent: [] };
  }

  // --- agentsam_agent_run (scoped by user for privacy) ---
  if (await tableExists(db, 'agentsam_agent_run')) {
    const runs = uid
      ? await all(
          db,
          `SELECT id, status, workspace_id, model_key, routing_arm_id, cost_usd,
                  input_tokens, output_tokens, cached_input_tokens, reasoning_tokens,
                  created_at_unix, started_at_unix, completed_at_unix, latency_ms, error_message
           FROM agentsam_agent_run
           WHERE user_id = ?
           ORDER BY created_at_unix DESC
           LIMIT 30`,
          [uid],
        )
      : [];
    out.tables.agentsam_agent_run = { available: true, recent: runs };
  } else {
    out.tables.agentsam_agent_run = { available: false, recent: [] };
  }

  // --- agentsam_deployment_health ---
  if (await tableExists(db, 'agentsam_deployment_health')) {
    const cols = await pragmaTableInfo(db, 'agentsam_deployment_health');
    const hasTid = cols.has('tenant_id');
    const rows = tid && hasTid
      ? await all(
          db,
          `SELECT * FROM agentsam_deployment_health WHERE tenant_id = ? ORDER BY COALESCE(created_at,0) DESC LIMIT 20`,
          [tid],
        )
      : await all(db, `SELECT * FROM agentsam_deployment_health ORDER BY COALESCE(created_at,0) DESC LIMIT 20`);
    out.tables.agentsam_deployment_health = { available: true, recent: rows };
  } else {
    out.tables.agentsam_deployment_health = { available: false, recent: [] };
  }

  // --- agentsam_health_daily ---
  if (await tableExists(db, 'agentsam_health_daily')) {
    const cols = await pragmaTableInfo(db, 'agentsam_health_daily');
    const hasTid = cols.has('tenant_id');
    // Rollups often key tenant_id as 'system' (DEFAULT_TENANT) while sessions use workspace tenants — include both.
    const rows = tid && hasTid
      ? await all(
          db,
          `SELECT * FROM agentsam_health_daily WHERE tenant_id IN (?, 'system') ORDER BY day DESC LIMIT 14`,
          [tid],
        )
      : await all(db, `SELECT * FROM agentsam_health_daily ORDER BY day DESC LIMIT 14`);
    out.tables.agentsam_health_daily = { available: true, recent: rows };
  } else {
    out.tables.agentsam_health_daily = { available: false, recent: [] };
  }

  // --- agentsam_mcp_tool_execution ---
  if (await tableExists(db, 'agentsam_mcp_tool_execution')) {
    const cols = await pragmaTableInfo(db, 'agentsam_mcp_tool_execution');
    const hasTid = cols.has('tenant_id');
    const orderCol = cols.has('created_at') ? 'created_at' : cols.has('started_at') ? 'started_at' : 'rowid';
    const rows =
      tid && hasTid
        ? await all(
            db,
            `SELECT * FROM agentsam_mcp_tool_execution WHERE tenant_id = ? ORDER BY ${orderCol} DESC LIMIT 40`,
            [tid],
          )
        : await all(db, `SELECT * FROM agentsam_mcp_tool_execution ORDER BY ${orderCol} DESC LIMIT 40`);
    out.tables.agentsam_mcp_tool_execution = { available: true, recent: rows };
  } else {
    out.tables.agentsam_mcp_tool_execution = { available: false, recent: [] };
  }

  // --- agentsam_tool_call_log ---
  if (await tableExists(db, 'agentsam_tool_call_log')) {
    const cols = await pragmaTableInfo(db, 'agentsam_tool_call_log');
    const hasTid = cols.has('tenant_id');
    const orderCol = cols.has('created_at') ? 'created_at' : 'rowid';
    const rows =
      tid && hasTid
        ? await all(
            db,
            `SELECT * FROM agentsam_tool_call_log WHERE tenant_id = ? ORDER BY ${orderCol} DESC LIMIT 40`,
            [tid],
          )
        : await all(db, `SELECT * FROM agentsam_tool_call_log ORDER BY ${orderCol} DESC LIMIT 40`);
    out.tables.agentsam_tool_call_log = { available: true, recent: rows };
  } else {
    out.tables.agentsam_tool_call_log = { available: false, recent: [] };
  }

  // --- agentsam_tool_stats_compacted ---
  if (await tableExists(db, 'agentsam_tool_stats_compacted')) {
    const cols = await pragmaTableInfo(db, 'agentsam_tool_stats_compacted');
    const hasTid = cols.has('tenant_id');
    const orderExpr = cols.has('day')
      ? 'day'
      : cols.has('date')
        ? 'date'
        : 'COALESCE(last_seen_at, compacted_at)';
    const rows =
      tid && hasTid
        ? await all(
            db,
            `SELECT * FROM agentsam_tool_stats_compacted WHERE tenant_id = ? ORDER BY ${orderExpr} DESC LIMIT 30`,
            [tid],
          )
        : await all(db, `SELECT * FROM agentsam_tool_stats_compacted ORDER BY ${orderExpr} DESC LIMIT 30`);
    out.tables.agentsam_tool_stats_compacted = { available: true, recent: rows };
  } else {
    out.tables.agentsam_tool_stats_compacted = { available: false, recent: [] };
  }

  // --- agentsam_usage_events ---
  if (await tableExists(db, 'agentsam_usage_events')) {
    const rows = tid
      ? await all(
          db,
          `SELECT * FROM agentsam_usage_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 40`,
          [tid],
        )
      : [];
    out.tables.agentsam_usage_events = { available: true, recent: rows };
  } else {
    out.tables.agentsam_usage_events = { available: false, recent: [] };
  }

  // --- agentsam_webhook_events ---
  if (await tableExists(db, 'agentsam_webhook_events')) {
    const rows = tid
      ? await all(
          db,
          `SELECT id, tenant_id, workspace_id, endpoint_id, provider, event_type, event_id,
                  status, signature_valid, workflow_run_id, metadata_json, processing_error,
                  received_at_unix, processed_at_unix
           FROM agentsam_webhook_events
           WHERE tenant_id = ?
           ORDER BY received_at_unix DESC
           LIMIT 30`,
          [tid],
        )
      : [];
    out.tables.agentsam_webhook_events = { available: true, recent: rows };
  } else {
    out.tables.agentsam_webhook_events = { available: false, recent: [] };
  }

  // --- agentsam_workflow_runs ---
  if (await tableExists(db, 'agentsam_workflow_runs')) {
    const wfWhere = sa && tid ? 'tenant_id = ?' : tid && uid ? 'tenant_id = ? AND user_id = ?' : tid ? 'tenant_id = ?' : '1=0';
    const binds = sa && tid ? [tid] : tid && uid ? [tid, uid] : tid ? [tid] : [];
    const rows =
      binds.length > 0
        ? await all(
            db,
            `SELECT id, workflow_key, display_name, status, steps_total, steps_completed, started_at, completed_at, tenant_id
             FROM agentsam_workflow_runs
             WHERE ${wfWhere}
             ORDER BY started_at DESC
             LIMIT 25`,
            binds,
          )
        : [];
    out.tables.agentsam_workflow_runs = { available: true, recent: rows };
  } else {
    out.tables.agentsam_workflow_runs = { available: false, recent: [] };
  }

  // --- agentsam_analytics (optional table name — not in all envs) ---
  if (await tableExists(db, 'agentsam_analytics')) {
    const cols = await pragmaTableInfo(db, 'agentsam_analytics');
    const hasTid = cols.has('tenant_id');
    const rows =
      tid && hasTid
        ? await all(db, `SELECT * FROM agentsam_analytics WHERE tenant_id = ? ORDER BY rowid DESC LIMIT 20`, [tid])
        : await all(db, `SELECT * FROM agentsam_analytics ORDER BY rowid DESC LIMIT 20`);
    out.tables.agentsam_analytics = { available: true, recent: rows };
  } else {
    out.tables.agentsam_analytics = { available: false, recent: [], note: 'Table not present in this D1 schema.' };
  }

  // --- agentsam_codebase_index_health (weekly pgvector vs git staleness) ---
  if (await tableExists(db, 'agentsam_codebase_index_health')) {
    const rows = await all(
      db,
      `SELECT id, workspace_id, workspace_key, checked_at, week_start,
              total_indexed, stale_index_count, stale_files_json, head_sha, repo, metadata_json
         FROM agentsam_codebase_index_health
        ORDER BY checked_at DESC
        LIMIT 8`,
    );
    const latest = rows[0] ?? null;
    let stalePreview = [];
    if (latest?.stale_files_json) {
      try {
        stalePreview = JSON.parse(String(latest.stale_files_json)).slice(0, 10);
      } catch {
        stalePreview = [];
      }
    }
    out.tables.agentsam_codebase_index_health = {
      available: true,
      summary: latest
        ? {
            week_start: latest.week_start,
            checked_at: latest.checked_at,
            total_indexed: latest.total_indexed,
            stale_index_count: latest.stale_index_count,
            head_sha: latest.head_sha,
            repo: latest.repo,
          }
        : {},
      stale_preview: stalePreview,
      recent: rows,
      note: 'Weekly cron flags files where last_reindexed_at is >30d and GitHub has newer commits.',
    };
  } else {
    out.tables.agentsam_codebase_index_health = { available: false, recent: [], stale_preview: [] };
  }

  if (!tid) {
    out.hint =
      'No tenant_id on session — tenant-scoped tables (usage, webhooks, agentsam_execution_performance_metrics, etc.) return empty until the account is associated with a tenant.';
  }

  return out;
}
