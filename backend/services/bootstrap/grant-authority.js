/**
 * Short-lived delegation grants — actor ∩ plane ∩ requested capabilities.
 */

import { canonicalJsonString, sha256Hex } from './hash.js';
import { delegationGrantKey } from './kv-keys.js';

const DEFAULT_GRANT_TTL_SECONDS = 300;

/**
 * @param {{
 *   actorId: string,
 *   workspaceId: string,
 *   tenantId?: string|null,
 *   conversationId?: string|null,
 *   planeId: string,
 *   actorHash: string,
 *   planeHash: string,
 *   conversationHash?: string|null,
 *   requestedCapabilities?: string[],
 *   actorCapabilities?: string[],
 *   planeAllow?: string[],
 *   planeDeny?: string[],
 *   ttlSeconds?: number,
 * }} input
 */
export async function compileDelegationGrant(env, input) {
  const actorId = String(input.actorId || '').trim();
  const workspaceId = String(input.workspaceId || '').trim();
  const planeId = String(input.planeId || '').trim();
  if (!actorId || !workspaceId || !planeId) {
    return { ok: false, error: 'grant_scope_required' };
  }

  const requested = (input.requestedCapabilities || [])
    .map((c) => String(c).trim())
    .filter(Boolean);
  const actorSet = new Set((input.actorCapabilities || []).map((c) => String(c).trim()).filter(Boolean));
  const planeAllow = new Set((input.planeAllow || []).map((c) => String(c).trim()).filter(Boolean));
  const planeDeny = new Set((input.planeDeny || []).map((c) => String(c).trim()).filter(Boolean));

  /** @type {string[]} */
  const capabilities = [];
  for (const cap of requested) {
    if (planeDeny.has(cap)) continue;
    if (planeAllow.size > 0 && !planeAllow.has(cap)) continue;
    if (actorSet.size > 0 && !actorSet.has(cap)) continue;
    capabilities.push(cap);
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const ttl = Number(input.ttlSeconds) > 0 ? Number(input.ttlSeconds) : DEFAULT_GRANT_TTL_SECONDS;
  const expiresAt = issuedAt + ttl;

  const body = {
    schema_version: 1,
    actor_id: actorId,
    workspace_id: workspaceId,
    tenant_id: input.tenantId != null ? String(input.tenantId) : null,
    conversation_id: input.conversationId != null ? String(input.conversationId) : null,
    plane_id: planeId,
    actor_hash: String(input.actorHash || '').trim(),
    plane_hash: String(input.planeHash || '').trim(),
    conversation_hash: input.conversationHash != null ? String(input.conversationHash) : null,
    capabilities,
    issued_at_unix: issuedAt,
    expires_at_unix: expiresAt,
  };

  const grantHash = await sha256Hex(canonicalJsonString(body));
  const grant = { ...body, grant_hash: grantHash };

  const kv = env?.KV;
  if (kv && typeof kv.put === 'function') {
    await kv.put(delegationGrantKey(grantHash), JSON.stringify(grant), {
      expirationTtl: ttl,
    }).catch(() => {});
  }

  return { ok: true, grant, grant_key: delegationGrantKey(grantHash) };
}

/**
 * @param {unknown} env
 * @param {string} grantHash
 * @param {{ planeId: string, actorId: string, workspaceId: string, capability: string }} expect
 */
export async function validateDelegationGrant(env, grantHash, expect) {
  const kv = env?.KV;
  const key = delegationGrantKey(grantHash);
  if (!kv || !key) return { ok: false, error: 'kv_unavailable' };

  let grant = null;
  try {
    const raw = await kv.get(key);
    grant = raw ? JSON.parse(String(raw)) : null;
  } catch {
    return { ok: false, error: 'grant_parse_failed' };
  }
  if (!grant) return { ok: false, error: 'grant_missing' };

  const now = Math.floor(Date.now() / 1000);
  if (Number(grant.expires_at_unix) <= now) return { ok: false, error: 'grant_expired' };
  if (String(grant.plane_id) !== String(expect.planeId)) return { ok: false, error: 'grant_plane_mismatch' };
  if (String(grant.actor_id) !== String(expect.actorId)) return { ok: false, error: 'grant_actor_mismatch' };
  if (String(grant.workspace_id) !== String(expect.workspaceId)) {
    return { ok: false, error: 'grant_workspace_mismatch' };
  }

  const caps = Array.isArray(grant.capabilities) ? grant.capabilities : [];
  if (!caps.includes(expect.capability)) return { ok: false, error: 'grant_capability_denied' };

  return { ok: true, grant };
}
