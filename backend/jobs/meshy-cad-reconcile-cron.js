/** Safety-net Meshy CAD reconcile — only when in-flight jobs exist (no idle ledger writes). */

import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';
import {
  countInFlightMeshyCadJobs,
  runMeshyCadReconcileCron,
} from '../../src/core/meshy-cad-reconcile.js';

export const CRON_MESHY_CAD_SAFETY = '*/20 * * * *';

/**
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function runMeshyCadReconcileJobs(env, ctx) {
  const inFlight = await countInFlightMeshyCadJobs(env);
  if (inFlight <= 0) {
    return { skipped: true, rowsRead: 0, rowsWritten: 0, metadata: { inFlight: 0 } };
  }

  const begun = await startCronRun(env, {
    jobName: 'meshy_cad_reconcile',
    cronExpression: CRON_MESHY_CAD_SAFETY,
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  try {
    const out = await runMeshyCadReconcileCron(env, ctx);
    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: Number(out?.rowsRead) || 0,
        rowsWritten: Number(out?.rowsWritten) || 0,
        metadata: { ...(out?.metadata ?? {}), inFlight },
      });
    }
    return out;
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn('[cron] meshy_cad_reconcile', e?.message ?? e);
    throw e;
  }
}
