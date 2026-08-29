/**
 * D1 / Cloudflare analytics lane — mechanical peel from databases.js.
 */
import { pragmaTableInfo, tableExists } from '../../../../../backend/services/retention.js';
import {
  fetchD1AnalyticsOverview,
  resolveCloudflareAnalyticsCreds,
} from '../../../../core/d1-graphql-analytics.js';
import { DB } from '../../../../core/worker-bindings.js';
import { getAgentsamWorkspace } from '../../../../../backend/identity/workspace/agentsam-workspace.js';
import { resolveWorkspaceD1Catalog } from '../../../../core/workspace-d1-access.js';
import { getAuthUser } from '../../../../core/auth.js';
import { resolveCanonicalUserId } from '../../../auth.js';
import { listCallerVisibleD1Databases } from '../../../../core/cf-mcp-proxy.js';
import {
  trim,
  d1All,
  d1First,
  rangeSeconds,
  rangeStartSec,
  rangeStartNano,
  tenantWorkspaceClause,
  SQL_DB_TOOL_D1,
  SQL_DB_TOOL_SUPABASE,
  dbToolClause,
  bucketExpr,
  buildBucketLabels,
  formatActivityCount,
  extractTableNamesFromSql,
  percentileMs,
  D1_STORAGE_LIMIT_BYTES,
} from '../shared.js';

export function matchVisibleD1(databases, idOrName) {
  const needle = trim(idOrName).toLowerCase();
  if (!needle) return null;
  return (
    (Array.isArray(databases) ? databases : []).find((row) => {
      const id = trim(row?.database_id || row?.id).toLowerCase();
      const name = trim(row?.database_name || row?.name).toLowerCase();
      return id === needle || name === needle;
    }) || null
  );
}

export async function workspaceAnalyticsDefault(env, workspaceId) {
  const ws = trim(workspaceId);
  if (!ws || !env?.DB) return null;
  const row = await getAgentsamWorkspace(env, ws);
  const catalog = resolveWorkspaceD1Catalog(row);
  if (catalog.length > 0) {
    return { id: catalog[0].database_id, name: catalog[0].database_name };
  }
  return null;
}

/**
 * Analytics D1 identity is the selected catalog resource, not a hardcoded default name.
 * Requested `database_id` must appear in the caller's visible D1 catalog (or workspace pin).
 */
export async function resolveAnalyticsDatabaseTarget(env, request, workspaceId, requestedRaw) {
  const requested = trim(requestedRaw);
  const workspaceDefault = await workspaceAnalyticsDefault(env, workspaceId);
  const authUser = request ? await getAuthUser(request, env) : null;
  const rawId = trim(authUser?.id);
  const userId = rawId ? await resolveCanonicalUserId(rawId, env) : '';
  const listed = userId ? await listCallerVisibleD1Databases(env, userId, authUser) : { databases: [] };
  const visible = Array.isArray(listed.databases) ? listed.databases : [];

  if (requested) {
    const match = matchVisibleD1(visible, requested) || (workspaceDefault && matchVisibleD1([workspaceDefault], requested) ? workspaceDefault : null);
    if (!match) {
      return { error: 'd1_analytics_resource_denied', status: 403 };
    }
    return { id: match.database_id || match.id, name: match.database_name || match.name };
  }

  const preferred =
    (workspaceDefault && matchVisibleD1(visible, workspaceDefault.id)) ||
    matchVisibleD1(visible, workspaceDefault?.name) ||
    matchVisibleD1(visible, DB.database_id) ||
    visible.find(
      (row) =>
        row.source === 'platform_operator' || row.source === 'platform_token_catalog',
    ) ||
    visible.find((row) => /inneranimalmedia-business/i.test(String(row.database_name || ''))) ||
    visible[0] ||
    workspaceDefault;
  if (preferred) {
    return {
      id: preferred.database_id || preferred.id,
      name: preferred.database_name || preferred.name,
    };
  }
  return { error: 'd1_analytics_resource_required', status: 400 };
}

/** Remote D1 has no dbstat — estimate largest tables by row count on hot paths. */
export const D1_LARGEST_TABLE_CANDIDATES = [
  'otlp_traces',
  'agentsam_tool_call_log',
  'agentsam_error_log',
  'agentsam_mcp_tool_execution',
  'agentsam_hook_execution',
  'agentsam_cron_runs',
  'agentsam_memory',
  'agentsam_workflow_runs',
  'agentsam_webhook_events',
  'vectorize_sync_log',
  'worker_analytics_errors',
  'agentsam_execution_steps',
  'security_findings',
  'secret_audit_log',
];

