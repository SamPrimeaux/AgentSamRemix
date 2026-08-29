/**
 * Step 8 — nightly agent run archive + prune (after EPM + ETO at 1 AM).
 */

import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';
import { writeContextToR2 } from '../services/context/r2-context-store.js';
import { pragmaTableInfo } from '../services/retention.js';

const CRON_ONE_AM = '0 1 * * *';
const ARCHIVE_HOURS = 48;
const PURGE_SECONDS = 2 * 86400;
const BATCH_LIMIT = 200;

/**
 * Archive completed/failed runs (48h+, ETO-scored) to per-user daily R2 JSON.
 * @param {any} env
 */
export async function archiveAgentRunsDailyToR2(env) {
  if (!env?.DB || !env?.AUTORAG_BUCKET) {
    return { archived: 0, skipped: true, reason: 'missing_db_or_autorag' };
  }

  const runCols = await pragmaTableInfo(env.DB, 'agentsam_agent_run');
  if (!runCols.has('user_id') || !runCols.has('workspace_id')) {
    return { archived: 0, skipped: true, reason: 'agent_run_schema' };
  }

  const cutoff = `unixepoch('now', '-${ARCHIVE_HOURS} hours')`;
  const dateLabel = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const { results: users = [] } = await env.DB.prepare(
    `SELECT ar.user_id, ar.workspace_id,
            COALESCE(NULLIF(trim(ar.tenant_id), ''), NULLIF(trim(au.active_tenant_id), ''), NULLIF(trim(au.tenant_id), ''), 'system') AS tenant_id,
            COUNT(*) AS run_count,
            SUM(COALESCE(ar.cost_usd, 0)) AS total_cost,
            SUM(COALESCE(ar.input_tokens, 0)) AS total_in,
            SUM(COALESCE(ar.output_tokens, 0)) AS total_out,
            SUM(CASE WHEN ar.status = 'completed' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN ar.status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM agentsam_agent_run ar
     LEFT JOIN auth_users au ON au.id = ar.user_id
     WHERE ar.status NOT IN ('running', 'queued')
       AND COALESCE(ar.created_at_unix, CAST(strftime('%s', ar.created_at) AS INTEGER)) < ${cutoff}
       AND EXISTS (
         SELECT 1 FROM agentsam_performance_eto_events e
         WHERE e.source_table = 'agentsam_agent_run' AND e.source_id = ar.id
       )
     GROUP BY ar.user_id, ar.workspace_id, tenant_id
     LIMIT ${BATCH_LIMIT}`,
  )
    .all()
    .catch(() => ({ results: [] }));

  let archived = 0;
  for (const row of users) {
    const userId = String(row.user_id || '').trim();
    const workspaceId = String(row.workspace_id || '').trim();
    const tenantId = String(row.tenant_id || 'system').trim();
    if (!userId || !workspaceId) continue;

    const payload = {
      period_date: dateLabel,
      user_id: userId,
      workspace_id: workspaceId,
      run_count: Number(row.run_count) || 0,
      completed: Number(row.completed) || 0,
      failed: Number(row.failed) || 0,
      total_cost: Number(row.total_cost) || 0,
      total_in: Number(row.total_in) || 0,
      total_out: Number(row.total_out) || 0,
      archived_at: Date.now(),
    };

    const key = await writeContextToR2(env, {
      tenantId,
      userId,
      workspaceId,
      conversationId: 'runs',
      type: `daily_${dateLabel.replace(/-/g, '')}`,
      content: payload,
    });
    console.log('[compaction]', 'agent_run_r2_archive', { key, rowCount: payload.run_count });
    if (key) archived += 1;
  }

  return { archived, users: users.length };
}

/**
 * Prune completed/failed agentsam_agent_run rows older than 48h (ETO-scored only).
 * Not agentsam_usage_rollups_daily — that table is written by usage rollup paths.
 * Clears child FKs first so DELETE does not fail SQLITE_CONSTRAINT_FOREIGNKEY.
 * @param {any} env
 */
export async function pruneCompletedAgentRuns(env) {
  if (!env?.DB) return { deleted: 0 };

  const agePred = `COALESCE(created_at_unix, CAST(strftime('%s', created_at) AS INTEGER)) < unixepoch('now', '-${PURGE_SECONDS} seconds')`;
  const eligible = `status NOT IN ('running', 'queued')
       AND ${agePred}
       AND EXISTS (
         SELECT 1 FROM agentsam_performance_eto_events e
         WHERE e.source_table = 'agentsam_agent_run' AND e.source_id = agentsam_agent_run.id
       )`;

  try {
    const { results: rows = [] } = await env.DB.prepare(
      `SELECT id FROM agentsam_agent_run WHERE ${eligible} LIMIT ${BATCH_LIMIT}`,
    ).all();
    const ids = (rows || []).map((r) => String(r.id || '').trim()).filter(Boolean);
    if (!ids.length) {
      console.log('[compaction]', 'agent_run_prune', { rowCount: 0 });
      return { deleted: 0 };
    }

    const placeholders = ids.map(() => '?').join(',');
    // Optional FKs — null them so agent_run DELETE can proceed.
    await env.DB.prepare(
      `UPDATE time_entries SET agent_run_id = NULL WHERE agent_run_id IN (${placeholders})`,
    )
      .bind(...ids)
      .run()
      .catch(() => null);
    await env.DB.prepare(
      `UPDATE agentsam_patch_sessions SET agent_run_id = NULL WHERE agent_run_id IN (${placeholders})`,
    )
      .bind(...ids)
      .run()
      .catch(() => null);
    await env.DB.prepare(
      `UPDATE agentsam_compaction_events SET agent_run_id = NULL WHERE agent_run_id IN (${placeholders})`,
    )
      .bind(...ids)
      .run()
      .catch(() => null);
    // spawn_job.master_run_id is NOT NULL — delete dependents first.
    await env.DB.prepare(
      `DELETE FROM agentsam_spawn_job WHERE master_run_id IN (${placeholders})`,
    )
      .bind(...ids)
      .run()
      .catch(() => null);

    const res = await env.DB.prepare(
      `DELETE FROM agentsam_agent_run WHERE id IN (${placeholders})`,
    )
      .bind(...ids)
      .run();
    const deleted = Number(res?.meta?.changes ?? res?.changes ?? 0) || 0;
    console.log('[compaction]', 'agent_run_prune', { rowCount: deleted, table: 'agentsam_agent_run' });
    return { deleted };
  } catch (e) {
    console.warn('[agent-run-prune] agentsam_agent_run', e?.message ?? e);
    return { deleted: 0, error: String(e?.message || e) };
  }
}

/**
 * @param {any} env
 */
export async function runAgentRunDailyRollup(env) {
  const begun = await startCronRun(env, {
    jobName: 'agent_run_daily_rollup',
    cronExpression: CRON_ONE_AM,
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();

  try {
    const archive = await archiveAgentRunsDailyToR2(env);
    const prune = await pruneCompletedAgentRuns(env);
    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: archive.users ?? 0,
        rowsWritten: (archive.archived ?? 0) + (prune.deleted ?? 0),
        metadata: { archive, prune },
      });
    }
    return { archive, prune };
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    throw e;
  }
}
