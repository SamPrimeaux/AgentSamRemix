/**
 * resolveAgentSamBootstrap — single writer for agentsam_bootstrap v2 cache.
 *
 * Cache validity:
 *   stored.policy_hash == current policy_hash
 *   AND stored.generated_from_version == CURRENT_BOOTSTRAP_COMPILER_VERSION
 * → skip D1 rewrite; return materialized snapshot.
 *
 * Split into four concerns so each can be read/tested/changed independently:
 *   resolveBootstrapIdentity  — auth/authz only
 *   computeBootstrapCandidate — policy/governance/byok/digest + policyHash
 *   tryReadBootstrapCache     — D1 row hit + KV pointer/payload hit
 *   writeBootstrapSnapshot    — upsert + read-back + KV warm
 * resolveAgentSamBootstrap is the thin orchestrator: identity → candidate → read → write.
 */

import { resolveCanonicalUserId, fetchAuthUserTenantId } from '../../identity/users/index.js';
import { getAuthUser, loadAgentSamUserPolicy } from '../../identity/index.js';
import {
  resolveEffectiveWorkspaceId,
  resolveTenantIdForWorkspace,
} from '../../identity/bootstrap.js';
import { userCanAccessWorkspace } from '../../identity/workspace/access.js';
import {
  BOOTSTRAP_POLICY_VERSION,
  bootstrapRowId,
  parseJsonArray,
  parseJsonObject,
} from './contract.js';
import {
  deriveCapabilitiesFromPolicy,
  deriveGovernanceRolesFromRows,
  materializeBootstrapJson,
} from './derive.js';
import {
  bootstrapRowCacheValid,
  computeContextHash,
  computePolicyHash,
  CURRENT_BOOTSTRAP_COMPILER_VERSION,
  mcpPermPointerKey,
  mcpPermSnapshotKey,
} from './hash.js';
import {
  bootstrapResultFromKvCache,
  getBootstrapKvCache,
  getMcpPermPointer,
  putBootstrapKvCache,
} from './kv-cache.js';
import {
  deriveByokReadiness,
  normalizeByokReadinessForHash,
} from './byok-readiness.js';
import {
  loadWorkspaceDigestManifest,
  normalizeDigestManifestForHash,
} from './context-digest.js';

export const BOOTSTRAP_CONTEXT_MISSING = 'BOOTSTRAP_CONTEXT_MISSING';
export const BOOTSTRAP_FORBIDDEN = 'BOOTSTRAP_FORBIDDEN';

/**
 * @param {unknown} env
 * @param {string|null|undefined} email
 */