/** @param {import('@cloudflare/workers-types').D1Database} db */
export async function loadD1LargestTables(db, warnings) {
  const out = [];
  for (const tableName of D1_LARGEST_TABLE_CANDIDATES) {
    if (!(await tableExists(db, tableName))) continue;
    const row = await d1First(
      db,
      `d1_rows_${tableName}`,
      `SELECT COUNT(*) AS c FROM ${tableName}`,
      [],
      warnings,
    );
    const count = Number(row?.c) || 0;
    if (count <= 0) continue;
    out.push({
      name: tableName,
      val: `${formatActivityCount(count, 'rows')} · est.`,
      ds: /** @type {'d1'} */ ('d1'),
      sort: count,
    });
  }
  out.sort((a, b) => b.sort - a.sort);
  return out.slice(0, 5);
}

/**
 * Estimate rows read/written from tool_call_log JSON payloads (D1/Hyperdrive tools).
 * @param {import('@cloudflare/workers-types').D1Database} db
 */
async function aggregateToolCallRowEstimates(db, scope, range, ds, warnings) {
  if (!(await tableExists(db, 'agentsam_tool_call_log'))) {
    return { rowsRead: 0, rowsWritten: 0, rowsReadPrev: 0, rowsWrittenPrev: 0 };
  }
  const cols = await pragmaTableInfo(db, 'agentsam_tool_call_log');
  if (!cols.has('created_at') || !cols.has('output_json')) {
    return { rowsRead: 0, rowsWritten: 0, rowsReadPrev: 0, rowsWrittenPrev: 0 };
  }

  const start = rangeStartSec(range);
  const prevStart = start - rangeSeconds(range);

  const buildSql = (timeClause, timeBinds) => {
    const binds = [...timeBinds];
    const where = [timeClause, dbToolClause(ds)];
    where.push(...tenantWorkspaceClause({ ...scope, tableCols: cols }, binds));
    const sql = `SELECT
        COALESCE(SUM(
          CASE
            WHEN json_valid(COALESCE(output_json, ''))
             AND json_type(json_extract(output_json, '$.results')) = 'array'
            THEN json_array_length(json_extract(output_json, '$.results'))
            WHEN json_valid(COALESCE(output_json, ''))
             AND json_extract(output_json, '$.row_count') IS NOT NULL
            THEN CAST(json_extract(output_json, '$.row_count') AS INTEGER)
            ELSE 0
          END
        ), 0) AS rr,
        COALESCE(SUM(
          CASE
            WHEN json_valid(COALESCE(output_json, ''))
             AND json_extract(output_json, '$.meta.changes') IS NOT NULL
            THEN CAST(json_extract(output_json, '$.meta.changes') AS INTEGER)
            WHEN json_valid(COALESCE(output_json, ''))
             AND json_extract(output_json, '$.changes') IS NOT NULL
            THEN CAST(json_extract(output_json, '$.changes') AS INTEGER)
            ELSE 0
          END
        ), 0) AS rw
      FROM agentsam_tool_call_log
      WHERE ${where.join(' AND ')}`;
    return { sql, binds };
  };

  const cur = buildSql('created_at >= ?', [start]);
  const curRow = await d1First(db, 'tcl_row_est', cur.sql, cur.binds, warnings);
  const prev = buildSql('created_at >= ? AND created_at < ?', [prevStart, start]);
  const prevRow = await d1First(db, 'tcl_row_est_prev', prev.sql, prev.binds, warnings);

  return {
    rowsRead: Number(curRow?.rr ?? 0) || 0,
    rowsWritten: Number(curRow?.rw ?? 0) || 0,
    rowsReadPrev: Number(prevRow?.rr ?? 0) || 0,
    rowsWrittenPrev: Number(prevRow?.rw ?? 0) || 0,
  };
}

