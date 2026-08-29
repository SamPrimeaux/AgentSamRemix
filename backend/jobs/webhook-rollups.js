/**
 * Canonical writer for agentsam_webhook_weekly — rolls up agentsam_webhook_events.
 * @see migrations/580_agentsam_webhook_weekly_prod_align.sql
 */

import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';
import { pragmaTableInfo } from '../services/retention.js';

const WEEKLY_TABLE = 'agentsam_webhook_weekly';
const EVENTS_TABLE = 'agentsam_webhook_events';

/** Monday 00:00:00 UTC for the week containing `fromUnix`. */
export function mondayUtcWeekStartUnix(fromUnix) {
  const ts = Number(fromUnix) > 0 ? Number(fromUnix) : Math.floor(Date.now() / 1000);
  const d = new Date(ts * 1000);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  monday.setUTCHours(0, 0, 0, 0);
  return Math.floor(monday.getTime() / 1000);
}

/**
 * Aggregate completed ISO weeks (strictly before the current UTC week) into agentsam_webhook_weekly.
 * @param {any} env
 * @param {{ beforeWeekStartUnix?: number }} [opts]
 */
export async function rollupAgentsamWebhookWeekly(env, opts = {}) {
  const db = env?.DB;
  if (!db) return { ok: false, reason: 'no_db', rowsWritten: 0 };

  const eventCols = await pragmaTableInfo(db, EVENTS_TABLE);
  const weeklyCols = await pragmaTableInfo(db, WEEKLY_TABLE);
  if (!eventCols.has('received_at_unix') || !weeklyCols.has('week_start_unix')) {
    return { ok: false, reason: 'schema_mismatch', rowsWritten: 0 };
  }

  const beforeWeekStart =
    opts.beforeWeekStartUnix != null && Number(opts.beforeWeekStartUnix) > 0
      ? Number(opts.beforeWeekStartUnix)
      : mondayUtcWeekStartUnix();

  const sql = `
    INSERT INTO ${WEEKLY_TABLE} (
      id,
      tenant_id,
      workspace_id,
      endpoint_id,
      provider,
      event_type,
      week_start_unix,
      total_received,
      total_processed,
      total_failed,
      last_processed_unix,
      updated_at
    )
    SELECT
      'whr_' || lower(hex(randomblob(8))),
      agg.tenant_id,
      agg.workspace_id,
      agg.endpoint_id,
      agg.provider,
      agg.event_type,
      agg.week_start_unix,
      agg.total_received,
      agg.total_processed,
      agg.total_failed,
      agg.last_processed_unix,
      unixepoch()
    FROM (
      SELECT
        tenant_id,
        COALESCE(workspace_id, '') AS workspace_id,
        COALESCE(NULLIF(trim(endpoint_id), ''), '__unknown__') AS endpoint_id,
        provider,
        event_type,
        week_start_unix,
        COUNT(*) AS total_received,
        SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) AS total_processed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS total_failed,
        MAX(COALESCE(processed_at_unix, received_at_unix)) AS last_processed_unix,
        1 AS _one
      FROM (
        SELECT
          tenant_id,
          workspace_id,
          endpoint_id,
          provider,
          event_type,
          status,
          received_at_unix,
          processed_at_unix,
          (
            received_at_unix
            - ((CAST(strftime('%w', datetime(received_at_unix, 'unixepoch')) AS INTEGER) + 6) % 7) * 86400
            - CAST(strftime('%H', datetime(received_at_unix, 'unixepoch')) AS INTEGER) * 3600
            - CAST(strftime('%M', datetime(received_at_unix, 'unixepoch')) AS INTEGER) * 60
            - CAST(strftime('%S', datetime(received_at_unix, 'unixepoch')) AS INTEGER)
          ) AS week_start_unix
        FROM ${EVENTS_TABLE}
        WHERE received_at_unix IS NOT NULL
          AND tenant_id IS NOT NULL
          AND trim(tenant_id) != ''
      ) e
      WHERE e.week_start_unix < ?
      GROUP BY tenant_id, workspace_id, endpoint_id, provider, event_type, week_start_unix
    ) agg
    ON CONFLICT(tenant_id, workspace_id, endpoint_id, provider, event_type, week_start_unix) DO UPDATE SET
      total_received = excluded.total_received,
      total_processed = excluded.total_processed,
      total_failed = excluded.total_failed,
      last_processed_unix = excluded.last_processed_unix,
      updated_at = unixepoch()
  `;

  const res = await db.prepare(sql).bind(beforeWeekStart).run();
  const rowsWritten = Number(res?.meta?.changes ?? res?.changes ?? 0) || 0;
  return { ok: true, rowsWritten, beforeWeekStartUnix: beforeWeekStart };
}

/** Sunday 00:00 UTC — ledger + rollup completed webhook weeks. */
export async function runWebhookWeeklyRollupCron(env) {
  if (!env?.DB) return { ok: false, reason: 'no_db' };

  const begun = await startCronRun(env, {
    jobName: 'webhook_weekly_rollup',
    cronExpression: '0 0 * * 0',
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();

  try {
    const result = await rollupAgentsamWebhookWeekly(env);
    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: 0,
        rowsWritten: result.rowsWritten ?? 0,
        metadata: {
          beforeWeekStartUnix: result.beforeWeekStartUnix ?? null,
          ok: result.ok === true,
        },
      });
    }
    return result;
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    throw e;
  }
}
