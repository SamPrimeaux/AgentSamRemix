/**
 * Canonical JSON + SHA-256 for bootstrap cache identity.
 * Pure — no D1.
 */

import { BOOTSTRAP_POLICY_VERSION } from './contract.js';
import { deriveCapabilitiesFromPolicy } from './derive.js';

/** Bump when derive/materialize logic changes (invalidates cached rows). */
export const CURRENT_BOOTSTRAP_COMPILER_VERSION = 7;

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function canonicalize(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/**
 * @param {unknown} value
 */
export function canonicalJsonString(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * @param {string} input
 */
export async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {Array<{ role_id?: string, workspace_id?: string, tenant_id?: string }>} roles
 */
export function normalizeRolesForHash(roles = []) {
  return [...roles]
    .map((r) => ({
      role_id: String(r?.role_id || '').trim(),
      workspace_id: String(r?.workspace_id || '').trim(),
      tenant_id: String(r?.tenant_id || '').trim(),
    }))
    .filter((r) => r.role_id)
    .sort((a, b) =>
      `${a.role_id}\0${a.workspace_id}\0${a.tenant_id}`.localeCompare(
        `${b.role_id}\0${b.workspace_id}\0${b.tenant_id}`,
      ),
    );
}

/**
 * Hash of authoritative permission inputs.
 * @param {{
 *   userId: string,
 *   workspaceId: string,
 *   tenantId: string,
 *   policy?: Record<string, unknown>,
 *   governanceRoles?: unknown[],
 *   byokReadiness?: Record<string, unknown>,
 *   policyVersion?: number,
 * }} p
 */
export async function computePolicyHash(p) {
  const payload = {
    user_id: String(p.userId || '').trim(),
    workspace_id: String(p.workspaceId || '').trim(),
    tenant_id: String(p.tenantId || '').trim(),
    policy_version: Number(p.policyVersion) || BOOTSTRAP_POLICY_VERSION,
    user_policy: deriveCapabilitiesFromPolicy(p.policy),
    roles: normalizeRolesForHash(p.governanceRoles),
    byok: p.byokReadiness ?? null,
  };
  return sha256Hex(canonicalJsonString(payload));
}

/**
 * Hash of final materialized bootstrap snapshot.
 * @param {{
 *   userId: string,
 *   workspaceId: string,
 *   tenantId: string,
 *   policyVersion?: number,
 *   compilerVersion?: number,
 *   policyHash: string,
 *   capabilities?: Record<string, unknown>,
 *   governanceRoles?: unknown[],
 *   byokReadiness?: Record<string, unknown>,
 *   contextDigests?: unknown[],
 * }} p
 */
export async function computeContextHash(p) {
  const payload = {
    user_id: String(p.userId || '').trim(),
    workspace_id: String(p.workspaceId || '').trim(),
    tenant_id: String(p.tenantId || '').trim(),
    policy_version: Number(p.policyVersion) || BOOTSTRAP_POLICY_VERSION,
    generated_from_version: Number(p.compilerVersion) || CURRENT_BOOTSTRAP_COMPILER_VERSION,
    policy_hash: String(p.policyHash || '').trim(),
    capabilities: canonicalize(p.capabilities ?? {}),
    governance_roles: normalizeRolesForHash(p.governanceRoles),
    byok: p.byokReadiness ?? null,
    context_digests: Array.isArray(p.contextDigests) ? p.contextDigests : [],
  };
  return sha256Hex(canonicalJsonString(payload));
}

export {
  bootstrapKvCacheKey,
  legacyBootstrapKvCacheKey,
  mcpAllowlistVersionKey,
  mcpPermPointerKey,
  mcpPermSnapshotKey,
  mcpPermSnapshotLookupKeys,
  mcpTokenKvKey,
} from './kv-keys.js';

/**
 * @param {Record<string, unknown>|null|undefined} row
 * @param {{ policyHash: string, compilerVersion?: number }} expected
 */
export function bootstrapRowCacheValid(row, expected) {
  if (!row) return false;
  const storedPolicy = row.policy_hash != null ? String(row.policy_hash).trim() : '';
  const storedCompiler = Number(row.generated_from_version);
  const compiler = Number(expected.compilerVersion) || CURRENT_BOOTSTRAP_COMPILER_VERSION;
  return (
    storedPolicy === String(expected.policyHash || '').trim() &&
    storedCompiler === compiler &&
    Number(row.is_active) !== 0
  );
}