/** @param {import('@cloudflare/workers-types').D1Database} db */
export async function loadD1OtlpHotTables(db, scope, range, warnings) {
  if (!(await tableExists(db, 'otlp_traces'))) return { mostRead: [], mostWritten: [] };
  const cols = await pragmaTableInfo(db, 'otlp_traces');
  if (!cols.has('d1_query')) return { mostRead: [], mostWritten: [] };

  const binds = [rangeStartNano(range)];
  const where = [`start_time_unix_nano >= ?`, `d1_query IS NOT NULL`, `TRIM(d1_query) != ''`];
  where.push(...tenantWorkspaceClause({ ...scope, tableCols: cols }, binds));

  const rows = await d1All(
    db,
    'otlp_hot_tables',
    `SELECT d1_query,
            COALESCE(SUM(d1_rows_read), 0) AS rr,
            COALESCE(SUM(d1_rows_written), 0) AS rw
     FROM otlp_traces
     WHERE ${where.join(' AND ')}
     GROUP BY d1_query
     ORDER BY rr DESC
     LIMIT 40`,
    binds,
    warnings,
  );

  const readMap = new Map();
  const writeMap = new Map();
  for (const row of rows) {
    const tables = extractTableNamesFromSql(String(row.d1_query || ''));
    const rr = Number(row.rr) || 0;
    const rw = Number(row.rw) || 0;
    for (const t of tables) {
      readMap.set(t, (readMap.get(t) || 0) + rr);
      writeMap.set(t, (writeMap.get(t) || 0) + rw);
    }
  }

  const mostRead = [...readMap.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, v]) => ({
      name,
      val: `${formatActivityCount(v, 'rows')} · ${range}`,
      ds: /** @type {'d1'} */ ('d1'),
      sort: v,
    }));

  const mostWritten = [...writeMap.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, v]) => ({
      name,
      val: `${formatActivityCount(v, 'rows')} · ${range}`,
      ds: /** @type {'d1'} */ ('d1'),
      sort: v,
    }));

  return { mostRead, mostWritten };
}

export async function loadLastRetentionRun(db, warnings) {
  if (!db || !(await tableExists(db, 'agentsam_cron_runs'))) return null;
  const cols = await pragmaTableInfo(db, 'agentsam_cron_runs');
  if (!cols.has('started_at')) return null;
  const jobCol = cols.has('job_name') ? 'job_name' : cols.has('cron_job') ? 'cron_job' : null;
  if (!jobCol) return null;
  const row = await d1First(
    db,
    'last_retention',
    `SELECT started_at, status FROM agentsam_cron_runs
     WHERE ${jobCol} = 'one_am_compaction_pipeline'
     ORDER BY started_at DESC LIMIT 1`,
    [],
    warnings,
  );
  if (!row) return null;
  const status = String(row.status || 'unknown').toLowerCase();
  return {
    at: Number(row.started_at) || null,
    ok: !['error', 'failed'].includes(status),
    status,
  };
}

export async function loadD1StorageEstimate(db, warnings) {
  const row = await d1First(
    db,
    'd1_storage',
    'SELECT (page_count * page_size) AS bytes FROM pragma_page_count(), pragma_page_size()',
    [],
    warnings,
  );
  const usedBytes = Number(row?.bytes) || 0;
  if (usedBytes <= 0) return { usedBytes: null, limitBytes: D1_STORAGE_LIMIT_BYTES, wired: false };
  return { usedBytes, limitBytes: D1_STORAGE_LIMIT_BYTES, wired: true };
}

