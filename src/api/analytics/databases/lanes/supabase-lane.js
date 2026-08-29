/**
 * Supabase / Hyperdrive analytics lane — mechanical peel from databases.js.
 * Canonical PG probe: loadSupabaseOverviewPostgres (single transaction).
 */
import {
  isHyperdriveUsable,
  runHyperdriveQuery,
  runHyperdriveTransaction,
} from '../../../../../backend/services/database/hyperdrive.js';
import {
  formatBytes,
  formatActivityCount,
  pgQualifiedName,
  SUPABASE_PROVISIONED_BYTES,
  rangeSeconds,
  rangeStartSec,
  bucketExpr,
  buildBucketLabels,
  nowSec,
} from '../shared.js';
import { aggregateKpis, loadTimeseriesBuckets, loadRecentDbEvents } from './d1-lane.js';
import {
  loadPgStatDeltaKpis,
  loadPgStatDeltaTimeseries,
} from '../../../../../backend/services/analytics/pg-stat-snapshot.js';

export function parsePgStatUserTableRows(rows) {
  const largest = [];
  const mostRead = [];
  const mostWritten = [];
  for (const row of rows) {
    const schema = String(row.schemaname || 'public');
    const rel = String(row.relname || '');
    if (!rel) continue;
    const name = pgQualifiedName(schema, rel);
    const sizeBytes = Number(row.size_bytes) || 0;
    const readCount = Number(row.read_count) || 0;
    const writeCount = Number(row.write_count) || 0;
    largest.push({
      name,
      val: formatBytes(sizeBytes),
      ds: /** @type {'supabase'} */ ('supabase'),
      sort: sizeBytes,
    });
    mostRead.push({
      name,
      val: `${formatActivityCount(readCount, 'scans')} · cumulative`,
      ds: /** @type {'supabase'} */ ('supabase'),
      sort: readCount,
    });
    mostWritten.push({
      name,
      val: `${formatActivityCount(writeCount, 'tuples')} · cumulative`,
      ds: /** @type {'supabase'} */ ('supabase'),
      sort: writeCount,
    });
  }

  largest.sort((a, b) => b.sort - a.sort);
  mostRead.sort((a, b) => b.sort - a.sort);
  mostWritten.sort((a, b) => b.sort - a.sort);

  return {
    largest: largest.slice(0, 5),
    mostRead: mostRead.slice(0, 5),
    mostWritten: mostWritten.slice(0, 5),
  };
}

export function largeObjectsFromPgStatRows(rows, usedBytes, limit = 5) {
  const total = usedBytes && usedBytes > 0 ? usedBytes : 1;
  const largeObjects = [];
  for (const row of rows.slice(0, 8)) {
    const sizeBytes = Number(row.size_bytes) || 0;
    if (sizeBytes <= 0) continue;
    largeObjects.push({
      name: pgQualifiedName(row.schemaname, row.relname),
      size: formatBytes(sizeBytes),
      sizeBytes,
      pct: `${((sizeBytes / total) * 100).toFixed(2)}%`,
    });
  }
  return largeObjects.slice(0, limit);
}

