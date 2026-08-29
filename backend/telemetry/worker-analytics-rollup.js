/**
 * Roll up worker_analytics_events → hourly → daily; trim raw events and stale hourly rows.
 * Error extraction writes agentsam_error_log (SSOT), not worker_analytics_errors.
 * Timestamps are Unix **milliseconds** (timestamp/1000 for strftime).
 */

import { writeAgentsamErrorLog } from './error-log.js';
import { resolvePlatformWebhookScope } from '../services/webhooks/ledger.js';

const MS_PER_HOUR = 3600 * 1000;
const MS_PER_DAY = 86400 * 1000;
const EVENT_RETAIN_MS = 72 * MS_PER_HOUR;
const HOURLY_RETAIN_MS = 30 * MS_PER_DAY;

/** @param {unknown} v */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {any} env
 * @returns {Promise<{ hourly_rows: number, daily_rows: number, errors_extracted: number, events_deleted: number, hourly_trimmed: number }>}
 */
export async function rollupWorkerAnalytics(env) {
  if (!env?.DB) {
    return {
      hourly_rows: 0,
      daily_rows: 0,
      errors_extracted: 0,
      events_deleted: 0,
      hourly_trimmed: 0,
    };
  }

  const last = await env.DB.prepare(
    `SELECT MAX(hour_timestamp) AS h FROM worker_analytics_hourly`,
  )
    .first()
    .catch(() => null);
  const since = num(last?.h) || 0;

  const grouped = await env.DB.prepare(
    `SELECT worker_name, environment,
            (CAST(strftime('%s', datetime(timestamp / 1000, 'unixepoch'), 'start of hour') AS INTEGER) * 1000)
              AS hour_timestamp,
            COUNT(*) AS total_requests,
            SUM(CASE WHEN outcome = 'ok' OR status BETWEEN 200 AND 399 THEN 1 ELSE 0 END) AS successful_requests,
            SUM(CASE WHEN NOT (outcome = 'ok' OR status BETWEEN 200 AND 399) THEN 1 ELSE 0 END) AS failed_requests,
            AVG(duration_ms) AS avg_duration_ms,
            AVG(cpu_time_ms) AS avg_cpu_time_ms,
            MAX(duration_ms) AS p95_duration_ms,
            SUM(CASE WHEN errors IS NOT NULL AND errors != '' AND errors != 'null' THEN 1 ELSE 0 END) AS total_errors
     FROM worker_analytics_events
     WHERE timestamp > ?
     GROUP BY worker_name, environment,
              CAST(strftime('%s', datetime(timestamp / 1000, 'unixepoch'), 'start of hour') AS INTEGER) * 1000`,
  )
    .bind(since)
    .all()
    .then((r) => r.results || [])
    .catch(() => []);

  let hourlyWritten = 0;
  for (const r of grouped) {
    const res = await env.DB.prepare(
      `INSERT INTO worker_analytics_hourly
         (worker_name, environment, hour_timestamp, total_requests, successful_requests,
          failed_requests, avg_duration_ms, avg_cpu_time_ms, p95_duration_ms, total_errors, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(worker_name, environment, hour_timestamp) DO UPDATE SET
         total_requests = excluded.total_requests,
         successful_requests = excluded.successful_requests,
         failed_requests = excluded.failed_requests,
         avg_duration_ms = excluded.avg_duration_ms,
         avg_cpu_time_ms = excluded.avg_cpu_time_ms,
         p95_duration_ms = excluded.p95_duration_ms,
         total_errors = excluded.total_errors`,
    )
      .bind(
        r.worker_name,
        r.environment,
        num(r.hour_timestamp),
        num(r.total_requests),
        num(r.successful_requests),
        num(r.failed_requests),
        num(r.avg_duration_ms),
        num(r.avg_cpu_time_ms),
        num(r.p95_duration_ms),
        num(r.total_errors),
      )
      .run()
      .catch(() => null);
    hourlyWritten += Number(res?.meta?.changes) || 0;
  }

  const errorEvents = await env.DB.prepare(
    `SELECT event_id, worker_name, environment, timestamp, errors, url, method, status
     FROM worker_analytics_events
     WHERE errors IS NOT NULL AND errors != '' AND errors != 'null'
     ORDER BY timestamp DESC LIMIT 500`,
  )
    .all()
    .then((r) => r.results || [])
    .catch(() => []);

  let errorsExtracted = 0;
  const scope = await resolvePlatformWebhookScope(env, null).catch(() => null);
  if (scope?.workspaceId && scope?.tenantId) {
    for (const r of errorEvents) {
      const sourceId = r.event_id != null ? String(r.event_id).slice(0, 200) : '';
      const msg = String(r.errors || '').slice(0, 8000);
      if (!sourceId || !msg) continue;
      try {
        const existing = await env.DB.prepare(
          `SELECT id FROM agentsam_error_log
           WHERE source = 'worker_analytics_events' AND source_id = ? LIMIT 1`,
        )
          .bind(sourceId)
          .first();
        if (existing?.id) continue;
        const written = await writeAgentsamErrorLog(env, {
          workspaceId: scope.workspaceId,
          tenantId: scope.tenantId,
          errorCode: String(num(r.status) || 500),
          errorType: 'worker_error',
          errorMessage: msg,
          source: 'worker_analytics_events',
          sourceId,
          contextJson: JSON.stringify({
            path: r.url != null ? String(r.url).slice(0, 500) : '',
            method: r.method != null ? String(r.method).slice(0, 24) : '',
            status_code: num(r.status),
            worker_name: r.worker_name,
            environment: r.environment,
            event_timestamp_ms: r.timestamp,
          }),
        });
        if (written.ok) errorsExtracted += 1;
      } catch {
        /* non-fatal */
      }
    }
  }

  const lastDaily = await env.DB.prepare(
    `SELECT MAX(day_timestamp) AS d FROM worker_analytics_daily`,
  )
    .first()
    .catch(() => null);
  const sinceDaily = num(lastDaily?.d) || 0;

  const dailyGrouped = await env.DB.prepare(
    `SELECT worker_name, environment,
            (CAST(strftime('%s', datetime(hour_timestamp / 1000, 'unixepoch'), 'start of day') AS INTEGER) * 1000)
              AS day_timestamp,
            SUM(total_requests) AS total_requests,
            SUM(successful_requests) AS successful_requests,
            SUM(failed_requests) AS failed_requests,
            AVG(avg_duration_ms) AS avg_duration_ms,
            AVG(avg_cpu_time_ms) AS avg_cpu_time_ms,
            MAX(p95_duration_ms) AS p95_duration_ms,
            SUM(total_errors) AS total_errors,
            COUNT(*) AS hour_count
     FROM worker_analytics_hourly
     WHERE hour_timestamp > ?
     GROUP BY worker_name, environment,
              CAST(strftime('%s', datetime(hour_timestamp / 1000, 'unixepoch'), 'start of day') AS INTEGER) * 1000`,
  )
    .bind(sinceDaily)
    .all()
    .then((r) => r.results || [])
    .catch(() => []);

  let dailyWritten = 0;
  for (const r of dailyGrouped) {
    const res = await env.DB.prepare(
      `INSERT INTO worker_analytics_daily
         (worker_name, environment, day_timestamp, total_requests, successful_requests,
          failed_requests, avg_duration_ms, avg_cpu_time_ms, p95_duration_ms, total_errors,
          hour_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(worker_name, environment, day_timestamp) DO UPDATE SET
         total_requests = excluded.total_requests,
         successful_requests = excluded.successful_requests,
         failed_requests = excluded.failed_requests,
         avg_duration_ms = excluded.avg_duration_ms,
         avg_cpu_time_ms = excluded.avg_cpu_time_ms,
         p95_duration_ms = excluded.p95_duration_ms,
         total_errors = excluded.total_errors,
         hour_count = excluded.hour_count`,
    )
      .bind(
        r.worker_name,
        r.environment,
        num(r.day_timestamp),
        num(r.total_requests),
        num(r.successful_requests),
        num(r.failed_requests),
        num(r.avg_duration_ms),
        num(r.avg_cpu_time_ms),
        num(r.p95_duration_ms),
        num(r.total_errors),
        num(r.hour_count),
      )
      .run()
      .catch(() => null);
    dailyWritten += Number(res?.meta?.changes) || 0;
  }

  const cutoffMs = Date.now() - EVENT_RETAIN_MS;
  const eventDel = await env.DB.prepare(
    `DELETE FROM worker_analytics_events WHERE timestamp < ? LIMIT 5000`,
  )
    .bind(cutoffMs)
    .run()
    .catch(() => null);

  const hourlyCutoff = Date.now() - HOURLY_RETAIN_MS;
  const hourlyDel = await env.DB.prepare(
    `DELETE FROM worker_analytics_hourly WHERE hour_timestamp < ? LIMIT 5000`,
  )
    .bind(hourlyCutoff)
    .run()
    .catch(() => null);

  return {
    hourly_rows: grouped.length,
    daily_rows: dailyGrouped.length,
    errors_extracted: errorsExtracted,
    events_deleted: Number(eventDel?.meta?.changes) || 0,
    hourly_trimmed: Number(hourlyDel?.meta?.changes) || 0,
    rowsWritten: hourlyWritten + dailyWritten,
    metadata: {
      hourly_upserted: hourlyWritten,
      daily_upserted: dailyWritten,
      events_deleted: Number(eventDel?.meta?.changes) || 0,
      hourly_trimmed: Number(hourlyDel?.meta?.changes) || 0,
    },
  };
}
