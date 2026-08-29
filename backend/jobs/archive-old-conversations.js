import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';

const STALE_DAYS = 60;
const BATCH_LIMIT = 50;

/**
 * Close work_sessions with no activity for STALE_DAYS.
 */
export async function archiveOldConversations(env) {
  if (!env?.DB) return { closed: 0, errors: [], total_candidates: 0 };
  const begun = await startCronRun(env, {
    jobName: 'archive_old_conversations',
    cronExpression: '0 0 * * *',
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  const cutoffExpr = `(unixepoch() - ${STALE_DAYS} * 86400)`;

  let rows = [];
  try {
    const out = await env.DB.prepare(
      `SELECT session_id, user_id, tenant_id, started_at
       FROM work_sessions
       WHERE last_activity_at < ${cutoffExpr}
         AND ended_at IS NULL
       LIMIT ?`,
    )
      .bind(BATCH_LIMIT)
      .all();
    rows = out?.results || [];
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    return { closed: 0, errors: [{ error: String(e?.message || e) }], total_candidates: 0 };
  }

  const errors = [];
  let closed = 0;
  for (const row of rows) {
    const sessionId = row.session_id != null ? String(row.session_id).trim() : String(row.id || '').trim();
    if (!sessionId) continue;
    try {
      await env.DB.prepare(
        `UPDATE work_sessions SET ended_at = unixepoch() WHERE session_id = ?`,
      )
        .bind(sessionId)
        .run();
      closed += 1;
    } catch (e) {
      errors.push({ session_id: sessionId, error: String(e?.message || e) });
    }
  }

  if (runId) {
    await completeCronRun(env, runId, startedAt, {
      rowsRead: rows.length,
      rowsWritten: closed,
      metadata: { total_candidates: rows.length, error_count: errors.length },
    });
  }
  return { closed, errors, total_candidates: rows.length, archived: closed };
}
