/**
 * Dispatch Meshy GLB post-process (gltf-transform meshopt + webp) to ExecOS GCP.
 * Workers cannot run native gltf-transform/sharp — this runs invisibly after ingest.
 */
import { runExecOsCommand, resolveCadExecRepoRoot } from './execos-fabric.js';

const RUNNER_HOST = 'execos-gcp';
const GLB_OPT_TIMEOUT_MS = 300_000;

/**
 * @param {Record<string, unknown> | null | undefined} raw
 * @param {Record<string, unknown>} patch
 */
export function mergeCadJobTextureData(raw, patch) {
  let base = {};
  if (raw) {
    try {
      base = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      base = {};
    }
  }
  return JSON.stringify({ ...base, ...patch });
}

/**
 * Fire-and-forget: optimize ingested Meshy GLB on ExecOS, then job-complete marks done.
 * @param {any} env
 * @param {any} ctx
 * @param {Record<string, unknown>} job
 */
export async function dispatchMeshyGlbOptimize(env, ctx, job) {
  const jobId = String(job?.id || '').trim();
  if (!jobId) return { ok: false, reason: 'missing_job_id' };

  const userId = job.user_id != null ? String(job.user_id) : '';
  const workspaceId = job.workspace_id != null ? String(job.workspace_id) : '';
  const tenantId = job.tenant_id != null ? String(job.tenant_id) : null;

  const resolved = await resolveCadExecRepoRoot(env, {
    userId,
    tenantId,
    workspaceId,
    target: 'remote',
  });
  const repoRoot = resolved?.repoRoot;
  if (!repoRoot) {
    console.warn('[glb-optimize-dispatch] repo unresolved — meshy-glb-optimize-runner will pick up', jobId);
    return { ok: false, reason: 'execos_workspace_unresolved', fallback: 'runner_poll' };
  }

  const cmd = [
    'set -euo pipefail',
    './scripts/with-cloudflare-env.sh node scripts/designstudio/meshy-glb-optimize-runner.mjs --once',
    `--job-id=${JSON.stringify(jobId)}`,
  ].join(' ');

  const res = await runExecOsCommand(env, {
    command: cmd,
    cwd: repoRoot,
    target: 'remote',
    timeout_ms: GLB_OPT_TIMEOUT_MS,
  });

  if (!res.ok || (res.exit_code != null && res.exit_code !== 0)) {
    console.warn(
      '[glb-optimize-dispatch] ExecOS failed — runner poll fallback',
      jobId,
      res.stderr?.slice(0, 200) || res.error,
    );
    return {
      ok: false,
      reason: 'execos_exec_failed',
      fallback: 'runner_poll',
      runner_host: RUNNER_HOST,
    };
  }

  return { ok: true, job_id: jobId, runner_host: RUNNER_HOST, repo_root: repoRoot };
}
