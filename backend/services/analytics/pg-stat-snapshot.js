/**
 * Capture pg_stat_statements via Hyperdrive, diff vs D1 snapshot, write deltas.
 * Fail soft when the extension is missing or Hyperdrive is unavailable.
 */
import { isHyperdriveUsable, runHyperdriveQuery } from '../database/hyperdrive.js';
import { tableExists } from '../retention.js';

const DEFAULT_WINDOW_SECONDS = 30 * 60;
const PG_STAT_SQL = `
  SELECT
    queryid::text AS queryid,
    LEFT(query, 500) AS query_norm,
    calls::bigint AS calls,
    total_exec_time::float8 AS total_exec_time_ms,
    rows::bigint AS rows
  FROM pg_stat_statements
  WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  ORDER BY total_exec_time DESC NULLS LAST
  LIMIT 500
`;

/**
 * @param {string} queryNorm
 */
function isSelectQuery(queryNorm) {
  const q = String(queryNorm || '').trim().toLowerCase();
  return q.startsWith('select') || q.startsWith('with');
}

/**
 * @param {any} env
 * @param {{ windowSeconds?: number }} [opts]
 * @returns {Promise<{ ok: boolean, rowsRead: number, rowsWritten: number, skipped?: string, metadata?: Record<string, unknown> }>}
 */
