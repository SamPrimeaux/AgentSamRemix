/**
 * Plane authority compiler — D1 registry → MCP_TOKENS pointer + snapshot.
 */

import { canonicalJsonString, sha256Hex } from './hash.js';
import { planePointerKey, planeSnapshotKey } from './kv-keys.js';

/**
 * @param {unknown} env
 * @param {string} planeId
 */
export async function loadAuthorityPlaneRow(env, planeId) {
  const id = String(planeId || '').trim();
  if (!env?.DB || !id) return null;
  try {
    return await env.DB.prepare(
      `SELECT *
         FROM agentsam_authority_planes
        WHERE plane_id = ?
          AND COALESCE(is_active, 1) = 1
        LIMIT 1`,
    )
      .bind(id)
      .first();
  } catch {
    return null;
  }
}

function parseJsonArray(raw, fallback = []) {
  if (raw == null || raw === '') return fallback;
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * @param {Record<string, unknown>} row
 */
export async function compilePlaneAuthoritySnapshot(row) {
  const planeId = String(row.plane_id || '').trim();
  const allow = parseJsonArray(row.capabilities_json);
  const deny = parseJsonArray(row.denied_capabilities_json);
  const policyVersion = Number(row.policy_version) || 1;
  const payload = {
    schema_version: 1,
    plane_id: planeId,
    tenant_id: row.tenant_id != null ? String(row.tenant_id) : null,
    workspace_id: row.workspace_id != null ? String(row.workspace_id) : null,
    display_name: row.display_name != null ? String(row.display_name) : planeId,
    trust_type: row.trust_type != null ? String(row.trust_type) : 'service_binding',
    trust_ref: row.trust_ref != null ? String(row.trust_ref) : null,
    policy_version: policyVersion,
    allow,
    deny,
  };
  const planeHash = await sha256Hex(canonicalJsonString(payload));
  return { ...payload, plane_hash: planeHash };
}

/**
 * @param {unknown} env
 * @param {string} planeId
 */
export async function resolvePlaneAuthority(env, planeId) {
  const row = await loadAuthorityPlaneRow(env, planeId);
  if (!row) return { ok: false, error: 'plane_not_found' };

  const snapshot = await compilePlaneAuthoritySnapshot(row);
  const kv = env?.KV;
  if (kv && typeof kv.put === 'function') {
    const pointerKey = planePointerKey(snapshot.plane_id);
    const snapshotKey = planeSnapshotKey(snapshot.plane_hash);
    await kv.put(snapshotKey, JSON.stringify(snapshot), {
      expirationTtl: 7 * 24 * 60 * 60,
    }).catch(() => {});
    await kv.put(
      pointerKey,
      JSON.stringify({
        schema_version: 1,
        plane_hash: snapshot.plane_hash,
        policy_version: snapshot.policy_version,
        updated_at_unix: Math.floor(Date.now() / 1000),
      }),
      { expirationTtl: 7 * 24 * 60 * 60 },
    ).catch(() => {});
  }

  return { ok: true, snapshot, pointer_key: planePointerKey(snapshot.plane_id) };
}

/**
 * Effective capability check: actor allow ∩ plane allow − plane deny.
 * @param {string[]} actorCaps
 * @param {{ allow?: string[], deny?: string[] }} plane
 * @param {string} capability
 */
export function planeAllowsCapability(actorCaps, plane, capability) {
  const cap = String(capability || '').trim();
  if (!cap) return false;
  const actorSet = new Set((actorCaps || []).map((c) => String(c).trim()).filter(Boolean));
  const planeAllow = new Set((plane?.allow || []).map((c) => String(c).trim()).filter(Boolean));
  const planeDeny = new Set((plane?.deny || []).map((c) => String(c).trim()).filter(Boolean));
  if (planeDeny.has(cap)) return false;
  if (planeAllow.size > 0 && !planeAllow.has(cap)) return false;
  if (actorSet.size > 0 && !actorSet.has(cap)) return false;
  return planeAllow.has(cap) || actorSet.has(cap);
}