/** One Hyperdrive connection for all Postgres overview probes (avoids ~10 cold connects). */
export async function loadSupabaseOverviewPostgres(env, warnings) {
  const empty = {
    health: {
      d1: { status: 'unknown', latencyMs: null, tableCount: null },
      supabase: { tableCount: null },
      hyperdrive: { status: 'unknown', latencyMs: null },
      errorRatePct: null,
      lastErrorAt: null,
    },
    supStorage: {
      usedBytes: null,
      limitBytes: SUPABASE_PROVISIONED_BYTES,
      connections: null,
      largeObjects: [],
      wired: false,
    },
    pgHot: { count: null, largest: [], mostRead: [], mostWritten: [] },
    pgOps: { maxConnections: null, lastAutovacuumAt: null, wired: false },
    pgSchema: { noPrimaryKey: [], missingIndexes: [], fkIssues: [], wired: false },
  };

  if (!isHyperdriveUsable(env)) {
    warnings.push({
      code: 'HYPERDRIVE_NOT_USABLE',
      message: 'Hyperdrive binding not usable; Supabase-side charts use agentsam_tool_call_log only.',
      severity: 'info',
    });
    return empty;
  }

  const t0 = Date.now();
  const tx = await runHyperdriveTransaction(env, async (client) => {
    const ping = await client.query('SELECT 1 AS ok');
    const [
      sizeR,
      connR,
      statR,
      countR,
      maxR,
      vacR,
      noPkR,
      missIdxR,
      fkR,
    ] = await Promise.all([
      client.query('SELECT pg_database_size(current_database())::bigint AS bytes'),
      client.query(
        `SELECT count(*)::int AS c FROM pg_stat_activity WHERE datname = current_database()`,
      ),
      client.query(
        `SELECT
           schemaname,
           relname,
           pg_total_relation_size(relid) AS size_bytes,
           COALESCE(seq_scan, 0) + COALESCE(idx_scan, 0) AS read_count,
           COALESCE(n_tup_ins, 0) + COALESCE(n_tup_upd, 0) + COALESCE(n_tup_del, 0) AS write_count
         FROM pg_stat_user_tables
         WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
         ORDER BY pg_total_relation_size(relid) DESC NULLS LAST
         LIMIT 200`,
      ),
      client.query(
        `SELECT COUNT(*)::int AS c
         FROM information_schema.tables
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
           AND table_type = 'BASE TABLE'`,
      ),
      client.query(`SELECT setting::int AS v FROM pg_settings WHERE name = 'max_connections'`),
      client.query(
        `SELECT EXTRACT(EPOCH FROM MAX(GREATEST(
           COALESCE(last_autovacuum, 'epoch'::timestamptz),
           COALESCE(last_vacuum, 'epoch'::timestamptz)
         )))::bigint AS ts
         FROM pg_stat_user_tables
         WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`,
      ),
      client.query(
        `SELECT n.nspname AS schemaname, c.relname AS relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'r'
           AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
           AND NOT EXISTS (
             SELECT 1 FROM pg_constraint con
             WHERE con.conrelid = c.oid AND con.contype = 'p'
           )
         ORDER BY n.nspname, c.relname
         LIMIT 8`,
      ),
      client.query(
        `SELECT schemaname, relname
         FROM pg_stat_user_tables
         WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
           AND seq_scan > 100
           AND COALESCE(idx_scan, 0) < seq_scan
         ORDER BY seq_scan DESC
         LIMIT 8`,
      ),
      client.query(
        `SELECT conname, conrelid::regclass::text AS table_name
         FROM pg_constraint
         WHERE contype = 'f' AND NOT convalidated
         LIMIT 8`,
      ),
    ]);

    return { ping, sizeR, connR, statR, countR, maxR, vacR, noPkR, missIdxR, fkR };
  });

  const latencyMs = Date.now() - t0;
  if (!tx.ok || !tx.result) {
    warnings.push({
      code: 'PG_OVERVIEW_BUNDLE_FAILED',
      message: tx.error || 'Supabase overview Postgres bundle failed',
      severity: 'warn',
    });
    return empty;
  }

  const {
    ping,
    sizeR,
    connR,
    statR,
    countR,
    maxR,
    vacR,
    noPkR,
    missIdxR,
    fkR,
  } = tx.result;
  const pingOk = Number(ping?.rows?.[0]?.ok) === 1;
  const statRows = statR?.rows ?? [];
  const usedBytes = Number(sizeR?.rows?.[0]?.bytes) || 0;
  const connections = connR?.rows?.[0]?.c != null ? Number(connR.rows[0].c) || 0 : null;
  const tableCount = countR?.rows?.[0]?.c != null ? Number(countR.rows[0].c) || 0 : null;
  const parsedHot = parsePgStatUserTableRows(statRows);
  const vacTs = vacR?.rows?.[0]?.ts != null ? Number(vacR.rows[0].ts) || null : null;

  if (!sizeR?.rows?.length) {
    warnings.push({
      code: 'PG_STORAGE_SIZE_FAILED',
      message: 'pg_database_size query failed in overview bundle',
      severity: 'warn',
    });
  }
  if (!countR?.rows?.length) {
    warnings.push({
      code: 'PG_TABLE_COUNT_FAILED',
      message: 'Postgres table count failed in overview bundle',
      severity: 'warn',
    });
  }

  return {
    health: {
      ...empty.health,
      supabase: { tableCount },
      hyperdrive: {
        status: pingOk ? 'healthy' : 'error',
        latencyMs,
      },
    },
    supStorage: {
      usedBytes: usedBytes > 0 ? usedBytes : null,
      limitBytes: SUPABASE_PROVISIONED_BYTES,
      connections,
      largeObjects: largeObjectsFromPgStatRows(statRows, usedBytes),
      wired: usedBytes > 0,
    },
    pgHot: { count: tableCount, ...parsedHot },
    pgOps: {
      maxConnections: maxR?.rows?.[0]?.v != null ? Number(maxR.rows[0].v) || null : null,
      lastAutovacuumAt: vacTs && vacTs > 0 ? vacTs : null,
      wired: Boolean(maxR?.rows?.length || vacR?.rows?.length),
    },
    pgSchema: {
      noPrimaryKey: (noPkR?.rows ?? []).map((r) => ({
        name: pgQualifiedName(r.schemaname, r.relname),
        ds: 'supabase',
        severity: 'warn',
      })),
      missingIndexes: (missIdxR?.rows ?? []).map((r) => ({
        name: pgQualifiedName(r.schemaname, r.relname),
        ds: 'supabase',
        severity: 'info',
      })),
      fkIssues: (fkR?.rows ?? []).map((r) => ({
        name: String(r.table_name || r.conname || ''),
        ds: 'supabase',
        severity: 'warn',
      })),
      wired: Boolean(noPkR?.rows?.length || missIdxR?.rows?.length),
    },
  };
}

