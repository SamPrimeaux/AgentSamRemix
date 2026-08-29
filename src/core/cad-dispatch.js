/**
 * CAD job dispatch — CF iam-cad-worker container only.
 *
 * No GCP / ExecOS / iam-tunnel path. The VM is not CAD-capable.
 * See docs/platform/iam-tunnel-vm-role-2026-07.md
 */
import { probeIamCadWorkerContainer, dispatchCadJobToContainer } from './iam-cad-worker-container.js';

/** Always `container` — kept for API response / health shape compatibility. */
export function resolveCadDispatchTarget(_env) {
  return 'container';
}

/**
 * @param {any} env
 * @param {any} ctx
 * @param {string} jobId
 * @param {{ userId: string, tenantId?: string|null, workspaceId: string }} auth
 */
export async function dispatchCadJob(env, ctx, jobId, auth) {
  return dispatchCadJobToContainer(env, ctx, jobId, auth);
}

/**
 * CAD compute health = container lane only.
 * @param {any} env
 * @param {{ userId?: string|null, tenantId?: string|null, workspaceId?: string|null }} [_ctx]
 */
export async function probeCadComputeHealth(env, _ctx = {}) {
  const container = await probeIamCadWorkerContainer(env);
  return {
    ok: !!(container.ok && container.toolchain_ok),
    dispatch_target: 'container',
    container_lane: {
      ok: container.ok,
      bound: container.bound,
      toolchain_ok: container.toolchain_ok,
      image: container.image,
      error: container.error || null,
    },
  };
}

/** User-facing dispatch label for API responses. */
export function cadDispatchLabel(_result) {
  return 'CAD job dispatched to IAM CAD worker container';
}
