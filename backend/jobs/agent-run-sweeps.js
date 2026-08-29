/**
 * Scheduled cleanup for stale Agent Sam execution rows.
 *
 * This is backend-owned job logic. The scheduler only composes
 * scheduled slots; they do not own the agent-run lifecycle sweeps.
 */
import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';

const CRON_30 = '*/30 * * * *';

/**
 * Mark long-running cron ledger rows as failed when no completion was recorded.
 * @param {any} env
 * @param {{ cronExpression?: string, skipLedger?: boolean }} [opts]
 */
export async function sweepStaleCronRuns(env, opts = {}) {
  if (!env?.DB) return { rowsWritten: 0 };
  const cronExpression = opts.cronExpression ?? CRON_30;
  const skipLedger = opts.skipLedger === true;
  let runId = null;
  let startedAt = Date.now();
  if (!skipLedger) {
    const begun = await startCronRun(env, {
      jobName: 'agentsam_cron_runs_stuck_sweep',
      cronExpression,
      tenantId: null,
      workspaceId: null,
    });
    runId = begun?.runId ?? null;
    startedAt = begun?.startedAt ?? Date.now();
  }
  try {
    const r = await env.DB.prepare(
      `UPDATE agentsam_cron_runs SET status='failed', error_message='timeout - no completion recorded'
       WHERE status='running' AND started_at < unixepoch() - 3600`,
    ).run();
    const rowsWritten = Number(r.meta?.changes ?? r.changes ?? 0) || 0;
    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: 0,
        rowsWritten,
        metadata: { stuck_rows_marked: rowsWritten },
      });
    }
    return { rowsWritten };
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn('[sweepStaleCronRuns]', e?.message ?? e);
    throw e;
  }
}

/**
 * Chat orphans after client abort / deploy isolate kill / hydration force-hydrate.
 * Age threshold 8m — must run on the five-minute slot.
 * @param {any} env
 * @returns {Promise<number>} rows cancelled
 */
export async function sweepStaleChatAgentRuns(env) {
  if (!env?.DB) return 0;
  try {
    const chatCutoff = Math.floor(Date.now() / 1000) - 8 * 60;
    const chat = await env.DB.prepare(`
      UPDATE agentsam_agent_run
      SET status = 'cancelled',
          error_message = COALESCE(error_message, 'orphan_stream_disconnect — chat run still running after 8m (client abort, hydration abort, or deploy isolate kill)'),
          completed_at_unix = COALESCE(completed_at_unix, unixepoch()),
          updated_at_unix = unixepoch()
      WHERE status = 'running'
        AND conversation_id IS NOT NULL
        AND TRIM(conversation_id) <> ''
        AND created_at_unix < ?
    `).bind(chatCutoff).run();
    const chatN = Number(chat?.meta?.changes ?? 0) || 0;
    if (chatN) {
      console.log('[cron] sweepStaleChatAgentRuns: cancelled_chat=', chatN);
    }
    return chatN;
  } catch (e) {
    console.warn('[cron] sweepStaleChatAgentRuns', e?.message ?? e);
    return 0;
  }
}

/** Non-chat triggers: failed after 35m (checked on the half-hour cron). */
export async function sweepStaleNonChatAgentRuns(env) {
  if (!env?.DB) return 0;
  try {
    const otherCutoff = Math.floor(Date.now() / 1000) - 35 * 60;
    const other = await env.DB.prepare(`
      UPDATE agentsam_agent_run
      SET status = 'failed',
          error_message = COALESCE(error_message, 'run exceeded 35min without terminal status — swept by cron'),
          completed_at_unix = COALESCE(completed_at_unix, unixepoch()),
          updated_at_unix = unixepoch()
      WHERE status = 'running'
        AND (conversation_id IS NULL OR TRIM(conversation_id) = '')
        AND created_at_unix < ?
    `).bind(otherCutoff).run();
    const otherN = Number(other?.meta?.changes ?? 0) || 0;
    if (otherN) {
      console.log('[cron] sweepStaleNonChatAgentRuns: failed_other=', otherN);
    }
    return otherN;
  } catch (e) {
    console.warn('[cron] sweepStaleNonChatAgentRuns', e?.message ?? e);
    return 0;
  }
}
