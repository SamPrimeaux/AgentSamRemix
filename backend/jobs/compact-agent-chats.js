import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';

const ARCHIVE_DAYS = 30;
const MIN_RUNS = 5;
const BATCH_LIMIT = 20;

/**
 * Archive stale high-volume agent runs to R2 and prune D1 rows.
 */
export async function compactAgentChatsToR2(env) {
  const bucket = env?.BUCKET || env?.R2;
  if (!env?.DB || !bucket) {
    return { conversations: 0, archived: 0, key: '', error: 'DB or R2/BUCKET missing' };
  }
  const begun = await startCronRun(env, {
    jobName: 'compact_agent_chats_r2',
    cronExpression: '0 6 * * *',
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  const cutoffExpr = `(unixepoch() - ${ARCHIVE_DAYS} * 86400)`;

  let rows = [];
  try {
    const out = await env.DB.prepare(
      `SELECT conversation_id, COUNT(*) AS run_count,
        SUM(cost_usd) AS total_cost,
        SUM(input_tokens) AS total_in, SUM(output_tokens) AS total_out,
        MIN(created_at_unix) AS first_at, MAX(created_at_unix) AS last_at
       FROM agentsam_agent_run
       WHERE status = 'completed'
         AND created_at_unix < ${cutoffExpr}
       GROUP BY conversation_id
       HAVING run_count > ?
       LIMIT ?`,
    )
      .bind(MIN_RUNS, BATCH_LIMIT)
      .all();
    rows = out?.results || [];
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    return { conversations: 0, archived: 0, key: '', error: String(e?.message || e) };
  }

  let archived = 0;
  for (const row of rows) {
    const conversationId = row.conversation_id != null ? String(row.conversation_id).trim() : '';
    if (!conversationId) continue;
    const summary = {
      conversation_id: conversationId,
      run_count: Number(row.run_count) || 0,
      total_cost: Number(row.total_cost) || 0,
      total_in: Number(row.total_in) || 0,
      total_out: Number(row.total_out) || 0,
      first_at: row.first_at != null ? Number(row.first_at) : null,
      last_at: row.last_at != null ? Number(row.last_at) : null,
      archived_at: Date.now(),
    };
    const key = `archive/conversations/${conversationId}/summary.json`;
    try {
      await bucket.put(key, JSON.stringify(summary), {
        httpMetadata: { contentType: 'application/json' },
      });
      await env.DB.prepare(
        `DELETE FROM agentsam_agent_run
         WHERE conversation_id = ?
           AND created_at_unix < ${cutoffExpr}`,
      )
        .bind(conversationId)
        .run();
      archived += 1;
    } catch (e) {
      console.warn('[compact_agent_chats_r2] archive failed for', conversationId, e?.message ?? e);
    }
  }

  if (runId) {
    await completeCronRun(env, runId, startedAt, {
      rowsRead: rows.length,
      rowsWritten: archived,
      metadata: { conversations: rows.length, archived },
    });
  }
  return { conversations: rows.length, archived, key: '' };
}
