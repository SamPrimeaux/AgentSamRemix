/**
 * Backend-owned maintenance jobs composed by the Worker cron scheduler.
 *
 * The scheduler may select and compose these jobs, but must not
 * own their database write logic.
 */
import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';

const CRON_30 = '*/30 * * * *';
const CRON_HOURLY = '0 * * * *';

/** Mark stale pending approvals as expired and keep spawn jobs halted. */
export async function sweepExpiredApprovalQueue(env) {
  if (!env?.DB) return;
  const begun = await startCronRun(env, {
    jobName: 'agentsam_approval_queue_expiry_sweep',
    cronExpression: CRON_30,
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  try {
    const { results: stale } = await env.DB.prepare(
      `SELECT id, tool_name, input_json, session_id FROM agentsam_approval_queue
       WHERE status='pending' AND expires_at < unixepoch()`,
    )
      .all()
      .catch(() => ({ results: [] }));

    if (Array.isArray(stale) && stale.length) {
      try {
        const { softExpireSpawnBudgetApprovals } = await import(
          '../agentsam/runtime/spawn/orchestrator.js'
        );
        await softExpireSpawnBudgetApprovals(env, stale);
      } catch (e) {
        console.warn('[sweepExpiredApprovalQueue] softExpire', e?.message ?? e);
      }
    }

    const r = await env.DB.prepare(
      `UPDATE agentsam_approval_queue SET status='expired', decided_at = unixepoch()
       WHERE status='pending' AND expires_at < unixepoch()`,
    ).run();
    const rowsWritten = Number(r.meta?.changes ?? r.changes ?? 0) || 0;
    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: Array.isArray(stale) ? stale.length : 0,
        rowsWritten,
        metadata: { expired_rows: rowsWritten },
      });
    }
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn('[sweepExpiredApprovalQueue]', e?.message ?? e);
  }
}

/** Drain one queued request per session and record a durable receipt. */
export async function processQueues(env) {
  if (!env?.DB) return;
  const begun = await startCronRun(env, {
    jobName: 'agentsam_request_queue_drain',
    cronExpression: CRON_HOURLY,
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  let rowsRead = 0;
  let rowsWritten = 0;
  try {
    const { results: sessions } = await env.DB.prepare(
      `SELECT DISTINCT session_id FROM agentsam_request_queue WHERE status = 'queued'`,
    ).all();
    rowsRead = (sessions || []).length;
    for (const { session_id } of sessions || []) {
      const task = await env.DB.prepare(
        `SELECT * FROM agentsam_request_queue
          WHERE session_id = ? AND status = 'queued'
          ORDER BY position ASC, created_at ASC LIMIT 1`,
      )
        .bind(session_id)
        .first();
      if (!task) continue;
      try {
        await env.DB.prepare(
          `UPDATE agentsam_request_queue SET status = 'running', updated_at = unixepoch() WHERE id = ?`,
        )
          .bind(task.id)
          .run();
        const payload = task.payload_json ? JSON.parse(task.payload_json) : {};
        await env.DB.prepare(
          `UPDATE agentsam_request_queue
              SET status = 'done', result_json = ?, updated_at = unixepoch()
            WHERE id = ?`,
        )
          .bind(
            JSON.stringify({
              success: true,
              drained: true,
              note: 'queued by agent_run_stop consecutive-fail; auto-resume pending Wave 3',
              payload,
            }),
            task.id,
          )
          .run();
        rowsWritten += 2;
      } catch (e) {
        await env.DB.prepare(
          `UPDATE agentsam_request_queue
              SET status = 'failed', result_json = ?, error_message = ?, updated_at = unixepoch()
            WHERE id = ?`,
        )
          .bind(
            JSON.stringify({ error: String(e?.message || e) }),
            String(e?.message || e).slice(0, 500),
            task.id,
          )
          .run();
        rowsWritten += 2;
      }
    }
    if (runId) await completeCronRun(env, runId, startedAt, { rowsRead, rowsWritten, metadata: {} });
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn('[processQueues]', e?.message || e);
  }
}

/** Close active terminal sessions idle for 24 hours, then purge closed rows. */
export async function sweepStaleTerminalSessions(env) {
  if (!env?.DB) return;
  const begun = await startCronRun(env, {
    jobName: 'terminal_sessions_stale_sweep',
    cronExpression: CRON_30,
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  try {
    const purgedResult = await env.DB.prepare(
      `DELETE FROM terminal_sessions
       WHERE status = 'closed'
         AND closed_at IS NOT NULL
         AND closed_at < unixepoch() - 86400`,
    )
      .run()
      .catch((e) => {
        console.warn('[sweepStaleTerminalSessions] purge', e?.message ?? e);
        return null;
      });
    const purged = Number(purgedResult?.meta?.changes ?? purgedResult?.changes ?? 0) || 0;
    const r = await env.DB.prepare(
      `UPDATE terminal_sessions
       SET status = 'closed', closed_at = unixepoch(), updated_at = unixepoch()
       WHERE status = 'active'
         AND updated_at < unixepoch() - 86400`,
    ).run();
    const closed = Number(r.meta?.changes ?? r.changes ?? 0) || 0;
    if (closed > 0 || purged > 0) {
      console.log('[cron] terminal_sessions swept:', closed, 'stale closed;', purged, 'purged');
    }
    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: 0,
        rowsWritten: closed + purged,
        metadata: { closed, purged },
      });
    }
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn('[cron] sweepStaleTerminalSessions', e?.message ?? e);
  }
}