export async function loadD1SchemaHealth(db, warnings, limit = 8, maxScan = 24) {
  const tables = await d1All(
    db,
    'd1_schema_tables',
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
     ORDER BY name
     LIMIT ${Math.max(1, Math.min(maxScan, 80))}`,
    [],
    warnings,
  );

  const noPrimaryKey = [];
  const missingIndexes = [];

  for (const row of tables) {
    const tableName = String(row.name || '');
    if (!tableName) continue;
    const safe = tableName.replace(/"/g, '""');

    const info = await d1All(db, `d1_pk_${tableName}`, `PRAGMA table_info("${safe}")`, [], warnings);
    const hasPk = info.some((c) => Number(c.pk) > 0);
    if (!hasPk) {
      noPrimaryKey.push({ name: tableName, ds: 'd1', severity: 'warn' });
    }

    const indexes = await d1All(db, `d1_idx_${tableName}`, `PRAGMA index_list("${safe}")`, [], warnings);
    const hasUserIndex = indexes.some((ix) => {
      const n = String(ix.name || '');
      return n && !n.startsWith('sqlite_autoindex');
    });
    if (!hasUserIndex && !hasPk) {
      missingIndexes.push({ name: tableName, ds: 'd1', severity: 'warn' });
    }

    if (noPrimaryKey.length >= limit && missingIndexes.length >= limit) break;
  }

  return {
    noPrimaryKey: noPrimaryKey.slice(0, limit),
    missingIndexes: missingIndexes.slice(0, limit),
    fkIssues: [],
    wired: noPrimaryKey.length > 0 || missingIndexes.length > 0,
  };
}

export async function loadRecentDbEvents(db, scope, range, warnings) {
  if (!(await tableExists(db, 'agentsam_tool_call_log'))) return [];
  const cols = await pragmaTableInfo(db, 'agentsam_tool_call_log');
  if (!cols.has('created_at')) return [];

  const binds = [rangeStartSec(range)];
  const where = ['created_at >= ?', `(${SQL_DB_TOOL_D1} OR ${SQL_DB_TOOL_SUPABASE})`];
  where.push(...tenantWorkspaceClause({ ...scope, tableCols: cols }, binds));

  const detailExpr = cols.has('input_summary')
    ? `COALESCE(NULLIF(trim(input_summary), ''), tool_name)`
    : 'tool_name';

  const rows = await d1All(
    db,
    'db_recent_events',
    `SELECT tool_name, status, ${detailExpr} AS detail, created_at, COALESCE(duration_ms, 0) AS duration_ms
     FROM agentsam_tool_call_log
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 12`,
    binds,
    warnings,
  );

  return rows.map((r) => {
    const status = String(r.status || '').toLowerCase();
    const isErr = status === 'error' || status === 'failed';
    const ms = Number(r.duration_ms) || 0;
    const tool = String(r.tool_name || '');
    const ds = tool.includes('hyperdrive') ? 'supabase' : 'd1';
    let kind = 'ok';
    if (isErr) kind = 'err';
    else if (ms >= 1500) kind = 'warn';
    else if (tool.includes('schema') || tool.includes('write')) kind = 'info';

    const created = Number(r.created_at) || 0;
    const d = created ? new Date(created * 1000) : new Date();
    const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;

    return {
      time,
      kind,
      datasource: ds,
      label: isErr ? `${ds === 'supabase' ? 'Hyperdrive' : 'D1'} error` : `${ds === 'supabase' ? 'Hyperdrive' : 'D1'} query`,
      detail: String(r.detail || tool).slice(0, 200),
      meta: isErr ? ds : ms > 0 ? `${ms} ms` : ds,
      created_at: created,
    };
  });
}

/**
 * @param {any} env
 * @param {{ tenantId: string|null, workspaceId: string|null }} scope
 * @param {string} range
 * @param {string} ds
 */
export async function aggregateKpis(env, scope, range, ds, warnings) {
  const db = env?.DB;
  const start = rangeStartSec(range);
  const prevStart = start - rangeSeconds(range);
  const startNano = start * 1_000_000_000;
  const prevNano = prevStart * 1_000_000_000;

  let queries = 0;
  let queriesPrev = 0;
  let rowsRead = 0;
  let rowsReadPrev = 0;
  let rowsWritten = 0;
  let rowsWrittenPrev = 0;
  let errors = 0;
  let errorsPrev = 0;
  const durations = [];

  if (db && (ds === 'all' || ds === 'd1') && (await tableExists(db, 'otlp_traces'))) {
    const cols = await pragmaTableInfo(db, 'otlp_traces');
    const binds = [];
    const where = [`start_time_unix_nano >= ?`];
    binds.push(startNano);
    where.push(...tenantWorkspaceClause({ ...scope, tableCols: cols }, binds));

    const row = await d1First(
      db,
      'otlp_kpi',
      `SELECT
         COUNT(*) AS c,
         COALESCE(SUM(d1_rows_read), 0) AS rr,
         COALESCE(SUM(d1_rows_written), 0) AS rw,
         SUM(CASE WHEN LOWER(COALESCE(status_code,'')) = 'error' THEN 1 ELSE 0 END) AS err
       FROM otlp_traces WHERE ${where.join(' AND ')}`,
      binds,
      warnings,
    );
    queries += Number(row?.c ?? 0);
    rowsRead += Number(row?.rr ?? 0);
    rowsWritten += Number(row?.rw ?? 0);
    errors += Number(row?.err ?? 0);

    const scopeBinds = binds.slice(1);
    const prevRow = await d1First(
      db,
      'otlp_kpi_prev',
      `SELECT COUNT(*) AS c,
              COALESCE(SUM(d1_rows_read), 0) AS rr,
              COALESCE(SUM(d1_rows_written), 0) AS rw,
              SUM(CASE WHEN LOWER(COALESCE(status_code,'')) = 'error' THEN 1 ELSE 0 END) AS err
       FROM otlp_traces
       WHERE start_time_unix_nano >= ? AND start_time_unix_nano < ?
         ${scopeBinds.length ? `AND ${where.slice(1).join(' AND ')}` : ''}`,
      [prevNano, startNano, ...scopeBinds],
      warnings,
    );
    queriesPrev += Number(prevRow?.c ?? 0);
    rowsReadPrev += Number(prevRow?.rr ?? 0);
    rowsWrittenPrev += Number(prevRow?.rw ?? 0);
    errorsPrev += Number(prevRow?.err ?? 0);

    const durRows = await d1All(
      db,
      'otlp_dur',
      `SELECT CAST((end_time_unix_nano - start_time_unix_nano) / 1000000 AS INTEGER) AS ms
       FROM otlp_traces WHERE ${where.join(' AND ')} AND end_time_unix_nano > start_time_unix_nano
       LIMIT 500`,
      binds,
      warnings,
    );
    for (const d of durRows) {
      const ms = Number(d.ms);
      if (ms >= 0 && ms < 600_000) durations.push(ms);
    }
  }

  if (db && (await tableExists(db, 'agentsam_tool_call_log'))) {
    const cols = await pragmaTableInfo(db, 'agentsam_tool_call_log');
    const timeCol = cols.has('created_at') ? 'created_at' : null;
    if (timeCol) {
      const binds = [start];
      const where = [`${timeCol} >= ?`, dbToolClause(ds)];
      where.push(...tenantWorkspaceClause({ ...scope, tableCols: cols }, binds));

      const row = await d1First(
        db,
        'tcl_kpi',
        `SELECT COUNT(*) AS c,
                SUM(CASE WHEN LOWER(COALESCE(status,'')) IN ('error','failed') THEN 1 ELSE 0 END) AS err
         FROM agentsam_tool_call_log WHERE ${where.join(' AND ')}`,
        binds,
        warnings,
      );
      queries += Number(row?.c ?? 0);
      errors += Number(row?.err ?? 0);

      const prevBinds = [prevStart, start, ...binds.slice(1)];
      const prevRow = await d1First(
        db,
        'tcl_kpi_prev',
        `SELECT COUNT(*) AS c,
                SUM(CASE WHEN LOWER(COALESCE(status,'')) IN ('error','failed') THEN 1 ELSE 0 END) AS err
         FROM agentsam_tool_call_log
         WHERE ${timeCol} >= ? AND ${timeCol} < ? AND ${where.slice(1).join(' AND ')}`,
        prevBinds,
        warnings,
      );
      queriesPrev += Number(prevRow?.c ?? 0);
      errorsPrev += Number(prevRow?.err ?? 0);

      if (cols.has('duration_ms')) {
        const durRows = await d1All(
          db,
          'tcl_dur',
          `SELECT COALESCE(duration_ms, 0) AS ms FROM agentsam_tool_call_log
           WHERE ${where.join(' AND ')} AND COALESCE(duration_ms, 0) > 0 LIMIT 500`,
          binds,
          warnings,
        );
        for (const d of durRows) {
          const ms = Number(d.ms);
          if (ms >= 0 && ms <= 120_000) durations.push(ms);
        }
      }
    }
  }

  if (db && (ds === 'all' || ds === 'd1') && (await tableExists(db, 'agentsam_cron_runs'))) {
    const cols = await pragmaTableInfo(db, 'agentsam_cron_runs');
    if (cols.has('started_at')) {
      const binds = [start];
      const where = [`started_at >= ?`];
      where.push(...tenantWorkspaceClause({ ...scope, tableCols: cols }, binds));
      const row = await d1First(
        db,
        'cron_kpi',
        `SELECT COALESCE(SUM(rows_read),0) AS rr, COALESCE(SUM(rows_written),0) AS rw,
                SUM(CASE WHEN LOWER(COALESCE(status,'')) IN ('error','failed') THEN 1 ELSE 0 END) AS err
         FROM agentsam_cron_runs WHERE ${where.join(' AND ')}`,
        binds,
        warnings,
      );
      rowsRead += Number(row?.rr ?? 0);
      rowsWritten += Number(row?.rw ?? 0);
      errors += Number(row?.err ?? 0);

      const cronPrevBinds = [prevStart, start];
      const cronPrevWhere = ['started_at >= ?', 'started_at < ?'];
      cronPrevWhere.push(...tenantWorkspaceClause({ ...scope, tableCols: cols }, cronPrevBinds));
      const prevRow = await d1First(
        db,
        'cron_kpi_prev',
        `SELECT COALESCE(SUM(rows_read),0) AS rr, COALESCE(SUM(rows_written),0) AS rw
         FROM agentsam_cron_runs WHERE ${cronPrevWhere.join(' AND ')}`,
        cronPrevBinds,
        warnings,
      );
      rowsReadPrev += Number(prevRow?.rr ?? 0);
      rowsWrittenPrev += Number(prevRow?.rw ?? 0);
    }
  }

  if (db && (await tableExists(db, 'agentsam_error_log'))) {
    const cols = await pragmaTableInfo(db, 'agentsam_error_log');
    if (cols.has('created_at')) {
      const binds = [start];
      const where = [`created_at >= ?`];
      where.push(...tenantWorkspaceClause({ ...scope, tableCols: cols }, binds));
      const dbFilter = `(LOWER(COALESCE(source,'')) LIKE '%d1%'
        OR LOWER(COALESCE(source,'')) LIKE '%sql%'
        OR LOWER(COALESCE(source,'')) LIKE '%hyperdrive%'
        OR LOWER(COALESCE(error_message,'')) LIKE '%d1%'
        OR LOWER(COALESCE(error_message,'')) LIKE '%sql%'
        OR LOWER(COALESCE(error_message,'')) LIKE '%hyperdrive%')`;
      if (ds === 'd1') where.push(`(LOWER(COALESCE(source,'')) LIKE '%d1%' OR LOWER(COALESCE(error_message,'')) LIKE '%d1%')`);
      else if (ds === 'supabase') {
        where.push(`(LOWER(COALESCE(source,'')) LIKE '%hyperdrive%' OR LOWER(COALESCE(error_message,'')) LIKE '%postgres%')`);
      } else where.push(dbFilter);

      const row = await d1First(
        db,
        'err_kpi',
        `SELECT COUNT(*) AS c FROM agentsam_error_log WHERE ${where.join(' AND ')}`,
        binds,
        warnings,
      );
      const ec = Number(row?.c ?? 0);
      errors += ec;

      const prevRow = await d1First(
        db,
        'err_kpi_prev',
        `SELECT COUNT(*) AS c FROM agentsam_error_log
         WHERE created_at >= ? AND created_at < ? AND ${where.slice(1).join(' AND ')}`,
        [prevStart, start, ...binds.slice(1)],
        warnings,
      );
      errorsPrev += Number(prevRow?.c ?? 0);
    }
  }

  const toolRows = db
    ? await aggregateToolCallRowEstimates(db, scope, range, ds, warnings)
    : { rowsRead: 0, rowsWritten: 0, rowsReadPrev: 0, rowsWrittenPrev: 0 };
  rowsRead += toolRows.rowsRead;
  rowsWritten += toolRows.rowsWritten;
  rowsReadPrev += toolRows.rowsReadPrev;
  rowsWrittenPrev += toolRows.rowsWrittenPrev;

  const p95 = percentileMs(durations, 0.95);

  return {
    queries,
    queriesPrev,
    rowsRead,
    rowsReadPrev,
    rowsWritten,
    rowsWrittenPrev,
    errors,
    errorsPrev,
    p95Ms: p95,
  };
}

export async function loadTimeseriesBuckets(env, scope, range, ds, warnings) {
  const db = env?.DB;
  const labels = buildBucketLabels(range);
  const start = rangeStartSec(range);
  const startNano = start * 1_000_000_000;

  const d1Vol = new Map(labels.map((l) => [l, 0]));
  const supVol = new Map(labels.map((l) => [l, 0]));
  const d1Read = new Map(labels.map((l) => [l, 0]));
  const supRead = new Map(labels.map((l) => [l, 0]));
  const d1Write = new Map(labels.map((l) => [l, 0]));
  const supWrite = new Map(labels.map((l) => [l, 0]));
  const d1Err = new Map(labels.map((l) => [l, 0]));
  const supErr = new Map(labels.map((l) => [l, 0]));
  const latMs = [];

  const addRows = (rows, volMap, errMap, volKey = 'c') => {
    for (const r of rows) {
      const b = String(r.bucket ?? '');
      if (!volMap.has(b)) continue;
      volMap.set(b, (volMap.get(b) || 0) + (Number(r[volKey] ?? r.c ?? 0) || 0));
      if (errMap && r.err != null) errMap.set(b, (errMap.get(b) || 0) + (Number(r.err) || 0));
    }
  };

  if (db && (ds === 'all' || ds === 'd1') && (await tableExists(db, 'otlp_traces'))) {
    const cols = await pragmaTableInfo(db, 'otlp_traces');
    const binds = [startNano];
    const where = ['start_time_unix_nano >= ?'];
    where.push(...tenantWorkspaceClause({ ...scope, tableCols: cols }, binds));
    const bucket = bucketExpr(range, 'start_time_unix_nano / 1000000000');

    const rows = await d1All(
      db,
      'otlp_ts',
      `SELECT ${bucket} AS bucket,
              COUNT(*) AS c,
              COALESCE(SUM(d1_rows_read), 0) AS rr,
              COALESCE(SUM(d1_rows_written), 0) AS rw,
              SUM(CASE WHEN LOWER(COALESCE(status_code,'')) = 'error' THEN 1 ELSE 0 END) AS err
       FROM otlp_traces WHERE ${where.join(' AND ')}
       GROUP BY bucket ORDER BY bucket`,
      binds,
      warnings,
    );
    addRows(rows, d1Vol, d1Err);
    for (const r of rows) {
      const b = String(r.bucket ?? '');
      if (d1Read.has(b)) {
        d1Read.set(b, (d1Read.get(b) || 0) + Number(r.rr ?? 0));
        d1Write.set(b, (d1Write.get(b) || 0) + Number(r.rw ?? 0));
      }
    }
  }

  if (db && (await tableExists(db, 'agentsam_tool_call_log'))) {
    const cols = await pragmaTableInfo(db, 'agentsam_tool_call_log');
    if (cols.has('created_at')) {
      const binds = [start];
      const where = ['created_at >= ?', dbToolClause(ds)];
      where.push(...tenantWorkspaceClause({ ...scope, tableCols: cols }, binds));
      const bucket = bucketExpr(range, 'created_at');

      if (ds === 'all') {
        const scopeBinds = [start];
        const scopeWhere = ['created_at >= ?'];
        scopeWhere.push(...tenantWorkspaceClause({ ...scope, tableCols: cols }, scopeBinds));
        const d1Rows = await d1All(
          db,
          'tcl_ts_d1',
          `SELECT ${bucket} AS bucket, COUNT(*) AS c,
                  SUM(CASE WHEN LOWER(COALESCE(status,'')) IN ('error','failed') THEN 1 ELSE 0 END) AS err
           FROM agentsam_tool_call_log WHERE ${scopeWhere.join(' AND ')} AND ${SQL_DB_TOOL_D1}
           GROUP BY bucket ORDER BY bucket`,
          scopeBinds,
          warnings,
        );
        const supRows = await d1All(
          db,
          'tcl_ts_sup',
          `SELECT ${bucket} AS bucket, COUNT(*) AS c,
                  SUM(CASE WHEN LOWER(COALESCE(status,'')) IN ('error','failed') THEN 1 ELSE 0 END) AS err
           FROM agentsam_tool_call_log WHERE ${scopeWhere.join(' AND ')} AND ${SQL_DB_TOOL_SUPABASE}
           GROUP BY bucket ORDER BY bucket`,
          scopeBinds,
          warnings,
        );
        addRows(d1Rows, d1Vol, d1Err);
        addRows(supRows, supVol, supErr);
      } else {
        const includeRowEstimates = ds === 'supabase' && cols.has('output_json');
        const rowEstimateSql = includeRowEstimates
          ? `,
                  COALESCE(SUM(
                    CASE
                      WHEN json_valid(COALESCE(output_json, ''))
                       AND json_type(json_extract(output_json, '$.results')) = 'array'
                      THEN json_array_length(json_extract(output_json, '$.results'))
                      WHEN json_valid(COALESCE(output_json, ''))
                       AND json_extract(output_json, '$.row_count') IS NOT NULL
                      THEN CAST(json_extract(output_json, '$.row_count') AS INTEGER)
                      ELSE 0
                    END
                  ), 0) AS rr,
                  COALESCE(SUM(
                    CASE
                      WHEN json_valid(COALESCE(output_json, ''))
                       AND json_extract(output_json, '$.meta.changes') IS NOT NULL
                      THEN CAST(json_extract(output_json, '$.meta.changes') AS INTEGER)
                      WHEN json_valid(COALESCE(output_json, ''))
                       AND json_extract(output_json, '$.changes') IS NOT NULL
                      THEN CAST(json_extract(output_json, '$.changes') AS INTEGER)
                      ELSE 0
                    END
                  ), 0) AS rw`
          : '';
        const rows = await d1All(
          db,
          'tcl_ts',
          `SELECT ${bucket} AS bucket,
                  COUNT(*) AS c,
                  SUM(CASE WHEN LOWER(COALESCE(status,'')) IN ('error','failed') THEN 1 ELSE 0 END) AS err${rowEstimateSql}
           FROM agentsam_tool_call_log WHERE ${where.join(' AND ')}
           GROUP BY bucket ORDER BY bucket`,
          binds,
          warnings,
        );
        addRows(rows, ds === 'supabase' ? supVol : d1Vol, ds === 'supabase' ? supErr : d1Err);
        if (includeRowEstimates) {
          for (const r of rows) {
            const b = String(r.bucket ?? '');
            if (supRead.has(b)) {
              supRead.set(b, (supRead.get(b) || 0) + Number(r.rr ?? 0));
              supWrite.set(b, (supWrite.get(b) || 0) + Number(r.rw ?? 0));
            }
          }
        }
      }

      if (cols.has('duration_ms')) {
        const durRows = await d1All(
          db,
          'tcl_lat',
          `SELECT ${bucket} AS bucket, AVG(COALESCE(duration_ms,0)) AS avg_ms
           FROM agentsam_tool_call_log WHERE ${where.join(' AND ')} AND COALESCE(duration_ms,0) > 0
           GROUP BY bucket`,
          binds,
          warnings,
        );
        for (const r of durRows) latMs.push({ bucket: r.bucket, ms: Number(r.avg_ms) || 0 });
      }
    }
  }

  const toArr = (m) => labels.map((l) => m.get(l) ?? 0);

  return {
    labels,
    d1: toArr(d1Vol),
    supabase: toArr(supVol),
    reads: { d1: toArr(d1Read), supabase: toArr(supRead) },
    writes: { d1: toArr(d1Write), supabase: toArr(supWrite) },
    errors: { d1: toArr(d1Err), supabase: toArr(supErr) },
    latencyByBucket: latMs,
  };
}

/**
 * D1 binding ping + table count.
 * @param {any} env
 * @param {Array<{code:string,message:string,severity?:string}>} warnings
 */
export async function probeD1Health(env, warnings) {
  const out = {
    status: 'unknown',
    latencyMs: null,
    tableCount: null,
  };
  if (env?.DB) {
    const t0 = Date.now();
    const ping = await d1First(env.DB, 'd1_ping', 'SELECT 1 AS ok', [], warnings);
    out.latencyMs = Date.now() - t0;
    out.status = ping?.ok === 1 ? 'healthy' : 'degraded';

    const tc = await d1First(
      env.DB,
      'd1_tables',
      `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
      [],
      warnings,
    );
    out.tableCount = Number(tc?.c ?? 0) || 0;
  } else {
    warnings.push({
      code: 'D1_BINDING_MISSING',
      message: 'D1 binding not configured.',
      severity: 'warn',
    });
  }
  return out;
}