/**
 * Lightweight Hyperdrive ping + table count (summary probe).
 * Prefer loadSupabaseOverviewPostgres when storage/hot/schema are also needed.
 */
export async function probeSupabaseHealth(env, warnings) {
  const empty = {
    tableCount: null,
    hyperdrive: { status: 'unknown', latencyMs: null },
  };
  if (!isHyperdriveUsable(env)) {
    warnings.push({
      code: 'HYPERDRIVE_NOT_USABLE',
      message: 'Hyperdrive binding not usable; Supabase-side charts use agentsam_tool_call_log only.',
      severity: 'info',
    });
    return empty;
  }
  const t0 = Date.now();
  const r = await runHyperdriveQuery(env, 'SELECT 1 AS ok', []);
  const latencyMs = Date.now() - t0;
  if (!r.ok) {
    warnings.push({
      code: 'HYPERDRIVE_PROBE_FAILED',
      message: r.error || 'Hyperdrive SELECT 1 failed',
      severity: 'warn',
    });
    return { tableCount: null, hyperdrive: { status: 'error', latencyMs } };
  }
  const countR = await runHyperdriveQuery(
    env,
    `SELECT COUNT(*)::int AS c
     FROM information_schema.tables
     WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND table_type = 'BASE TABLE'`,
    [],
  );
  if (!countR.ok) {
    warnings.push({
      code: 'PG_TABLE_COUNT_FAILED',
      message: countR.error || 'Could not count Postgres tables',
      severity: 'warn',
    });
  }
  return {
    tableCount: countR.ok ? Number(countR.rows[0]?.c ?? 0) || 0 : null,
    hyperdrive: { status: 'healthy', latencyMs },
  };
}

/** Lane-shaped helpers for Stage 3.5 dispatch. */
export const supabaseLane = {
  async health(env, warnings) {
    return probeSupabaseHealth(env, warnings);
  },
  async storage(env, warnings) {
    const bundle = await loadSupabaseOverviewPostgres(env, warnings);
    return bundle.supStorage;
  },
  async overview(env, warnings) {
    return loadSupabaseOverviewPostgres(env, warnings);
  },
  async kpis(env, scope, range, warnings) {
    const start = rangeStartSec(range);
    const end = nowSec();
    const prevStart = start - rangeSeconds(range);
    if (env?.DB) {
      const cur = await loadPgStatDeltaKpis(env.DB, start, end);
      if (cur) {
        const prev = (await loadPgStatDeltaKpis(env.DB, prevStart, start)) || {
          queries: 0,
          rowsRead: 0,
          rowsWritten: 0,
          p95Ms: 0,
          errors: 0,
        };
        return {
          queries: cur.queries,
          queriesPrev: prev.queries,
          rowsRead: cur.rowsRead,
          rowsReadPrev: prev.rowsRead,
          rowsWritten: cur.rowsWritten,
          rowsWrittenPrev: prev.rowsWritten,
          errors: cur.errors,
          errorsPrev: prev.errors,
          p95Ms: cur.p95Ms,
        };
      }
    }
    void warnings;
    return aggregateKpis(env, scope, range, 'supabase', warnings);
  },
  async timeseries(env, scope, range, warnings) {
    if (env?.DB) {
      const fromDelta = await loadPgStatDeltaTimeseries(
        env.DB,
        range,
        bucketExpr,
        buildBucketLabels,
        rangeStartSec,
      );
      if (fromDelta) return fromDelta;
    }
    void warnings;
    return loadTimeseriesBuckets(env, scope, range, 'supabase', warnings);
  },
  async hotTables(env, warnings) {
    const bundle = await loadSupabaseOverviewPostgres(env, warnings);
    return bundle.pgHot;
  },
  async schemaHealth(env, warnings) {
    const bundle = await loadSupabaseOverviewPostgres(env, warnings);
    return bundle.pgSchema;
  },
  async opsSignals(env, warnings) {
    const bundle = await loadSupabaseOverviewPostgres(env, warnings);
    return bundle.pgOps;
  },
  async recentEvents(env, scope, range, warnings) {
    if (!env?.DB) return [];
    const events = await loadRecentDbEvents(env.DB, scope, range, warnings);
    return events.filter((e) => e.datasource === 'supabase');
  },
};