export async function resolveCanonicalAuthUserIdByEmail(env, email) {
  const em = email != null ? String(email).trim().toLowerCase() : '';
  if (!em || !env?.DB) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT id FROM auth_users
       WHERE LOWER(trim(COALESCE(email, ''))) = ?
       ORDER BY CASE WHEN lower(COALESCE(status, 'active')) = 'active' THEN 0 ELSE 1 END,
                COALESCE(created_at, updated_at, '1970-01-01') ASC
       LIMIT 1`,
    )
      .bind(em)
      .first();
    const id = row?.id != null ? String(row.id).trim() : '';
    return id.startsWith('au_') ? id : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} env
 * @param {{ userId: string, email?: string|null }} p
 */
export async function resolveCanonicalAuthUserId(env, p) {
  const uid = p.userId != null ? String(p.userId).trim() : '';
  if (!uid) return null;

  const canonical = await resolveCanonicalUserId(uid, env);
  if (canonical) return canonical;

  if (p.email) {
    return resolveCanonicalAuthUserIdByEmail(env, p.email);
  }

  return uid.startsWith('au_') ? uid : null;
}

// ─── Identity + authz resolution (who, which workspace, which tenant) ──────

/**
 * Resolves the authenticated actor and scope without loading policy or cache state.
 *
 * @param {unknown} env
 * @param {{
 *   userId: string,
 *   requestedWorkspaceId?: string|null,
 *   request?: Request|null,
 *   authUser?: Record<string, unknown>|null,
 *   cache?: Record<string, unknown>,
 * }} opts
 * @returns {Promise<
 *   { ok: true, authUser: any, canonicalUserId: string, workspaceId: string, tenantId: string }
 *   | { ok: false, error: string, code: string }
 * >}
 */
export async function resolveBootstrapIdentity(env, opts = {}) {
  const sessionUserId = opts.userId != null ? String(opts.userId).trim() : '';
  if (!sessionUserId) {
    return { ok: false, error: 'user_id_required', code: BOOTSTRAP_CONTEXT_MISSING };
  }

  let authUser = opts.authUser || null;
  if (!authUser && opts.request) {
    authUser = await getAuthUser(opts.request, env).catch(() => null);
  }
  if (!authUser?.id && sessionUserId) {
    try {
      const row = await env.DB.prepare(`SELECT * FROM auth_users WHERE id = ? LIMIT 1`)
        .bind(sessionUserId)
        .first();
      if (row) authUser = row;
    } catch {
      /* ignore */
    }
  }

  const canonicalUserId = await resolveCanonicalAuthUserId(env, {
    userId: sessionUserId,
    email: authUser?.email,
  });
  if (!canonicalUserId) {
    return { ok: false, error: 'canonical_user_unresolved', code: BOOTSTRAP_CONTEXT_MISSING };
  }

  let workspaceId =
    opts.requestedWorkspaceId != null ? String(opts.requestedWorkspaceId).trim() : '';
  if (workspaceId) {
    const actor = authUser?.id ? authUser : { id: canonicalUserId };
    if (!(await userCanAccessWorkspace(env, actor, workspaceId))) {
      return { ok: false, error: 'workspace_forbidden', code: BOOTSTRAP_FORBIDDEN };
    }
  } else if (opts.request) {
    const wsRes = await resolveEffectiveWorkspaceId(env, opts.request, authUser, opts.cache || {});
    if (wsRes.error || !wsRes.workspaceId) {
      return {
        ok: false,
        error: wsRes.error || BOOTSTRAP_CONTEXT_MISSING,
        code: BOOTSTRAP_CONTEXT_MISSING,
      };
    }
    workspaceId = wsRes.workspaceId;
  }

  if (!workspaceId) {
    return { ok: false, error: BOOTSTRAP_CONTEXT_MISSING, code: BOOTSTRAP_CONTEXT_MISSING };
  }

  let tenantId =
    (authUser?.tenant_id != null && String(authUser.tenant_id).trim()) ||
    (authUser?.active_tenant_id != null && String(authUser.active_tenant_id).trim()) ||
    '';

  if (!tenantId) {
    tenantId = (await fetchAuthUserTenantId(env, canonicalUserId).catch(() => null)) || '';
  }
  if (!tenantId) {
    tenantId = (await resolveTenantIdForWorkspace(env, workspaceId)) || '';
  }
  if (!tenantId) {
    return { ok: false, error: 'tenant_id_unresolved', code: BOOTSTRAP_CONTEXT_MISSING };
  }

  return { ok: true, authUser, canonicalUserId, workspaceId, tenantId };
}

/**
 * @param {unknown} env
 * @param {{ userId: string, workspaceId: string, tenantId?: string|null }} scope
 */
async function loadGovernanceRoleRows(env, scope) {
  if (!env?.DB) return [];
  const uid = String(scope.userId || '').trim();
  const ws = String(scope.workspaceId || '').trim();
  const tid = scope.tenantId != null ? String(scope.tenantId).trim() : '';
  if (!uid) return [];

  try {
    const { results } = await env.DB.prepare(
      `SELECT ugr.user_id, ugr.role_id, ugr.workspace_id, ugr.tenant_id, gr.role_name
       FROM user_governance_roles ugr
       LEFT JOIN governance_roles gr ON gr.role_id = ugr.role_id
       WHERE ugr.user_id = ?
         AND (trim(ugr.workspace_id) = '' OR ugr.workspace_id = ?)
         AND (trim(ugr.tenant_id) = '' OR ugr.tenant_id = ? OR ? = '')`,
    )
      .bind(uid, ws, tid, tid)
      .all();
    return results || [];
  } catch {
    return [];
  }
}

// ─── Policy/governance/byok/digest candidate for this identity ─────────────

/**
 * Computes all inputs needed to validate or materialize a bootstrap snapshot.
 * Does not touch agentsam_bootstrap.
 *
 * @param {unknown} env
 * @param {{ canonicalUserId: string, workspaceId: string, tenantId: string }} identity
 */
export async function computeBootstrapCandidate(env, identity) {
  const { canonicalUserId, workspaceId, tenantId } = identity;

  const [policy, governanceRows] = await Promise.all([
    loadAgentSamUserPolicy(env, canonicalUserId, workspaceId),
    loadGovernanceRoleRows(env, {
      userId: canonicalUserId,
      workspaceId,
      tenantId,
    }),
  ]);

  const capabilities = deriveCapabilitiesFromPolicy(policy);
  const governanceRoles = deriveGovernanceRolesFromRows(governanceRows);
  const byokRaw = await deriveByokReadiness(env, {
    userId: canonicalUserId,
    workspaceId,
    tenantId,
  });
  const byokReadiness = normalizeByokReadinessForHash(byokRaw);
  const digestManifest = normalizeDigestManifestForHash(
    await loadWorkspaceDigestManifest(env, workspaceId),
  );
  const policyHash = await computePolicyHash({
    userId: canonicalUserId,
    workspaceId,
    tenantId,
    policy,
    governanceRoles,
    byokReadiness,
    policyVersion: BOOTSTRAP_POLICY_VERSION,
  });

  return {
    policy,
    capabilities,
    governanceRoles,
    byokReadiness,
    digestManifest,
    policyHash,
  };
}

// ─── Cache read (D1 row → KV pointer → KV payload) ─────────────────────────

/**
 * @param {unknown} env
 * @param {{ identity: any, candidate: any, existing: any, rowId: string, forceRefresh: boolean }} p
 * @returns {Promise<object|null>} bootstrap result on hit, otherwise null
 */
export async function tryReadBootstrapCache(
  env,
  { identity, candidate, existing, rowId, forceRefresh },
) {
  const { canonicalUserId, workspaceId, tenantId } = identity;
  const { policy, policyHash, digestManifest } = candidate;
  const cacheValid =
    !forceRefresh &&
    bootstrapRowCacheValid(existing, {
      policyHash,
      compilerVersion: CURRENT_BOOTSTRAP_COMPILER_VERSION,
    });
  if (!cacheValid || !existing) return null;

  const capabilitiesCached = parseJsonObject(existing.capabilities_json, candidate.capabilities);
  const governanceCached = parseJsonArray(
    existing.governance_roles_json,
    candidate.governanceRoles,
  );
  const contextHash = existing.context_hash != null ? String(existing.context_hash).trim() : '';

  if (contextHash) {
    const pointer = await getMcpPermPointer(env, canonicalUserId, workspaceId);
    const pointerHash =
      pointer?.context_hash != null ? String(pointer.context_hash).trim() : contextHash;
    const kvPayload = await getBootstrapKvCache(env, pointerHash || contextHash, {
      policyHash,
      compilerVersion: CURRENT_BOOTSTRAP_COMPILER_VERSION,
    });
    if (kvPayload) {
      const fromKv = bootstrapResultFromKvCache(kvPayload, existing);
      fromKv.policy = policy;
      return fromKv;
    }
  }

  const d1Hit = {
    ok: true,
    id: rowId,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    user_id: canonicalUserId,
    row: existing,
    capabilities: capabilitiesCached,
    governance_roles: governanceCached,
    policy,
    policy_hash: policyHash,
    context_hash: contextHash,
    kv_cache_key: mcpPermSnapshotKey(contextHash),
    kv_pointer_key: mcpPermPointerKey(canonicalUserId, workspaceId),
    bootstrap_version: Number(existing.bootstrap_version) || 1,
    generated_from_version:
      Number(existing.generated_from_version) || CURRENT_BOOTSTRAP_COMPILER_VERSION,
    policy_version: Number(existing.policy_version) || BOOTSTRAP_POLICY_VERSION,
    refreshed: false,
    cache_hit: true,
    kv_cache_hit: false,
    parsed: {
      capabilities: capabilitiesCached,
      governance_roles: governanceCached,
    },
    context_digests: digestManifest,
  };

  if (contextHash) {
    await putBootstrapKvCache(env, contextHash, {
      ...d1Hit,
      byok: candidate.byokReadiness,
      context_digests: digestManifest,
      mcp: {
        tool_plane: 'user',
        require_allowlist_for_mcp: Boolean(capabilitiesCached.require_allowlist_for_mcp),
      },
    });
    d1Hit.kv_warmed = true;
  }

  return d1Hit;
}

// ─── Cache write (upsert + read-back + KV warm) ────────────────────────────

/**
 * @param {unknown} env
 * @param {{ identity: any, candidate: any, existing: any, rowId: string }} p
 */
export async function writeBootstrapSnapshot(env, { identity, candidate, existing, rowId }) {
  const { canonicalUserId, workspaceId, tenantId } = identity;
  const {
    capabilities,
    governanceRoles,
    byokReadiness,
    digestManifest,
    policyHash,
    policy,
  } = candidate;
  const contextHash = await computeContextHash({
    userId: canonicalUserId,
    workspaceId,
    tenantId,
    policyVersion: BOOTSTRAP_POLICY_VERSION,
    compilerVersion: CURRENT_BOOTSTRAP_COMPILER_VERSION,
    policyHash,
    capabilities,
    governanceRoles,
    byokReadiness,
    contextDigests: digestManifest,
  });
  const materialized = materializeBootstrapJson({
    capabilities,
    governanceRoles,
    policyVersion: BOOTSTRAP_POLICY_VERSION,
  });
  const nowUnix = Math.floor(Date.now() / 1000);
  const snapshotUnchanged =
    existing &&
    existing.context_hash === contextHash &&
    existing.policy_hash === policyHash &&
    Number(existing.generated_from_version) === CURRENT_BOOTSTRAP_COMPILER_VERSION;

  if (!snapshotUnchanged) {
    await env.DB.prepare(
      `INSERT INTO agentsam_bootstrap (
         id, tenant_id, workspace_id, user_id, policy_version,
         capabilities_json, governance_roles_json,
         policy_hash, context_hash, generated_from_version,
         policy_updated_at_unix, bootstrap_version,
         is_active, created_at_unix, updated_at_unix
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, user_id) DO UPDATE SET
         id = excluded.id,
         tenant_id = excluded.tenant_id,
         policy_version = excluded.policy_version,
         capabilities_json = excluded.capabilities_json,
         governance_roles_json = excluded.governance_roles_json,
         policy_hash = excluded.policy_hash,
         context_hash = excluded.context_hash,
         generated_from_version = excluded.generated_from_version,
         policy_updated_at_unix = excluded.policy_updated_at_unix,
         bootstrap_version = agentsam_bootstrap.bootstrap_version + 1,
         is_active = 1,
         updated_at_unix = excluded.updated_at_unix`,
    )
      .bind(
        rowId,
        tenantId,
        workspaceId,
        canonicalUserId,
        materialized.policy_version,
        materialized.capabilities_json,
        materialized.governance_roles_json,
        policyHash,
        contextHash,
        CURRENT_BOOTSTRAP_COMPILER_VERSION,
        nowUnix,
        existing ? Number(existing.bootstrap_version) || 1 : 1,
        1,
        nowUnix,
        nowUnix,
      )
      .run();
  }

  const row = await env.DB.prepare(`SELECT * FROM agentsam_bootstrap WHERE id = ? LIMIT 1`)
    .bind(rowId)
    .first()
    .catch(() => null);
  const result = {
    ok: true,
    id: rowId,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    user_id: canonicalUserId,
    row,
    capabilities,
    governance_roles: governanceRoles,
    byok: byokReadiness,
    policy,
    policy_hash: policyHash,
    context_hash: contextHash,
    kv_cache_key: mcpPermSnapshotKey(contextHash),
    kv_pointer_key: mcpPermPointerKey(canonicalUserId, workspaceId),
    bootstrap_version: Number(row?.bootstrap_version) || 1,
    generated_from_version: CURRENT_BOOTSTRAP_COMPILER_VERSION,
    policy_version: Number(row?.policy_version) || BOOTSTRAP_POLICY_VERSION,
    refreshed: !snapshotUnchanged,
    cache_hit: snapshotUnchanged,
    kv_cache_hit: false,
    parsed: {
      capabilities: parseJsonObject(row?.capabilities_json, capabilities),
      governance_roles: parseJsonArray(row?.governance_roles_json, governanceRoles),
    },
    context_digests: digestManifest,
  };

  result.kv_stored = await putBootstrapKvCache(env, contextHash, {
    ...result,
    byok: byokReadiness,
    context_digests: digestManifest,
    mcp: {
      tool_plane: 'user',
      require_allowlist_for_mcp: Boolean(capabilities.require_allowlist_for_mcp),
    },
  });
  return result;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────

/**
 * @param {unknown} env
 * @param {{
 *   userId: string,
 *   requestedWorkspaceId?: string|null,
 *   request?: Request|null,
 *   authUser?: Record<string, unknown>|null,
 *   cache?: Record<string, unknown>,
 *   refresh?: boolean,
 * }} opts
 */
export async function resolveAgentSamBootstrap(env, opts = {}) {
  if (!env?.DB) {
    return { ok: false, error: 'database_not_configured', code: BOOTSTRAP_CONTEXT_MISSING };
  }

  const identity = await resolveBootstrapIdentity(env, opts);
  if (!identity.ok) return identity;

  const rowId = bootstrapRowId(identity.workspaceId, identity.canonicalUserId);
  if (!rowId) {
    return { ok: false, error: 'bootstrap_id_invalid', code: BOOTSTRAP_CONTEXT_MISSING };
  }

  const existing = await env.DB.prepare(
    `SELECT * FROM agentsam_bootstrap
     WHERE id = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
  )
    .bind(rowId)
    .first()
    .catch(() => null);
  const candidate = await computeBootstrapCandidate(env, identity);
  const cached = await tryReadBootstrapCache(env, {
    identity,
    candidate,
    existing,
    rowId,
    forceRefresh: opts.refresh === true,
  });
  if (cached) return cached;

  return writeBootstrapSnapshot(env, {
    identity,
    candidate,
    existing,
    rowId,
  });
}
