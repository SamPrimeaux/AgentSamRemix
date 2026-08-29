/**
 * Periodic Google Calendar sync — every 30 minutes (thirty-minute cron).
 */

import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';
import { runGoogleCalendarSyncCron } from '../../src/core/google-calendar-sync.js';

const CRON_EXPR = '*/30 * * * *';
const JOB_NAME = 'google_calendar_sync';

/** @param {*} env */
export async function runGoogleCalendarSyncJob(env) {
  const begun = await startCronRun(env, {
    jobName: JOB_NAME,
    cronExpression: CRON_EXPR,
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();

  try {
    const out = await runGoogleCalendarSyncCron(env);
    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: out.accounts || 0,
        rowsWritten: out.synced || 0,
        metadata: out,
      });
    }
    return out;
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    throw e;
  }
}
