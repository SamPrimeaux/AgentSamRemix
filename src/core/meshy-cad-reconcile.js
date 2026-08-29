/**
 * Server-side Meshy CAD reconciliation — poll in-flight jobs + finalize GLB polish (progress_pct=92).
 * Primary: webhooks + per-job waitUntil on create. Safety net: optional cron when in-flight > 0.
 */
import { applyMeshyTaskToCadJob } from './meshy-cad-sync.js';
import { getMeshyTask } from './meshy-api.js';
import { resolveMeshyAuth, isMeshyAuthMissing } from './meshy-api-key.js';
import { dispatchMeshyGlbOptimize } from './glb-optimize-dispatch.js';
import { finalizeCadJobComplete } from './cad-job-complete.js';
import { buildCadAssetPublicUrl } from './cad-job-scope.js';

const BATCH = 8;
const TERMINAL_STATUSES = new Set(['done', 'complete', 'completed', 'failed', 'cancelled', 'canceled']);
const JOB_POLL_INTERVAL_MS = 5000;
const JOB_POLL_MAX_ATTEMPTS = 120;

function parseTextureData(raw) {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

const IN_FLIGHT_COUNT_SQL = `
  SELECT COUNT(*) AS n FROM agentsam_cad_jobs
   WHERE engine = 'meshy'
     AND (
       (
         status IN ('pending', 'running', 'queued', 'accepted')
         AND external_task_id IS NOT NULL
         AND (progress_pct IS NULL OR progress_pct < 92)
       )
       OR (
         status = 'running'
         AND progress_pct >= 92
         AND texture_data LIKE '%"glb_optimize_pending":true%'
       )
     )`;

/**
 * Cheap gate — no ledger, no batch work when idle.
 * @param {any} env
 */
export async function countInFlightMeshyCadJobs(env) {
  if (!env?.DB) return 0;
  try {
    const row = await env.DB.prepare(IN_FLIGHT_COUNT_SQL).first();
    return Number(row?.n) || 0;
  } catch {
    return 0;
  }
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {object} job agentsam_cad_jobs row
 */
async function reconcileMeshyCadJobRow(env, ctx, job) {
  if (!job?.id) return { rowsRead: 0, rowsWritten: 0 };

  const progressPct = Number(job.progress_pct) || 0;
  const td = parseTextureData(job.texture_data);
  const isPolish =
    String(job.status || '').toLowerCase() === 'running' &&
    progressPct >= 92 &&
    td.glb_optimize_pending === true;

  if (isPolish) {
    if (td.glb_optimized === true && td.glb_optimize_pending !== true) {
      const publicUrl =
        String(job.result_url || '').trim() ||
        buildCadAssetPublicUrl(String(job.r2_key || '').trim());
      await finalizeCadJobComplete(env, ctx, {
        job_id: String(job.id),
        status: 'done',
        r2_key: job.r2_key,
        r2_bucket: job.r2_bucket,
        public_url: publicUrl,
        runner_host: 'meshy_cad_reconcile',
      });
      return { rowsRead: 1, rowsWritten: 1 };
    }
    const out = await dispatchMeshyGlbOptimize(env, ctx, job);
    return { rowsRead: 1, rowsWritten: out?.ok ? 1 : 0 };
  }

  const taskType = String(job.task_type || 'text-to-3d').trim();
  const extId = String(job.external_task_id || '').trim();
  if (!extId) return { rowsRead: 0, rowsWritten: 0 };

  const meshyAuth = await resolveMeshyAuth(env, {
    userId: job.user_id,
    tenantId: job.tenant_id,
    user_id: job.user_id,
    tenant_id: job.tenant_id,
  });
  if (isMeshyAuthMissing(meshyAuth)) return { rowsRead: 1, rowsWritten: 0 };

  const task = await getMeshyTask(env, taskType, extId, meshyAuth);
  await applyMeshyTaskToCadJob(env, ctx, task);
  return { rowsRead: 1, rowsWritten: 1 };
}

/**
 * Poll one job until terminal or max attempts (tab-away background reconcile).
 * @param {any} env
 * @param {any} ctx
 * @param {string} jobId
 */
export async function reconcileMeshyCadJobUntilIdle(env, ctx, jobId) {
  const id = String(jobId || '').trim();
  if (!id || !env?.DB) return;

  for (let attempt = 0; attempt < JOB_POLL_MAX_ATTEMPTS; attempt += 1) {
    const job = await env.DB.prepare(`SELECT * FROM agentsam_cad_jobs WHERE id = ? LIMIT 1`)
      .bind(id)
      .first()
      .catch(() => null);
    if (!job?.id) return;

    const status = String(job.status || '').toLowerCase();
    if (TERMINAL_STATUSES.has(status)) return;

    try {
      await reconcileMeshyCadJobRow(env, ctx, job);
    } catch (e) {
      console.warn('[meshy-cad-reconcile] job poll', id, e?.message ?? e);
    }

    const refreshed = await env.DB.prepare(`SELECT status FROM agentsam_cad_jobs WHERE id = ? LIMIT 1`)
      .bind(id)
      .first()
      .catch(() => null);
    const nextStatus = String(refreshed?.status || '').toLowerCase();
    if (TERMINAL_STATUSES.has(nextStatus)) return;

    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

/**
 * @param {any} env
 * @param {ExecutionContext | null | undefined} ctx
 * @param {string} jobId
 */
export function scheduleMeshyCadJobReconcile(env, ctx, jobId) {
  if (!ctx?.waitUntil || !jobId) return;
  ctx.waitUntil(
    reconcileMeshyCadJobUntilIdle(env, ctx, jobId).catch((e) =>
      console.warn('[meshy-cad-reconcile] waitUntil', jobId, e?.message ?? e),
    ),
  );
}

/**
 * @param {any} env
 * @param {any} ctx
 */
export async function runMeshyCadReconcileCron(env, ctx) {
  if (!env?.DB) return { rowsRead: 0, rowsWritten: 0, metadata: {} };

  let rowsRead = 0;
  let rowsWritten = 0;
  let meshyPolled = 0;
  let polishDispatched = 0;
  let polishFinalized = 0;

  const { results: inFlight } = await env.DB.prepare(
    `SELECT * FROM agentsam_cad_jobs
     WHERE engine = 'meshy'
       AND status IN ('pending', 'running', 'queued', 'accepted')
       AND external_task_id IS NOT NULL
       AND (progress_pct IS NULL OR progress_pct < 92)
       AND updated_at < unixepoch() - 15
     ORDER BY updated_at ASC
     LIMIT ?`,
  )
    .bind(BATCH)
    .all()
    .catch(() => ({ results: [] }));

  for (const job of inFlight || []) {
    try {
      const out = await reconcileMeshyCadJobRow(env, ctx, job);
      rowsRead += out.rowsRead;
      rowsWritten += out.rowsWritten;
      if (out.rowsWritten) meshyPolled += 1;
    } catch (e) {
      rowsRead += 1;
      console.warn('[meshy-cad-reconcile] poll', job.id, e?.message ?? e);
    }
  }

  const { results: polishPending } = await env.DB.prepare(
    `SELECT * FROM agentsam_cad_jobs
     WHERE engine = 'meshy'
       AND status = 'running'
       AND progress_pct >= 92
       AND texture_data LIKE '%"glb_optimize_pending":true%'
       AND updated_at < unixepoch() - 20
     ORDER BY updated_at ASC
     LIMIT ?`,
  )
    .bind(BATCH)
    .all()
    .catch(() => ({ results: [] }));

  for (const job of polishPending || []) {
    try {
      const out = await reconcileMeshyCadJobRow(env, ctx, job);
      rowsRead += out.rowsRead;
      rowsWritten += out.rowsWritten;
      if (out.rowsWritten) {
        const td = parseTextureData(job.texture_data);
        if (td.glb_optimized === true) polishFinalized += 1;
        else polishDispatched += 1;
      }
    } catch (e) {
      rowsRead += 1;
      console.warn('[meshy-cad-reconcile] polish', job.id, e?.message ?? e);
    }
  }

  return {
    rowsRead,
    rowsWritten,
    metadata: { meshyPolled, polishDispatched, polishFinalized },
  };
}