/** Lane-shaped helpers for Stage 3.5 dispatch. */
export const d1Lane = {
  async health(env, warnings) {
    return probeD1Health(env, warnings);
  },
  async storage(env, warnings) {
    return env?.DB ? loadD1StorageEstimate(env.DB, warnings) : { usedBytes: null, limitBytes: D1_STORAGE_LIMIT_BYTES, wired: false };
  },
  async kpis(env, scope, range, warnings) {
    return aggregateKpis(env, scope, range, 'd1', warnings);
  },
  async timeseries(env, scope, range, warnings) {
    return loadTimeseriesBuckets(env, scope, range, 'd1', warnings);
  },
  async hotTables(env, scope, range, warnings) {
    if (!env?.DB) return { largest: [], mostRead: [], mostWritten: [], count: 0 };
    const largest = await loadD1LargestTables(env.DB, warnings);
    const otlp = await loadD1OtlpHotTables(env.DB, scope, range, warnings);
    const tc = await d1First(
      env.DB,
      'd1_table_count',
      `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
      [],
      warnings,
    );
    return {
      count: Number(tc?.c ?? 0) || 0,
      largest,
      mostRead: otlp.mostRead,
      mostWritten: otlp.mostWritten,
    };
  },
  async schemaHealth(env, warnings) {
    if (!env?.DB) return { noPrimaryKey: [], missingIndexes: [], fkIssues: [], wired: false };
    return loadD1SchemaHealth(env.DB, warnings);
  },
  async recentEvents(env, scope, range, warnings) {
    if (!env?.DB) return [];
    const events = await loadRecentDbEvents(env.DB, scope, range, warnings);
    return events.filter((e) => e.datasource === 'd1');
  },
};

// Re-export GraphQL helpers used by cloudflare overview handler
export { fetchD1AnalyticsOverview, resolveCloudflareAnalyticsCreds };
export { DB } from '../../../../core/worker-bindings.js';