export async function runPgStatStatementsSnapshot(env, opts = {}) {
  const windowSeconds = Number(opts.windowSeconds) > 0 ? Number(opts.windowSeconds) : DEFAULT_WINDOW_SECONDS;
  if (!env?.DB) {
    return { ok: false, rowsRead: 0, rowsWritten: 0, skipped: 'd1_missing' };
  }
  if (!isHyperdriveUsable(env)) {
    return { ok: true, rowsRead: 0, rowsWritten: 0, skipped: 'hyperdrive_not_usable' };
  }
  if (!(await tableExists(env.DB, 'agentsam_pg_stat_snapshot')) || !(await tableExists(env.DB, 'agentsam_pg_stat_delta'))) {
    return { ok: true, rowsRead: 0, rowsWritten: 0, skipped: 'delta_tables_missing' };
  }

  const pg = await runHyperdriveQuery(env, PG_STAT_SQL, []);
  if (!pg.ok) {
    const err = String(pg.error || '');
    const soft =
      /pg_stat_statements/i.test(err) ||
      /relation .* does not exist/i.test(err) ||
      /undefined_table/i.test(err) ||
      /permission denied/i.test(err);
    if (soft) {
      return {
        ok: true,
        rowsRead: 0,
        rowsWritten: 0,
        skipped: 'pg_stat_statements_unavailable',
        metadata: { error: err.slice(0, 240) },
      };
    }
    return {
      ok: false,
      rowsRead: 0,
      rowsWritten: 0,
      skipped: 'pg_query_failed',
      metadata: { error: err.slice(0, 240) },
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const { results: prevRows } = await env.DB.prepare(
    `SELECT queryid, query_norm, calls, total_exec_time_ms, rows FROM agentsam_pg_stat_snapshot`,
  )
    .all()
    .catch(() => ({ results: [] }));

  /** @type {Map<string, { query_norm: string, calls: number, total_exec_time_ms: number, rows: number }>} */
  const prevMap = new Map();
  for (const row of prevRows || []) {
    const id = String(row.queryid || '');
    if (!id) continue;
    prevMap.set(id, {
      query_norm: String(row.query_norm || ''),
      calls: Number(row.calls) || 0,
      total_exec_time_ms: Number(row.total_exec_time_ms) || 0,
      rows: Number(row.rows) || 0,
    });
  }

  let rowsWritten = 0;
  const stmts = [];

  for (const row of pg.rows || []) {
    const queryid = String(row.queryid || '');
    if (!queryid) continue;
    const queryNorm = String(row.query_norm || '').slice(0, 500);
    const calls = Number(row.calls) || 0;
    const totalMs = Number(row.total_exec_time_ms) || 0;
    const rows = Number(row.rows) || 0;
    const prev = prevMap.get(queryid);

    let callsDelta = calls;
    let timeDelta = totalMs;
    let rowsDelta = rows;
    if (prev) {
      // Stats reset → treat current cumulative as the new window baseline.
      const reset = calls < prev.calls || totalMs < prev.total_exec_time_ms;
      callsDelta = reset ? calls : Math.max(0, calls - prev.calls);
      timeDelta = reset ? totalMs : Math.max(0, totalMs - prev.total_exec_time_ms);
      rowsDelta = reset ? rows : Math.max(0, rows - prev.rows);
    }

    if (callsDelta > 0 || timeDelta > 0 || rowsDelta > 0) {
      const mean = callsDelta > 0 ? timeDelta / callsDelta : null;
      const id = `pgsd_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
      stmts.push(
        env.DB.prepare(
          `INSERT INTO agentsam_pg_stat_delta (
             id, captured_at, window_seconds, queryid, query_norm,
             calls_delta, total_exec_time_ms_delta, rows_delta, mean_exec_time_ms, is_select, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          now,
          windowSeconds,
          queryid,
          queryNorm,
          callsDelta,
          timeDelta,
          rowsDelta,
          mean,
          isSelectQuery(queryNorm) ? 1 : 0,
          now,
        ),
      );
    }

    stmts.push(
      env.DB.prepare(
        `INSERT INTO agentsam_pg_stat_snapshot (queryid, query_norm, calls, total_exec_time_ms, rows, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(queryid) DO UPDATE SET
           query_norm = excluded.query_norm,
           calls = excluded.calls,
           total_exec_time_ms = excluded.total_exec_time_ms,
           rows = excluded.rows,
           updated_at = excluded.updated_at`,
      ).bind(queryid, queryNorm, calls, totalMs, rows, now),
    );
  }

  if (stmts.length) {
    try {
      await env.DB.batch(stmts);
      rowsWritten = stmts.length;
    } catch (e) {
      return {
        ok: false,
        rowsRead: (pg.rows || []).length,
        rowsWritten: 0,
        skipped: 'd1_batch_failed',
        metadata: { error: String(e?.message || e).slice(0, 240) },
      };
    }
  }

  return {
    ok: true,
    rowsRead: (pg.rows || []).length,
    rowsWritten,
    metadata: {
      captured_at: now,
      window_seconds: windowSeconds,
      delta_rows: stmts.filter((s) => String(s?.statement || s).includes('agentsam_pg_stat_delta')).length,
    },
  };
}

/**
 * Aggregate delta rows for analytics KPIs over a unix-second range.
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {number} startSec
 * @param {number} endSec
 */
export async function loadPgStatDeltaKpis(db, startSec, endSec) {
  if (!db || !(await tableExists(db, 'agentsam_pg_stat_delta'))) {
    return null;
  }
  try {
    const row = await db
      .prepare(
        `SELECT
           COALESCE(SUM(calls_delta), 0) AS queries,
           COALESCE(SUM(rows_delta), 0) AS rows_read,
           COALESCE(SUM(CASE WHEN is_select = 0 THEN rows_delta ELSE 0 END), 0) AS rows_written,
           COALESCE(AVG(mean_exec_time_ms), 0) AS mean_ms
         FROM agentsam_pg_stat_delta
         WHERE captured_at >= ? AND captured_at < ?`,
      )
      .bind(startSec, endSec)
      .first();
    const queries = Number(row?.queries ?? 0) || 0;
    if (queries <= 0 && Number(row?.rows_read ?? 0) <= 0) return null;
    return {
      queries,
      rowsRead: Number(row?.rows_read ?? 0) || 0,
      rowsWritten: Number(row?.rows_written ?? 0) || 0,
      p95Ms: Number(row?.mean_ms ?? 0) || 0,
      errors: 0,
    };
  } catch {
    return null;
  }
}

/**
 * Bucketed series from delta captures for timeseries charts.
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} range
 * @param {(range: string, col: string) => string} bucketExprFn
 * @param {(range: string) => string[]} buildLabelsFn
 * @param {(range: string) => number} rangeStartFn
 */
export async function loadPgStatDeltaTimeseries(db, range, bucketExprFn, buildLabelsFn, rangeStartFn) {
  if (!db || !(await tableExists(db, 'agentsam_pg_stat_delta'))) {
    return null;
  }
  const labels = buildLabelsFn(range);
  const start = rangeStartFn(range);
  const bucket = bucketExprFn(range, 'captured_at');
  try {
    const { results } = await db
      .prepare(
        `SELECT ${bucket} AS bucket,
                COALESCE(SUM(calls_delta), 0) AS c,
                COALESCE(SUM(rows_delta), 0) AS rr,
                COALESCE(SUM(CASE WHEN is_select = 0 THEN rows_delta ELSE 0 END), 0) AS rw,
                COALESCE(AVG(mean_exec_time_ms), 0) AS avg_ms
         FROM agentsam_pg_stat_delta
         WHERE captured_at >= ?
         GROUP BY bucket
         ORDER BY bucket`,
      )
      .bind(start)
      .all();
    const rows = results || [];
    if (!rows.some((r) => Number(r.c) > 0)) return null;

    const vol = new Map(labels.map((l) => [l, 0]));
    const read = new Map(labels.map((l) => [l, 0]));
    const write = new Map(labels.map((l) => [l, 0]));
    const latMs = [];
    for (const r of rows) {
      const b = String(r.bucket ?? '');
      if (!vol.has(b)) continue;
      vol.set(b, (vol.get(b) || 0) + (Number(r.c) || 0));
      read.set(b, (read.get(b) || 0) + (Number(r.rr) || 0));
      write.set(b, (write.get(b) || 0) + (Number(r.rw) || 0));
      latMs.push({ bucket: b, ms: Number(r.avg_ms) || 0 });
    }
    const toArr = (m) => labels.map((l) => m.get(l) ?? 0);
    const zeros = labels.map(() => 0);
    return {
      labels,
      d1: zeros,
      supabase: toArr(vol),
      reads: { d1: zeros, supabase: toArr(read) },
      writes: { d1: zeros, supabase: toArr(write) },
      errors: { d1: zeros, supabase: zeros },
      latencyByBucket: latMs,
    };
  } catch {
    return null;
  }
}
