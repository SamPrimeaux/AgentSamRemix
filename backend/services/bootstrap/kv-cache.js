/**
 * MCP_TOTENS (env.KV) — pointer + immutable permission snapshot cache.
 */

import {
  mcpPermPointerKey,
  mcpPermSnapshotKey,
  mcpPermSnapshotLookupKeys,
} from './kv-keys.js';

/** Backstop TTL; stale keys orphan naturally when context_hash changes. */
export const BOOTSTRAP_KV_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MCP_PERM_POINTER_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * @param {unknown} env
 */
function kvBinding(env) {
  const kv = env?.KV;
  if (kv && typeof kv.get === 'function' && typeof kv.put === 'function') return kv;
  return null;
}

/**
 * @param {unknown} raw
 */
function parseKvJson(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

/**
 * @param {unknown} roles
 */
export function slimGovernanceRolesForKv(roles = []) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(roles) ? roles : []) {
    const roleId = r?.role_id != null ? String(r.role_id).trim() : '';
    if (!roleId || seen.has(roleId)) continue;
    seen.add(roleId);
    const roleName = r?.role_name != null ? String(r.role_name).trim() : '';
    if (roleName && roleName !== roleId) {
      out.push({ role_id: roleId, role_name: roleName });
    } else {
      out.push({ role_id: roleId });
    }
  }
  return out;
}

/**
 * @param {unknown} byok
 */
export function slimByokForKv(byok) {
  if (!byok || typeof byok !== 'object') {
    return { providers: {}, r2: { configured: false, validated: false } };
  }
  const providers = {};
  for (const [slug, row] of Object.entries(byok.providers || {})) {
    if (!row || typeof row !== 'object') continue;
    const configured = row.configured === true;
    const validated = row.validated === true;
    if (configured || validated) {
      providers[slug] = { configured, validated };
    }
  }
  const r2Row = byok.r2 && typeof byok.r2 === 'object' ? byok.r2 : {};
  return {
    providers,
    r2: {
      configured: r2Row.configured === true,
      validated: r2Row.validated === true,
    },
  };
}

/**
 * SSOT perm-snapshot body — docs/platform/kv-lane-ssot-2026-08.md (no D1 row echo / version noise).
 * @param {Record<string, unknown>} payload
 */
export function bootstrapKvPayloadForWrite(payload) {
  return {
    context_hash: payload.context_hash ?? null,
    policy_hash: payload.policy_hash ?? null,
    generated_from_version: payload.generated_from_version ?? null,
    user_id: payload.user_id ?? null,
    workspace_id: payload.workspace_id ?? null,
    tenant_id: payload.tenant_id ?? null,
    capabilities: payload.capabilities ?? {},
    governance_roles: slimGovernanceRolesForKv(payload.governance_roles),
    byok: slimByokForKv(payload.byok),
    mcp: payload.mcp ?? {
      tool_plane: 'user',
      require_allowlist_for_mcp: Boolean(
        payload.capabilities?.require_allowlist_for_mcp,
      ),
    },
  };
}

/**
 * @param {Record<string, unknown>} payload
 */
export function mcpPermPointerPayloadForWrite(payload) {
  return {
    context_hash: payload.context_hash ?? null,
    policy_hash: payload.policy_hash ?? null,
    generated_from_version: payload.generated_from_version ?? null,
    updated_at_unix: Math.floor(Date.now() / 1000),
  };
}

/**
 * @param {unknown} env
 * @param {string} userId
 * @param {string} workspaceId
 */
