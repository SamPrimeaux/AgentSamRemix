/**
 * GET /api/analytics/databases/summary
 * GET /api/analytics/databases/timeseries
 * GET /api/analytics/databases/tables
 * GET /api/analytics/databases/events
 *
 * Dual-lane dispatch (D1 + Supabase). Handlers merge lane results;
 * ds branching lives here only.
 */
import { analyticsResponse } from '../sources/normalize.js';
import { pragmaTableInfo, tableExists } from '../../../../backend/services/retention.js';
import {
  trim,
  d1All,
  d1First,
  parseDatabasesRange,
  parseDatabasesDs,
  parseDatabasesSurface,
  rangeSeconds,
  nowSec,
  rangeStartSec,
  rangeStartNano,
  tenantWorkspaceClause,
  SQL_DB_TOOL_D1,
  SQL_DB_TOOL_SUPABASE,
  dbToolClause,
  pctTrend,
  bucketExpr,
  buildBucketLabels,
  seriesFromRows,
  formatBytes,
  formatActivityCount,
  extractTableNamesFromSql,
  topHotTables,
  percentileMs,
  capacityLevel,
  formatRelativeEpoch,
  buildCapacityPayload,
  pgQualifiedName,
  kpiFromValues,
  D1_STORAGE_LIMIT_BYTES,
  SUPABASE_PROVISIONED_BYTES,
} from './shared.js';

export {
  parseDatabasesRange,
  parseDatabasesDs,
  parseDatabasesSurface,
} from './shared.js';

import {
  resolveAnalyticsDatabaseTarget,
  loadD1LargestTables,
  loadD1OtlpHotTables,
  loadLastRetentionRun,
  loadD1StorageEstimate,
  loadD1SchemaHealth,
  loadRecentDbEvents,
  aggregateKpis,
  loadTimeseriesBuckets,
  probeD1Health,
  DB,
  fetchD1AnalyticsOverview,
  resolveCloudflareAnalyticsCreds,
  d1Lane,
} from './lanes/d1-lane.js';

import {
  loadSupabaseOverviewPostgres,
  probeSupabaseHealth,
  supabaseLane,
} from './lanes/supabase-lane.js';

/** @type {Record<'d1'|'supabase', typeof d1Lane>} */
const LANE_MAP = {
  d1: d1Lane,
  supabase: supabaseLane,
};

/**
 * @param {'d1'|'supabase'|'all'} ds
 * @returns {Array<'d1'|'supabase'>}
 */
function lanesForDs(ds) {
  if (ds === 'd1') return ['d1'];
  if (ds === 'supabase') return ['supabase'];
  return ['d1', 'supabase'];
}


/**
 * @param {any} env
 * @param {{ tenantId: string|null, workspaceId: string|null }} scope
 * @param {Array<{code:string,message:string,severity?:string}>} warnings
 */
async function probeHealth(env, scope, warnings) {
  void scope;
  const out = {
    d1: { status: 'unknown', latencyMs: null, tableCount: null },
    supabase: { tableCount: null },
    hyperdrive: { status: 'unknown', latencyMs: null },
    errorRatePct: null,
    lastErrorAt: null,
  };

  out.d1 = await probeD1Health(env, warnings);
  const pg = await probeSupabaseHealth(env, warnings);
  out.supabase.tableCount = pg.tableCount;
  out.hyperdrive = pg.hyperdrive;
  return out;
}

