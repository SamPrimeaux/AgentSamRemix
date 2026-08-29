import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';
import { emailSentLogKey, getEmailR2Bucket } from '../services/email/r2-email.js';

const CRON_EXPR = '0 0 1 * *';
const LOG_DELETE_BATCH = 200;
const LOG_DELETE_MAX_BATCHES = 25;
const RECEIVED_PURGE_BATCH = 500;
const RECEIVED_PURGE_MAX_BATCHES = 10;
const RECEIVED_RETENTION_DAYS = 90;

/**
 * @param {any} env
 * @param {string[]} logIds
 */
async function purgeSentArchiveObjects(env, logIds) {
  const archive = getEmailR2Bucket(env);
  if (!archive || !Array.isArray(logIds) || logIds.length === 0) return 0;
  let deleted = 0;
  for (const rawId of logIds) {
    const id = String(rawId || '').trim();
    if (!id) continue;
    try {
      await archive.delete(emailSentLogKey(id));
      deleted += 1;
    } catch {
      /* non-fatal */
    }
    try {
      await archive.delete(`sent/${id}.json`);
    } catch {
      /* legacy key cleanup */
    }
  }
  return deleted;
}

/**
 * Roll up completed calendar months from email_logs, prune R2 sent bodies, trim received_emails.
 * Runs on the 1st of each month (same trigger as spend_ledger_monthly_rollup).
 * @param {any} env
 */
export async function runEmailMonthlyRollup(env) {
  if (!env?.DB) return { skipped: true, reason: 'no_db' };

  const begun = await startCronRun(env, {
    jobName: 'email_send_monthly_rollup',
    cronExpression: CRON_EXPR,
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  const now = Math.floor(Date.now() / 1000);
  const currentMonth = new Date().toISOString().slice(0, 7);

  let rowsRead = 0;
  let rowsWritten = 0;
  let r2Deleted = 0;
  let receivedDeleted = 0;
  const metadata = { currentMonth, months_rolled: 0, log_batches: 0 };

  try {
    const { results: months = [] } = await env.DB.prepare(
      `SELECT
         strftime('%Y-%m', created_at) AS month,
         COALESCE(NULLIF(TRIM(status), ''), 'sent') AS status,
         COUNT(*) AS send_count
       FROM email_logs
       WHERE strftime('%Y-%m', created_at) < ?
       GROUP BY month, status`,
    )
      .bind(currentMonth)
      .all();
    rowsRead += 1;
    metadata.months_rolled = months.length;

    for (const row of months) {
      const month = String(row.month || '').trim();
      const status = String(row.status || 'sent').trim() || 'sent';
      if (!month) continue;
      const id = `esr_${month}_${status}`.replace(/[^a-z0-9_]/gi, '_');
      await env.DB.prepare(
        `INSERT INTO email_send_rollups_monthly
           (id, month, status, send_count, source_deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(month, status) DO UPDATE SET
           send_count = excluded.send_count,
           updated_at = excluded.updated_at`,
      )
        .bind(id, month, status, Number(row.send_count || 0), now, now)
        .run();
      rowsWritten += 1;
    }

    await env.DB.prepare(
      `UPDATE email_send_rollups_monthly
       SET source_deleted = 1, updated_at = ?
       WHERE month < ?`,
    )
      .bind(now, currentMonth)
      .run();

    for (let batch = 0; batch < LOG_DELETE_MAX_BATCHES; batch += 1) {
      const { results: stale = [] } = await env.DB.prepare(
        `SELECT id FROM email_logs
         WHERE strftime('%Y-%m', created_at) < ?
         LIMIT ?`,
      )
        .bind(currentMonth, LOG_DELETE_BATCH)
        .all();
      if (!stale.length) break;
      metadata.log_batches += 1;
      const ids = stale.map((r) => String(r.id || '').trim()).filter(Boolean);
      if (!ids.length) break;
      r2Deleted += await purgeSentArchiveObjects(env, ids);
      const placeholders = ids.map(() => '?').join(',');
      const del = await env.DB.prepare(
        `DELETE FROM email_logs WHERE id IN (${placeholders})`,
      )
        .bind(...ids)
        .run();
      rowsWritten += Number(del.meta?.changes ?? del.changes ?? 0) || 0;
      if (ids.length < LOG_DELETE_BATCH) break;
    }

    for (let batch = 0; batch < RECEIVED_PURGE_MAX_BATCHES; batch += 1) {
      const del = await env.DB.prepare(
        `DELETE FROM received_emails
         WHERE date(date_received) < date('now', '-${RECEIVED_RETENTION_DAYS} days')
         LIMIT ?`,
      )
        .bind(RECEIVED_PURGE_BATCH)
        .run();
      const n = Number(del.meta?.changes ?? del.changes ?? 0) || 0;
      receivedDeleted += n;
      rowsWritten += n;
      if (n < RECEIVED_PURGE_BATCH) break;
    }

    metadata.r2_deleted = r2Deleted;
    metadata.received_deleted = receivedDeleted;

    console.log(
      '[rollup] email monthly:',
      JSON.stringify({
        months: months.length,
        r2_deleted: r2Deleted,
        received_deleted: receivedDeleted,
      }),
    );

    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead,
        rowsWritten,
        metadata,
      });
    }
    return { ok: true, rowsRead, rowsWritten, metadata };
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn('[rollup] runEmailMonthlyRollup', e?.message ?? e);
    throw e;
  }
}
