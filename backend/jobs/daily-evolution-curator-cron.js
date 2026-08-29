/**
 * Cron: daily evolution curator (04:05 America/Chicago ≈ 09:05 UTC during CDT).
 */
import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';
import { runDailyEvolutionCurator } from '../../src/core/daily-evolution-curator.js';

export const CRON_DAILY_EVOLUTION = '5 9 * * *';

/**
 * @param {any} env
 * @param {ExecutionContext} [ctx]
 */
export async function runDailyEvolutionCuratorCron(env, ctx) {
  const begun = await startCronRun(env, {
    jobName: 'daily_evolution_curator',
    cronExpression: CRON_DAILY_EVOLUTION,
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();

  try {
    const out = await runDailyEvolutionCurator(env);
    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: 0,
        rowsWritten: Number(out?.workspace_count) || 0,
        metadata: out?.metadata || {},
      });
    }
    if (out?.ok !== true) {
      console.warn('[cron] daily_evolution_curator', out?.error || 'partial_failure', out);
    }
    return out;
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn('[cron] daily_evolution_curator', e?.message ?? e);
    throw e;
  }
}
