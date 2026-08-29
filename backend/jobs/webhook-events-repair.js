/**
 * Stuck inbound receipts: mark status=received older than 1h as ignored.
 * DELETE is owned solely by data_retention_policies (1 day) via runRetentionPurge.
 */
import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';

export async function runWebhookEventsRepairCron(env) {
  if (!env?.DB) return;
  const begun = await startCronRun(env, {
    jobName: 'webhook_events_repair',
    cronExpression: '0 1 * * *',
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  let rowsWritten = 0;

  try {
    const ign = await env.DB.prepare(
      `UPDATE agentsam_webhook_events
       SET status = 'ignored',
           processing_error = COALESCE(NULLIF(trim(processing_error), ''), 'stuck_received'),
           processed_at_unix = unixepoch()
       WHERE status = 'received'
         AND received_at_unix < (unixepoch() - 3600)`,
    ).run();
    rowsWritten += Number(ign.meta?.changes ?? ign.changes ?? 0) || 0;

    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: 1,
        rowsWritten,
        metadata: { stuck_received_ignored: rowsWritten },
      });
    }
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn('[cron] webhook_events_repair', e?.message ?? e);
  }
}