export async function getMcpPermPointer(env, userId, workspaceId) {
  const kv = kvBinding(env);
  const key = mcpPermPointerKey(userId, workspaceId);
  if (!kv || !key) return null;
  try {
    const parsed = parseKvJson(await kv.get(key));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} env
 * @param {string} contextHash
 * @param {{ policyHash?: string|null, compilerVersion?: number|null }} [expect]
 */
export async function getBootstrapKvCache(env, contextHash, expect = {}) {
  const kv = kvBinding(env);
  if (!kv || !contextHash) return null;

  for (const key of mcpPermSnapshotLookupKeys(contextHash)) {
    try {
      const parsed = parseKvJson(await kv.get(key));
      if (!parsed || typeof parsed !== 'object') continue;

      const expectedPolicy =
        expect.policyHash != null ? String(expect.policyHash).trim() : '';
      if (expectedPolicy) {
        const storedPolicy = parsed.policy_hash != null ? String(parsed.policy_hash).trim() : '';
        if (storedPolicy !== expectedPolicy) continue;
      }

      if (expect.compilerVersion != null) {
        const storedCompiler = Number(parsed.generated_from_version);
        if (storedCompiler !== Number(expect.compilerVersion)) continue;
      }

      return parsed;
    } catch (e) {
      console.debug('[bootstrap-kv] get failed', key, e?.message ?? e);
    }
  }
  return null;
}

/**
 * @param {unknown} env
 * @param {string} contextHash
 * @param {Record<string, unknown>} payload
 */
export async function putBootstrapKvCache(env, contextHash, payload) {
  const kv = kvBinding(env);
  const snapshotKey = mcpPermSnapshotKey(contextHash);
  if (!kv || !snapshotKey) return false;

  const userId = payload.user_id != null ? String(payload.user_id).trim() : '';
  const workspaceId = payload.workspace_id != null ? String(payload.workspace_id).trim() : '';

  try {
    const body = bootstrapKvPayloadForWrite({ ...payload, context_hash: contextHash });
    await kv.put(snapshotKey, JSON.stringify(body), {
      expirationTtl: BOOTSTRAP_KV_TTL_SECONDS,
      metadata: {
        context_hash: contextHash,
        policy_hash: body.policy_hash,
        workspace_id: body.workspace_id,
        user_id: body.user_id,
      },
    });

    if (userId && workspaceId) {
      const pointerKey = mcpPermPointerKey(userId, workspaceId);
      await kv.put(
        pointerKey,
        JSON.stringify(mcpPermPointerPayloadForWrite(body)),
        {
          expirationTtl: MCP_PERM_POINTER_TTL_SECONDS,
          metadata: {
            context_hash: contextHash,
            policy_hash: body.policy_hash,
            workspace_id: workspaceId,
            user_id: userId,
          },
        },
      );
    }
    return true;
  } catch (e) {
    console.debug('[bootstrap-kv] put failed', snapshotKey, e?.message ?? e);
    return false;
  }
}

/**
 * @param {Record<string, unknown>} kvPayload
 * @param {Record<string, unknown>|null|undefined} row
 */
export function bootstrapResultFromKvCache(kvPayload, row = null) {
  const contextHash = String(kvPayload.context_hash || '').trim();
  return {
    ok: true,
    id: row?.id ?? kvPayload.id ?? null,
    tenant_id: kvPayload.tenant_id,
    workspace_id: kvPayload.workspace_id,
    user_id: kvPayload.user_id,
    row: row ?? null,
    capabilities: kvPayload.capabilities ?? {},
    governance_roles: kvPayload.governance_roles ?? [],
    policy: null,
    policy_hash: kvPayload.policy_hash,
    context_hash: contextHash,
    kv_cache_key: mcpPermSnapshotKey(contextHash),
    kv_pointer_key: mcpPermPointerKey(
      String(kvPayload.user_id || ''),
      String(kvPayload.workspace_id || ''),
    ),
    bootstrap_version: Number(row?.bootstrap_version ?? kvPayload.bootstrap_version) || 1,
    generated_from_version:
      Number(kvPayload.generated_from_version ?? row?.generated_from_version) || 2,
    policy_version: Number(row?.policy_version ?? kvPayload.policy_version) || 1,
    refreshed: false,
    cache_hit: true,
    kv_cache_hit: true,
    parsed: {
      capabilities: kvPayload.capabilities ?? {},
      governance_roles: kvPayload.governance_roles ?? [],
    },
  };
}
