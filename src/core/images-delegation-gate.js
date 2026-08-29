/**
 * images-worker plane — delegation grant compile + validate for env.IMAGES binding ops.
 */

import {
  compileDelegationGrant,
  validateDelegationGrant,
  resolvePlaneAuthority,
  readActorContextHashFromPointer,
} from './bootstrap-service-bridge.js';

const IMAGES_PLANE_ID = 'images-worker';

/**
 * Map CF Images binding operations to plane capability keys.
 * @param {'transform'|'read'|'generate'} op
 */
export function imagesCapabilityForOp(op) {
  const key = String(op || 'transform').trim().toLowerCase();
  if (key === 'generate') return 'images.generate';
  if (key === 'read') return 'images.read';
  return 'images.transform';
}

/**
 * @param {unknown} env
 * @param {{
 *   userId: string,
 *   workspaceId: string,
 *   tenantId?: string|null,
 *   conversationId?: string|null,
 *   capability?: string,
 *   actorContextHash?: string|null,
 *   requestedCapabilities?: string[],
 * }} scope
 */
export async function compileImagesDelegationGrant(env, scope) {
  const userId = String(scope.userId || '').trim();
  const workspaceId = String(scope.workspaceId || '').trim();
  const capability = String(scope.capability || 'images.transform').trim();
  if (!userId || !workspaceId) {
    return { ok: false, error: 'grant_scope_required' };
  }

  const actorHash =
    String(scope.actorContextHash || '').trim() ||
    (await readActorContextHashFromPointer(env, userId, workspaceId));

  const planeRes = await resolvePlaneAuthority(env, IMAGES_PLANE_ID);
  if (!planeRes.ok || !planeRes.snapshot) {
    return { ok: false, error: planeRes.error || 'plane_not_found' };
  }

  const plane = planeRes.snapshot;
  const requested = scope.requestedCapabilities?.length
    ? scope.requestedCapabilities
    : [capability];

  return compileDelegationGrant(env, {
    actorId: userId,
    workspaceId,
    tenantId: scope.tenantId,
    conversationId: scope.conversationId,
    planeId: IMAGES_PLANE_ID,
    actorHash,
    planeHash: plane.plane_hash,
    requestedCapabilities: requested,
    actorCapabilities: requested,
    planeAllow: plane.allow,
    planeDeny: plane.deny,
  });
}

/**
 * @param {unknown} env
 * @param {string} grantHash
 * @param {{
 *   userId: string,
 *   workspaceId: string,
 *   capability?: string,
 * }} expect
 */
export async function assertImagesPlaneGrant(env, grantHash, expect) {
  const hash = String(grantHash || '').trim();
  if (!hash) {
    return { ok: false, error: 'grant_hash_required' };
  }
  return validateDelegationGrant(env, hash, {
    planeId: IMAGES_PLANE_ID,
    actorId: String(expect.userId || '').trim(),
    workspaceId: String(expect.workspaceId || '').trim(),
    capability: String(expect.capability || 'images.transform').trim(),
  });
}