export async function handleDatabasesSummary(request, url, env, { tenantId, workspaceId }) {
  void request;
  const range = parseDatabasesRange(url);
  const ds = parseDatabasesDs(url);
  const warnings = [];
  const wired = {
    kpis: false,
    miniStats: false,
    healthCards: false,
    envFilter: false,
  };

  if (url.searchParams.get('env') && url.searchParams.get('env') !== 'production') {
    warnings.push({
      code: 'ENV_FILTER_NOT_WIRED',
      message: 'Environment filter (staging/production) is not stored on telemetry rows yet.',
      severity: 'info',
    });
    wired.envFilter = false;
  }

  const scope = {
    tenantId: tenantId && String(tenantId).trim() ? String(tenantId).trim() : null,
    workspaceId: workspaceId && String(workspaceId).trim() ? String(workspaceId).trim() : null,
  };

  if (!scope.tenantId) {
    warnings.push({
      code: 'TENANT_ID_MISSING',
      message: 'No tenant_id on session; KPIs may be empty until the account is tenant-scoped.',
      severity: 'warn',
    });
  }

  const health = await probeHealth(env, scope, warnings);
  const d1Storage = env?.DB ? await loadD1StorageEstimate(env.DB, warnings) : { usedBytes: null, wired: false };
  const pgBundle = await loadSupabaseOverviewPostgres(env, warnings);
  const supStorage = pgBundle.supStorage;
  if (pgBundle.health?.hyperdrive?.status && pgBundle.health.hyperdrive.status !== 'unknown') {
    health.hyperdrive = pgBundle.health.hyperdrive;
    if (pgBundle.health.supabase?.tableCount != null) {
      health.supabase.tableCount = pgBundle.health.supabase.tableCount;
    }
  }
  const kpiRaw =
    ds === 'd1'
      ? await LANE_MAP.d1.kpis(env, scope, range, warnings)
      : ds === 'supabase'
        ? await LANE_MAP.supabase.kpis(env, scope, range, warnings)
        : await aggregateKpis(env, scope, range, ds, warnings);

  const hasSignal =
    kpiRaw.queries > 0 ||
    kpiRaw.rowsRead > 0 ||
    kpiRaw.rowsWritten > 0 ||
    kpiRaw.errors > 0 ||
    health.d1.tableCount > 0;

  if (hasSignal) wired.kpis = true;
  if (health.d1.tableCount != null || health.hyperdrive.status !== 'unknown') wired.miniStats = true;
  if (health.d1.status !== 'unknown' || health.hyperdrive.status !== 'unknown') wired.healthCards = true;

  if (!hasSignal) {
    warnings.push({
      code: 'DATABASES_TELEMETRY_EMPTY',
      message:
        'No database telemetry in this window. OTLP spans and agentsam_tool_call_log rows populate after agent/DB activity.',
      severity: 'info',
    });
  }

  const sectionNotices = [];
  if (!d1Storage.wired && !supStorage.wired) {
    warnings.push({
      code: 'SECTION_STORAGE_PARTIAL',
      message: 'Storage metrics unavailable — D1 pragma or Hyperdrive pg_database_size failed.',
      severity: 'info',
    });
  }

  const qTrend = pctTrend(kpiRaw.queries, kpiRaw.queriesPrev);
  const rrTrend = pctTrend(kpiRaw.rowsRead, kpiRaw.rowsReadPrev);
  const rwTrend = pctTrend(kpiRaw.rowsWritten, kpiRaw.rowsWrittenPrev);
  const errTrend = pctTrend(kpiRaw.errors, kpiRaw.errorsPrev);

  const errorRatePct = kpiRaw.queries > 0 ? (kpiRaw.errors / kpiRaw.queries) * 100 : 0;

  const storageParts = [];
  if (d1Storage.wired && d1Storage.usedBytes != null) storageParts.push(`D1 ${formatBytes(d1Storage.usedBytes)}`);
  if (supStorage.wired && supStorage.usedBytes != null) storageParts.push(`PG ${formatBytes(supStorage.usedBytes)}`);

  const miniStats = [
    {
      key: 'storage',
      label: 'Storage used',
      value: storageParts.length ? storageParts.join(' · ') : null,
      status: null,
      wired: Boolean(storageParts.length),
    },
    {
      key: 'tables',
      label: 'Tables',
      value:
        health.d1.tableCount != null && health.supabase.tableCount != null
          ? `${health.d1.tableCount} D1 · ${health.supabase.tableCount} PG`
          : health.d1.tableCount != null
            ? String(health.d1.tableCount)
            : health.supabase.tableCount != null
              ? `${health.supabase.tableCount} PG`
              : '—',
      status: 'healthy',
      wired: health.d1.tableCount != null || health.supabase.tableCount != null,
    },
    {
      key: 'hyperdrive',
      label: 'Hyperdrive',
      value: health.hyperdrive.status,
      status: health.hyperdrive.status,
      wired: health.hyperdrive.status !== 'unknown',
    },
    {
      key: 'd1Health',
      label: 'D1 health',
      value: health.d1.status,
      status: health.d1.status,
      wired: health.d1.status !== 'unknown',
    },
    {
      key: 'cost',
      label: 'Cost est.',
      value: null,
      status: null,
      wired: false,
    },
  ];

  const healthCards = {
    d1: {
      status: health.d1.status,
      lines: [
        health.d1.latencyMs != null ? `Probe: ${health.d1.latencyMs} ms` : 'Probe: —',
        health.d1.tableCount != null && health.supabase.tableCount != null
          ? `Tables: ${health.d1.tableCount} D1 · ${health.supabase.tableCount} PG`
          : health.d1.tableCount != null
            ? `Tables: ${health.d1.tableCount}`
            : health.supabase.tableCount != null
              ? `Tables: ${health.supabase.tableCount} PG`
              : 'Tables: —',
        'Source: D1 binding + OTLP',
      ],
      wired: true,
    },
    hyperdrive: {
      status: health.hyperdrive.status,
      lines: [
        health.hyperdrive.latencyMs != null ? `Probe: ${health.hyperdrive.latencyMs} ms` : 'Probe: —',
        'Pool size: not exposed by binding',
        'Source: Hyperdrive SELECT 1',
      ],
      wired: health.hyperdrive.status !== 'unknown',
    },
    supabase: {
      status: health.hyperdrive.status === 'healthy' ? 'healthy' : health.hyperdrive.status === 'error' ? 'error' : 'unknown',
      lines: [
        health.supabase.tableCount != null ? `Tables: ${health.supabase.tableCount} PG` : 'Tables: —',
        supStorage.wired && supStorage.usedBytes != null
          ? `Disk: ${formatBytes(supStorage.usedBytes)} / ${formatBytes(supStorage.limitBytes)}`
          : 'Disk: —',
        supStorage.connections != null ? `Connections: ${supStorage.connections}` : 'Connections: —',
      ],
      wired: health.hyperdrive.status !== 'unknown',
    },
    lastEvents: {
      status: kpiRaw.errors > 0 ? 'degraded' : 'healthy',
      lines: [
        `Errors in window: ${kpiRaw.errors}`,
        `Error rate: ${errorRatePct < 0.01 ? '<0.01' : errorRatePct.toFixed(2)}%`,
        'Recent tool calls: /api/analytics/databases/events',
      ],
      wired: true,
    },
  };

  return analyticsResponse({
    ok: true,
    backend: 'mixed',
    range,
    summary: {
      state: hasSignal ? 'live' : 'empty',
      ds,
      errorRatePct: Math.round(errorRatePct * 1000) / 1000,
    },
    wired,
    kpis: {
      queries: {
        value: kpiRaw.queries,
        trendPct: qTrend.pct,
        dir: qTrend.dir,
        wired: wired.kpis,
      },
      rowsRead: {
        value: kpiRaw.rowsRead,
        trendPct: rrTrend.pct,
        dir: rrTrend.dir,
        wired: wired.kpis,
      },
      rowsWritten: {
        value: kpiRaw.rowsWritten,
        trendPct: rwTrend.pct,
        dir: rwTrend.dir,
        wired: wired.kpis,
      },
      p95: {
        valueMs: kpiRaw.p95Ms,
        trendPct: 0,
        dir: 'neutral',
        wired: wired.kpis && kpiRaw.p95Ms > 0,
      },
      errors: {
        value: kpiRaw.errors,
        trendPct: errTrend.pct,
        dir: errTrend.dir,
        wired: wired.kpis,
      },
    },
    miniStats,
    healthCards,
    warnings,
    section_notices: sectionNotices,
    meta: {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
    },
  });
}

