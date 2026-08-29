/**
 * Conversation tool manifest identity — compile-once cache gate inputs.
 */

import { canonicalJsonString, sha256Hex } from './hash.js';

/**
 * @param {{
 *   actorContextHash?: string|null,
 *   actorPolicyHash?: string|null,
 *   toolProfileHash?: string|null,
 *   toolProfileRevision?: string|null,
 *   catalogGeneration?: string|null,
 *   runtimeProfileVersion?: number|null,
 *   mode?: string|null,
 * }} inputs
 */
export async function computeToolManifestHash(inputs = {}) {
  const payload = {
    actor_context_hash: String(inputs.actorContextHash || '').trim(),
    actor_policy_hash: String(inputs.actorPolicyHash || '').trim(),
    tool_profile_hash: String(inputs.toolProfileHash || '').trim(),
    tool_profile_revision: String(inputs.toolProfileRevision || '').trim(),
    catalog_generation: String(inputs.catalogGeneration || '0').trim(),
    runtime_profile_version: Number(inputs.runtimeProfileVersion) || 0,
    mode: String(inputs.mode || '').trim().toLowerCase(),
  };
  return sha256Hex(canonicalJsonString(payload));
}
