/**
 * Every-30-minute cron — snapshot pg_stat_statements deltas into D1 for Supabase analytics charts.
 */
import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';
import { runPgStatStatementsSnapshot } from '../services/analytics/pg-stat-snapshot.js';

const CRON_30 = '*/30 * * * *';

/**
 * @param {any} env
 */
export async function runPgStatStatementsSnapshotCron(env) {
  const begun = await startCronRun(env, {
    jobName: 'pg_stat_statements_snapshot',
    cronExpression: CRON_30,
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  try {
    const out = await runPgStatStatementsSnapshot(env, { windowSeconds: 30 * 60 });
    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: Number(out.rowsRead || 0),
        rowsWritten: Number(out.rowsWritten || 0),
        metadata: {
          ok: out.ok !== false,
          skipped: out.skipped || null,
          ...(out.metadata && typeof out.metadata === 'object' ? out.metadata : {}),
        },
      });
    }
    return out;
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn('[cron] pg_stat_statements_snapshot', e?.message ?? e);
    throw e;
  }
}