export async function handleDatabasesQueries(request, url, env, { tenantId, workspaceId }) {
  void request;
  const range = parseDatabasesRange(url);
  const ds = parseDatabasesDs(url);
  const warnings = [];
  const scope = {
    tenantId: tenantId && String(tenantId).trim() ? String(tenantId).trim() : null,
    workspaceId: workspaceId && String(workspaceId).trim() ? String(workspaceId).trim() : null,
  };
  const db = env?.DB;
  const start = rangeStartSec(range);
  /** @type {Array<Record<string, unknown>>} */
  const queries = [];

  if (db && (await tableExists(db, 'agentsam_tool_call_log'))) {
    const cols = await pragmaTableInfo(db, 'agentsam_tool_call_log');
    if (cols.has('created_at')) {
      const binds = [start];
      const where = ['created_at >= ?', dbToolClause(ds)];
      where.push(...tenantWorkspaceClause({ ...scope, tableCols: cols }, binds));
      const fpExpr = cols.has('input_summary')
        ? `COALESCE(NULLIF(trim(input_summary), ''), tool_name)`
        : 'tool_name';
      const rows = await d1All(
        db,
        'db_queries_fp',
        `SELECT
           ${fpExpr} AS fingerprint,
           tool_name,
           COUNT(*) AS call_count,
           AVG(COALESCE(duration_ms, 0)) AS avg_ms,
           MAX(created_at) AS last_seen,
           SUM(CASE WHEN LOWER(COALESCE(status,'')) IN ('error','failed') THEN 1 ELSE 0 END) AS err_count,
           SUM(CASE
             WHEN json_valid(COALESCE(output_json, ''))
              AND json_type(json_extract(output_json, '$.results')) = 'array'
             THEN json_array_length(json_extract(output_json, '$.results'))
             ELSE 0
           END) AS rows_read_est
         FROM agentsam_tool_call_log
         WHERE ${where.join(' AND ')}
         GROUP BY fingerprint, tool_name
         ORDER BY call_count DESC
         LIMIT 40`,
        binds,
        warnings,
      );
      const totalCalls = rows.reduce((s, r) => s + (Number(r.call_count) || 0), 0) || 1;
      for (const r of rows) {
        const toolName = String(r.tool_name || '');
        const dsLabel = toolName.includes('hyperdrive') ? 'supabase' : 'd1';
        const avgMs = Math.round(Number(r.avg_ms) || 0);
        queries.push({
          fingerprint: String(r.fingerprint || toolName).slice(0, 240),
          tool_name: toolName,
          datasource: toolName.includes('hyperdrive') ? 'supabase' : dsLabel,
          call_count: Number(r.call_count) || 0,
          runtime_pct: Math.round(((Number(r.call_count) || 0) / totalCalls) * 1000) / 10,
          avg_ms: avgMs,
          p50_ms: avgMs,
          p99_ms: Math.min(120_000, Math.round(avgMs * 3)),
          rows_read: Number(r.rows_read_est) || 0,
          rows_per_run:
            Number(r.call_count) > 0
              ? Math.round((Number(r.rows_read_est) || 0) / Number(r.call_count))
              : 0,
          errors: Number(r.err_count) || 0,
          last_seen: Number(r.last_seen) || null,
        });
      }
    }
  }

  return analyticsResponse({
    ok: true,
    backend: 'd1_registry',
    range,
    ds,
    queries,
    wired: queries.length > 0,
    warnings,
    meta: { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
  });
}

export async function handleDatabasesTimeseries(request, url, env, { tenantId, workspaceId }) {
  void request;
  const range = parseDatabasesRange(url);
  const ds = parseDatabasesDs(url);
  const warnings = [];
  const scope = {
    tenantId: tenantId && String(tenantId).trim() ? String(tenantId).trim() : null,
    workspaceId: workspaceId && String(workspaceId).trim() ? String(workspaceId).trim() : null,
  };

  const buckets =
    ds === 'd1'
      ? await LANE_MAP.d1.timeseries(env, scope, range, warnings)
      : ds === 'supabase'
        ? await LANE_MAP.supabase.timeseries(env, scope, range, warnings)
        : await loadTimeseriesBuckets(env, scope, range, ds, warnings);
  const { labels, d1, supabase, reads, writes, errors, latencyByBucket } = buckets;

  const totalD1 = d1.map((v, i) => v + (supabase[i] || 0));
  const hasData = totalD1.some((v) => v > 0) || d1.some((v) => v > 0) || supabase.some((v) => v > 0);

  if (!hasData) {
    warnings.push({
      code: 'DATABASES_TIMESERIES_EMPTY',
      message: 'No hourly/daily database activity in this window for the selected datasource.',
      severity: 'info',
    });
  }

  const latMap = new Map(latencyByBucket.map((r) => [String(r.bucket), Number(r.ms) || 0]));
  const p50Series = labels.map((l) => latMap.get(l) ?? 0);
  const p95Series = p50Series.map((v) => +(v * 2.5).toFixed(2));
  const p99Series = p50Series.map((v) => +(v * 4).toFixed(2));

  const sumQueries = d1.reduce((a, b) => a + b, 0) + supabase.reduce((a, b) => a + b, 0);
  const sumErrors = errors.d1.reduce((a, b) => a + b, 0) + errors.supabase.reduce((a, b) => a + b, 0);
  const errorRatePct = sumQueries > 0 ? (sumErrors / sumQueries) * 100 : 0;

  const headlineP50 = p50Series.filter((v) => v > 0);
  const p50Headline = headlineP50.length
    ? headlineP50.reduce((a, b) => a + b, 0) / headlineP50.length
    : 0;

  return analyticsResponse({
    ok: true,
    backend: 'mixed',
    range,
    summary: { ds, wired: hasData },
    series: [],
    breakdowns: [
      {
        key: 'hero',
        labels,
        total: { d1, supabase },
        reads: reads,
        writes: writes,
        errors: errors,
      },
      {
        key: 'latency',
        labels,
        p50: p50Series,
        p95: p95Series,
        p99: p99Series,
        headlineMs: { p50: p50Headline, p95: p50Headline * 2.5, p99: p50Headline * 4 },
      },
      {
        key: 'errorChart',
        labels,
        ratePct: errorRatePct,
        d1: errors.d1,
        supabase: errors.supabase,
      },
    ],
    warnings,
    meta: { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
  });
}

export async function handleDatabasesTables(request, url, env, { tenantId, workspaceId }) {
  void request;
  const range = parseDatabasesRange(url);
  const ds = parseDatabasesDs(url);
  const warnings = [];
  const scope = {
    tenantId: tenantId && String(tenantId).trim() ? String(tenantId).trim() : null,
    workspaceId: workspaceId && String(workspaceId).trim() ? String(workspaceId).trim() : null,
  };

  /** @type {Array<{ name: string, val: string, ds: 'd1'|'supabase', sort: number }>} */
  let largestPool = [];
  /** @type {Array<{ name: string, val: string, ds: 'd1'|'supabase', sort: number }>} */
  let readPool = [];
  /** @type {Array<{ name: string, val: string, ds: 'd1'|'supabase', sort: number }>} */
  let writePool = [];

  let d1Count = 0;
  let supabaseCount = null;

  if ((ds === 'all' || ds === 'd1') && env?.DB) {
    const tc = await d1First(
      env.DB,
      'd1_table_count',
      `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
      [],
      warnings,
    );
    d1Count = Number(tc?.c ?? 0) || 0;

    largestPool.push(...(await loadD1LargestTables(env.DB, warnings)));
    const otlpHot = await loadD1OtlpHotTables(env.DB, scope, range, warnings);
    readPool.push(...otlpHot.mostRead);
    writePool.push(...otlpHot.mostWritten);

    if (!largestPool.some((x) => x.ds === 'd1') && d1Count > 0) {
      warnings.push({
        code: 'D1_SIZE_ESTIMATE_ONLY',
        message: 'D1 largest tables use row-count estimates (remote D1 has no dbstat).',
        severity: 'info',
      });
    }
  }

  /** @type {{ noPrimaryKey: Array<{name:string,ds:string,severity:string}>, missingIndexes: Array<{name:string,ds:string,severity:string}>, fkIssues: Array<{name:string,ds:string,severity:string}>, wired: boolean }} */
  let schemaHealth = { noPrimaryKey: [], missingIndexes: [], fkIssues: [], wired: false };
  let pgBundle = null;
  if (ds === 'all' || ds === 'supabase') {
    pgBundle = await loadSupabaseOverviewPostgres(env, warnings);
    const pg = pgBundle.pgHot;
    if (pg.count != null) supabaseCount = pg.count;
    largestPool.push(...pg.largest);
    readPool.push(...pg.mostRead);
    writePool.push(...pg.mostWritten);
  }

  if ((ds === 'all' || ds === 'd1') && env?.DB) {
    const d1Health = await loadD1SchemaHealth(env.DB, warnings);
    schemaHealth.noPrimaryKey.push(...d1Health.noPrimaryKey);
    schemaHealth.missingIndexes.push(...d1Health.missingIndexes);
    schemaHealth.wired = true;
  }
  if (ds === 'all' || ds === 'supabase') {
    const pgHealth = pgBundle?.pgSchema || { noPrimaryKey: [], missingIndexes: [], fkIssues: [], wired: false };
    schemaHealth.noPrimaryKey.push(...pgHealth.noPrimaryKey);
    schemaHealth.missingIndexes.push(...pgHealth.missingIndexes);
    schemaHealth.fkIssues.push(...pgHealth.fkIssues);
    schemaHealth.wired = schemaHealth.wired || pgHealth.wired;
  }

  const d1Storage = env?.DB ? await loadD1StorageEstimate(env.DB, warnings) : { usedBytes: null, limitBytes: D1_STORAGE_LIMIT_BYTES, wired: false };
  const supStorage = pgBundle?.supStorage || {
    usedBytes: null,
    limitBytes: SUPABASE_PROVISIONED_BYTES,
    connections: null,
    largeObjects: [],
    wired: false,
  };

  const largest = topHotTables(largestPool, ds, 5);
  const mostRead = topHotTables(readPool, ds, 5);
  const mostWritten = topHotTables(writePool, ds, 5);

  const totalTables =
    (ds === 'supabase' ? 0 : d1Count) + (supabaseCount != null ? supabaseCount : 0);

  const hotWired =
    largest.length > 0 ||
    mostRead.length > 0 ||
    mostWritten.length > 0 ||
    d1Count > 0 ||
    (supabaseCount != null && supabaseCount > 0);

  if (!hotWired) {
    warnings.push({
      code: 'DATABASES_TABLES_EMPTY',
      message: 'No table inventory returned for the selected datasource filter.',
      severity: 'info',
    });
  }

  if (readPool.length === 0 && (ds === 'all' || ds === 'd1')) {
    warnings.push({
      code: 'D1_OTLP_READ_HOT_EMPTY',
      message:
        'D1 “most read” uses OTLP d1_rows_read in this window; empty until spans record SQL + row counts.',
      severity: 'info',
    });
  }

  if (readPool.some((x) => x.ds === 'supabase') || ds === 'supabase') {
    warnings.push({
      code: 'PG_STATS_CUMULATIVE',
      message:
        'Postgres read/write ranks use pg_stat_user_tables (cumulative since stats reset), not the time range filter.',
      severity: 'info',
    });
  }

  return analyticsResponse({
    ok: true,
    backend: 'mixed',
    range,
    summary: {
      ds,
      counts: {
        d1: d1Count,
        supabase: supabaseCount,
        total: totalTables,
      },
      wired: { hotTables: hotWired },
    },
    breakdowns: [
      {
        key: 'hotTables',
        largest,
        mostRead,
        mostWritten,
      },
      {
        key: 'schemaHealth',
        noPrimaryKey: schemaHealth.noPrimaryKey,
        missingIndexes: schemaHealth.missingIndexes,
        fkIssues: schemaHealth.fkIssues,
        wired: schemaHealth.wired,
      },
      {
        key: 'storage',
        d1: {
          usedBytes: d1Storage.usedBytes,
          limitBytes: d1Storage.limitBytes,
          usedLabel: d1Storage.usedBytes != null ? formatBytes(d1Storage.usedBytes) : null,
          limitLabel: formatBytes(d1Storage.limitBytes),
          pctUsed:
            d1Storage.usedBytes != null && d1Storage.limitBytes > 0
              ? Math.round((d1Storage.usedBytes / d1Storage.limitBytes) * 1000) / 10
              : null,
          tableCount: d1Count,
          wired: d1Storage.wired,
        },
        supabase: {
          usedBytes: supStorage.usedBytes,
          limitBytes: supStorage.limitBytes,
          usedLabel: supStorage.usedBytes != null ? formatBytes(supStorage.usedBytes) : null,
          limitLabel: formatBytes(supStorage.limitBytes),
          pctUsed:
            supStorage.usedBytes != null && supStorage.limitBytes > 0
              ? Math.round((supStorage.usedBytes / supStorage.limitBytes) * 1000) / 10
              : null,
          connections: supStorage.connections,
          largeObjects: supStorage.largeObjects,
          tableCount: supabaseCount,
          wired: supStorage.wired,
        },
      },
    ],
    warnings,
    meta: { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
  });
}

export async function handleDatabasesEvents(request, url, env, { tenantId, workspaceId }) {
  void request;
  const range = parseDatabasesRange(url);
  const ds = parseDatabasesDs(url);
  const warnings = [];
  const scope = {
    tenantId: tenantId && String(tenantId).trim() ? String(tenantId).trim() : null,
    workspaceId: workspaceId && String(workspaceId).trim() ? String(workspaceId).trim() : null,
  };

  let events = [];
  if (env?.DB && (ds === 'all' || ds === 'd1' || ds === 'supabase')) {
    events = await loadRecentDbEvents(env.DB, scope, range, warnings);
    if (ds !== 'all') {
      events = events.filter((e) => e.datasource === ds);
    }
  }

  return analyticsResponse({
    ok: true,
    backend: 'd1_registry',
    range,
    ds,
    events,
    wired: events.length > 0,
    warnings,
    meta: { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
  });
}

/**
 * GET /api/analytics/databases/overview?surface=cloudflare|supabase&range=24h
 * Bundled surface-specific database observability (single round-trip).
 */
export async function handleDatabasesOverview(request, url, env, { tenantId, workspaceId }) {
  const range = parseDatabasesRange(url);
  const surface = parseDatabasesSurface(url);
  const dbTarget = await resolveAnalyticsDatabaseTarget(
    env,
    request,
    workspaceId,
    url.searchParams.get('database_id'),
  );
  if (dbTarget.error) {
    return analyticsResponse({
      ok: false,
      surface,
      range,
      wired: false,
      database: null,
      warnings: [
        {
          code: dbTarget.error.toUpperCase(),
          message:
            dbTarget.error === 'd1_analytics_resource_denied'
              ? 'That D1 database is not in your authorized catalog.'
              : 'Select a D1 database to load analytics.',
          severity: 'warn',
        },
      ],
      status: dbTarget.status || 400,
    });
  }
  const databaseId = trim(dbTarget.id);
  const databaseName = trim(dbTarget.name);
  const isPlatformDb = databaseId === DB.database_id;
  const warnings = [];
  const scope = {
    tenantId: tenantId && String(tenantId).trim() ? String(tenantId).trim() : null,
    workspaceId: workspaceId && String(workspaceId).trim() ? String(workspaceId).trim() : null,
  };

  if (surface === 'cloudflare') {
    const cfCacheScope = scope.workspaceId || scope.tenantId || databaseId || 'platform';
    const cfCacheKey = `db_overview:cloudflare:v2:${cfCacheScope}:${databaseId}:${range}`;
    const cfKv = env?.SESSION_CACHE || env?.KV || null;
    if (cfKv) {
      try {
        const raw = await cfKv.get(cfCacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.cachedAt && Date.now() - parsed.cachedAt < 180_000 && parsed.data) {
            return analyticsResponse(parsed.data);
          }
        }
      } catch {
        /* ignore cache read errors */
      }
    }

    const creds = resolveCloudflareAnalyticsCreds(env);
    const includeSchema = url.searchParams.get('include_schema') === '1';
    if (!creds) {
      warnings.push({
        code: 'CF_GRAPHQL_CREDS_MISSING',
        message: 'CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN not configured.',
        severity: 'warn',
      });
    }

    const gqlPromise = creds
      ? fetchD1AnalyticsOverview(env, {
          accountId: creds.accountId,
          token: creds.token,
          databaseId,
          range,
        }).catch((e) => {
          warnings.push({
            code: 'CF_GRAPHQL_FAILED',
            message: `Cloudflare GraphQL: ${String(e?.message || e)}`,
            severity: 'warn',
          });
          return null;
        })
      : Promise.resolve(null);

    const [gql, tableCountRow, retention, d1Schema] = await Promise.all([
      gqlPromise,
      isPlatformDb && env?.DB
        ? d1First(
            env.DB,
            'd1_table_count_overview',
            `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`,
            [],
            warnings,
          )
        : Promise.resolve(null),
      isPlatformDb && env?.DB ? loadLastRetentionRun(env.DB, warnings) : Promise.resolve(null),
      isPlatformDb && env?.DB && includeSchema
        ? loadD1SchemaHealth(env.DB, warnings, 8, 24)
        : Promise.resolve({ noPrimaryKey: [], missingIndexes: [], fkIssues: [], wired: false }),
    ]);
    const tableCount = tableCountRow != null ? Number(tableCountRow?.c ?? 0) || 0 : null;

    const wired = Boolean(gql?.wired);
    const kpis = gql?.kpis ?? {};
    const storageBytes = kpis.storageBytes ?? 0;

    const retentionAgeSec = retention?.at ? Math.floor(Date.now() / 1000) - retention.at : null;
    const retentionFresh = retentionAgeSec != null && retentionAgeSec < 26 * 3600;
    const retentionLabel = isPlatformDb
      ? retention?.at
        ? `Retention ${retention.ok ? '✓' : '!'} · ${formatRelativeEpoch(retention.at)}`
        : 'Retention not logged'
      : null;

    const cfPayload = {
      ok: true,
      backend: gql?.source ?? 'mixed',
      surface,
      range,
      database: { id: databaseId, name: databaseName },
      wired,
      summary: { state: wired ? 'live' : 'empty', surface },
      kpis: {
        queries: kpiFromValues(kpis.queries ?? 0, kpis.queriesPrev ?? 0, wired),
        rowsRead: kpiFromValues(kpis.rowsRead ?? 0, kpis.rowsReadPrev ?? 0, wired),
        rowsWritten: kpiFromValues(kpis.rowsWritten ?? 0, kpis.rowsWrittenPrev ?? 0, wired),
        storage: {
          value: storageBytes,
          valueLabel: storageBytes > 0 ? formatBytes(storageBytes) : null,
          trendPct: 0,
          dir: 'neutral',
          wired: storageBytes > 0,
        },
        tables: {
          value: tableCount ?? 0,
          trendPct: 0,
          dir: 'neutral',
          wired: tableCount != null,
        },
        p95: kpiFromValues(kpis.p95Ms ?? 0, 0, wired && (kpis.p95Ms ?? 0) > 0, true),
        errors: kpiFromValues(0, 0, false),
      },
      capacity: buildCapacityPayload({
        usedBytes: storageBytes > 0 ? storageBytes : null,
        limitBytes: D1_STORAGE_LIMIT_BYTES,
        limitLabel: formatBytes(D1_STORAGE_LIMIT_BYTES),
        subtitle: retentionLabel,
        subtitleOk: Boolean(retention?.ok && retentionFresh),
        retentionAt: retention?.at ?? null,
        retentionOk: retention?.ok ?? null,
      }),
      charts: gql?.charts ?? {
        labels: [],
        totalQueries: [],
        readQueries: [],
        writeQueries: [],
        rowsRead: [],
        rowsWritten: [],
        latencyP50: [],
        latencyP95: [],
        latencyP99: [],
        headlineMs: { p50: 0, p95: 0, p99: 0 },
      },
      queries: gql?.queries ?? [],
      storage: {
        usedBytes: storageBytes || null,
        limitBytes: D1_STORAGE_LIMIT_BYTES,
        usedLabel: storageBytes > 0 ? formatBytes(storageBytes) : null,
        limitLabel: formatBytes(D1_STORAGE_LIMIT_BYTES),
        pctUsed:
          storageBytes > 0
            ? Math.round((storageBytes / D1_STORAGE_LIMIT_BYTES) * 1000) / 10
            : null,
        tableCount,
        wired: storageBytes > 0,
      },
      schemaHealth: {
        noPrimaryKey: d1Schema.noPrimaryKey,
        missingIndexes: d1Schema.missingIndexes,
        fkIssues: d1Schema.fkIssues ?? [],
        wired: d1Schema.wired,
      },
      warnings,
      meta: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        analyticsSource: gql?.source ?? null,
        analyticsWindow: gql?.window ?? null,
      },
    };

    if (cfKv) {
      try {
        await cfKv.put(
          cfCacheKey,
          JSON.stringify({ cachedAt: Date.now(), data: cfPayload }),
          { expirationTtl: 120 },
        );
      } catch {
        /* ignore cache write errors */
      }
    }

    return analyticsResponse(cfPayload);
  }

  // Tenant-scoped short-lived cache. Key MUST include workspace/tenant so one
  // tenant's Supabase overview can never be served back to a different tenant.
  const ds = 'supabase';
  const supCacheScope = scope.workspaceId || scope.tenantId || 'platform';
  const supCacheKey = `db_overview:supabase:v2:${supCacheScope}:${range}`;
  const supKv = env?.SESSION_CACHE || env?.KV || null;
  let supCached = null;
  if (supKv) {
    try {
      const raw = await supKv.get(supCacheKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.cachedAt && Date.now() - parsed.cachedAt < 180_000) {
          supCached = parsed.data;
        }
      }
    } catch {
      /* ignore cache read errors */
    }
  }

  let health, supStorage, pgHot, pgOps, pgSchema, buckets, kpiRaw, queryRows, queryWarnings = [];
  if (supCached) {
    ({
      health,
      supStorage,
      pgHot,
      pgOps,
      pgSchema,
      buckets,
      kpiRaw,
      queryRows,
      queryWarnings = [],
    } = supCached);
  } else {
    const [pgBundle, bucketsR, kpiRawR] = await Promise.all([
      loadSupabaseOverviewPostgres(env, warnings),
      LANE_MAP.supabase.timeseries(env, scope, range, warnings),
      LANE_MAP.supabase.kpis(env, scope, range, warnings),
    ]);
    health = pgBundle.health;
    supStorage = pgBundle.supStorage;
    pgHot = pgBundle.pgHot;
    pgOps = pgBundle.pgOps;
    pgSchema = pgBundle.pgSchema;
    buckets = bucketsR;
    kpiRaw = kpiRawR;
    queryRows = [];
    queryWarnings = [];

    if (supKv) {
      try {
        await supKv.put(
          supCacheKey,
          JSON.stringify({
            cachedAt: Date.now(),
            data: {
              health,
              supStorage,
              pgHot,
              pgOps,
              pgSchema,
              buckets,
              kpiRaw,
              queryRows,
              queryWarnings,
            },
          }),
          { expirationTtl: 120 },
        );
      } catch {
        /* ignore cache write errors */
      }
    }
  }

  const { labels, d1: _d1, supabase, reads, writes, latencyByBucket } = buckets;
  const latMap = new Map(latencyByBucket.map((r) => [String(r.bucket), Number(r.ms) || 0]));
  const p50Series = labels.map((l) => latMap.get(l) ?? 0);
  const hasSignal =
    kpiRaw.queries > 0 ||
    supStorage.wired ||
    (pgHot.count != null && pgHot.count > 0) ||
    health.hyperdrive.status === 'healthy';

  if (pgHot.count != null) {
    warnings.push({
      code: 'PG_STATS_CUMULATIVE',
      message:
        'Postgres read/write ranks use pg_stat_user_tables (cumulative since stats reset), not the time range filter.',
      severity: 'info',
    });
  }

  const qTrend = pctTrend(kpiRaw.queries, kpiRaw.queriesPrev);
  const rrTrend = pctTrend(kpiRaw.rowsRead, kpiRaw.rowsReadPrev);
  const rwTrend = pctTrend(kpiRaw.rowsWritten, kpiRaw.rowsWrittenPrev);

  const headlineP50 = p50Series.filter((v) => v > 0);
  const p50Headline = headlineP50.length
    ? headlineP50.reduce((a, b) => a + b, 0) / headlineP50.length
    : 0;

  const connUsed = supStorage.connections ?? null;
  const connMax = pgOps.maxConnections ?? null;
  const connPct =
    connUsed != null && connMax != null && connMax > 0
      ? Math.round((connUsed / connMax) * 1000) / 10
      : null;
  const hdOk = health.hyperdrive.status === 'healthy';
  const hdLabel = hdOk
    ? `Hyperdrive ✓ · ${health.hyperdrive.latencyMs ?? '—'}ms`
    : `Hyperdrive ${health.hyperdrive.status}`;
  const autoLabel = pgOps.lastAutovacuumAt
    ? `Autovacuum · ${formatRelativeEpoch(pgOps.lastAutovacuumAt)}`
    : 'Autovacuum —';
  const connLabel =
    connUsed != null && connMax != null ? `Connections ${connUsed}/${connMax}` : null;

  return analyticsResponse({
    ok: true,
    backend: 'hyperdrive',
    surface,
    range,
    wired: hasSignal,
    summary: { state: hasSignal ? 'live' : 'empty', surface },
    kpis: {
      queries: {
        value: kpiRaw.queries,
        trendPct: qTrend.pct,
        dir: qTrend.dir,
        wired: kpiRaw.queries > 0,
      },
      rowsRead: {
        value: kpiRaw.rowsRead,
        trendPct: rrTrend.pct,
        dir: rrTrend.dir,
        wired: kpiRaw.rowsRead > 0,
      },
      rowsWritten: {
        value: kpiRaw.rowsWritten,
        trendPct: rwTrend.pct,
        dir: rwTrend.dir,
        wired: kpiRaw.rowsWritten > 0,
      },
      storage: {
        value: supStorage.usedBytes ?? 0,
        valueLabel: supStorage.usedBytes != null ? formatBytes(supStorage.usedBytes) : null,
        trendPct: 0,
        dir: 'neutral',
        wired: supStorage.wired,
      },
      tables: {
        value: pgHot.count ?? 0,
        trendPct: 0,
        dir: 'neutral',
        wired: pgHot.count != null && pgHot.count > 0,
      },
      connections: {
        value: supStorage.connections ?? 0,
        trendPct: 0,
        dir: 'neutral',
        wired: supStorage.connections != null,
      },
      p95: {
        valueMs: kpiRaw.p95Ms,
        trendPct: 0,
        dir: 'neutral',
        wired: kpiRaw.p95Ms > 0,
      },
      errors: {
        value: kpiRaw.errors,
        trendPct: pctTrend(kpiRaw.errors, kpiRaw.errorsPrev).pct,
        dir: pctTrend(kpiRaw.errors, kpiRaw.errorsPrev).dir,
        wired: kpiRaw.errors > 0,
      },
    },
    capacity: buildCapacityPayload({
      usedBytes: supStorage.usedBytes,
      limitBytes: supStorage.limitBytes,
      limitLabel: formatBytes(supStorage.limitBytes),
      subtitle: [hdLabel, connLabel, autoLabel].filter(Boolean).join(' · '),
      subtitleOk: hdOk && (connPct == null || connPct < 80),
      autovacuumAt: pgOps.lastAutovacuumAt,
      connectionsUsed: connUsed,
      connectionsMax: connMax,
      hyperdriveStatus: health.hyperdrive.status,
      hyperdriveLatencyMs: health.hyperdrive.latencyMs,
    }),
    charts: {
      labels,
      totalQueries: supabase,
      readQueries: reads.supabase,
      writeQueries: writes.supabase,
      rowsRead: reads.supabase,
      rowsWritten: writes.supabase,
      latencyP50: p50Series,
      latencyP95: p50Series.map((v) => +(v * 2.5).toFixed(2)),
      latencyP99: p50Series.map((v) => +(v * 4).toFixed(2)),
      headlineMs: { p50: p50Headline, p95: p50Headline * 2.5, p99: p50Headline * 4 },
    },
    queries: queryRows,
    storage: {
      usedBytes: supStorage.usedBytes,
      limitBytes: supStorage.limitBytes,
      usedLabel: supStorage.usedBytes != null ? formatBytes(supStorage.usedBytes) : null,
      limitLabel: formatBytes(supStorage.limitBytes),
      pctUsed:
        supStorage.usedBytes != null && supStorage.limitBytes > 0
          ? Math.round((supStorage.usedBytes / supStorage.limitBytes) * 1000) / 10
          : null,
      connections: supStorage.connections,
      largeObjects: supStorage.largeObjects,
      tableCount: pgHot.count,
      wired: supStorage.wired,
    },
    hotTables: {
      largest: pgHot.largest,
      mostRead: pgHot.mostRead,
      mostWritten: pgHot.mostWritten,
    },
    schemaHealth: {
      noPrimaryKey: pgSchema.noPrimaryKey,
      missingIndexes: pgSchema.missingIndexes,
      fkIssues: pgSchema.fkIssues,
      wired: pgSchema.wired,
    },
    health: {
      hyperdrive: health.hyperdrive.status,
      latencyMs: health.hyperdrive.latencyMs,
    },
    warnings: [...warnings, ...queryWarnings],
    meta: { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
  });
}
