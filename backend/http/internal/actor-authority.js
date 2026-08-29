/**
 * POST /api/internal/actor-authority/resolve — IAM_MAIN service binding surface.
 * Returns compiled actor authority snapshot metadata only (no secrets).
 */
import { httpJsonResponse as jsonResponse } from '../responses.js';
import { verifyBridgeKey } from '../../auth/bridge-key-auth.js';
import { resolveAgentSamBootstrap } from '../../services/bootstrap/resolve.js';
import { getBootstrapKvCache, getMcpPermPointer } from '../../services/bootstrap/kv-cache.js';
import { CURRENT_BOOTSTRAP_COMPILER_VERSION } from '../../services/bootstrap/hash.js';

function safeActorPayload(result, kvPayload = null) {
  const byok =
    kvPayload?.byok && typeof kvPayload.byok === 'object'
      ? kvPayload.byok
      : result?.byok && typeof result.byok === 'object'
        ? result.byok
        : null;
  return {
    ok: result?.ok === true,
    error: result?.error ?? null,
    user_id: result?.user_id ?? null,
    workspace_id: result?.workspace_id ?? null,
    tenant_id: result?.tenant_id ?? null,
    context_hash: result?.context_hash ?? null,
    policy_hash: result?.policy_hash ?? null,
    generated_from_version:
      result?.generated_from_version ?? CURRENT_BOOTSTRAP_COMPILER_VERSION,
    capabilities: result?.capabilities ?? kvPayload?.capabilities ?? {},
    governance_roles: result?.governance_roles ?? kvPayload?.governance_roles ?? [],
    byok,
    kv_pointer_key: result?.kv_pointer_key ?? null,
    kv_cache_key: result?.kv_cache_key ?? null,
    cache_hit: Boolean(result?.cache_hit || result?.kv_cache_hit),
    refreshed: Boolean(result?.refreshed),
  };
}

export async function handleInternalActorAuthorityHttp(request, env) {
  if (!verifyBridgeKey(request, env)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await request.json().catch(() => ({}));
  const userId = body?.user_id != null ? String(body.user_id).trim() : '';
  const workspaceId = body?.workspace_id != null ? String(body.workspace_id).trim() : '';
  if (!userId || !workspaceId) {
    return jsonResponse({ ok: false, error: 'user_id_and_workspace_id_required' }, 400);
  }

  const result = await resolveAgentSamBootstrap(env, {
    userId,
    requestedWorkspaceId: workspaceId,
    refresh: body?.refresh === true,
  });

  if (!result.ok) {
    return jsonResponse(safeActorPayload(result), result.code === 'BOOTSTRAP_FORBIDDEN' ? 403 : 404);
  }

  let kvPayload = null;
  const contextHash = result.context_hash != null ? String(result.context_hash).trim() : '';
  if (contextHash) {
    kvPayload = await getBootstrapKvCache(env, contextHash, {
      policyHash: result.policy_hash,
      compilerVersion: result.generated_from_version,
    });
  }

  const pointer = await getMcpPermPointer(env, userId, workspaceId);
  if (pointer?.context_hash && contextHash && pointer.context_hash !== contextHash) {
    return jsonResponse(
      {
        ok: false,
        error: 'pointer_snapshot_mismatch',
        pointer_context_hash: pointer.context_hash,
        snapshot_context_hash: contextHash,
      },
      409,
    );
  }

  return jsonResponse(safeActorPayload(result, kvPayload));
}
