/**
 * POST /api/internal/delegation-grant/compile — compile plane delegation grant (IAM_MAIN / internal).
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { compileImagesDelegationGrant, imagesCapabilityForOp } from '../core/images-delegation-gate.js';

export async function handleInternalDelegationGrantCompile(request, env) {
  if (!verifyBridgeKey(request, env)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await request.json().catch(() => ({}));
  const userId = body?.user_id != null ? String(body.user_id).trim() : '';
  const workspaceId = body?.workspace_id != null ? String(body.workspace_id).trim() : '';
  const planeId = body?.plane_id != null ? String(body.plane_id).trim() : 'images-worker';

  if (!userId || !workspaceId) {
    return jsonResponse({ ok: false, error: 'user_id_and_workspace_id_required' }, 400);
  }

  if (planeId !== 'images-worker') {
    return jsonResponse({ ok: false, error: 'unsupported_plane', plane_id: planeId }, 400);
  }

  const capability =
    body?.capability != null
      ? String(body.capability).trim()
      : imagesCapabilityForOp(body?.operation);

  const requested = Array.isArray(body?.capabilities)
    ? body.capabilities.map((c) => String(c).trim()).filter(Boolean)
    : [capability];

  const out = await compileImagesDelegationGrant(env, {
    userId,
    workspaceId,
    tenantId: body?.tenant_id,
    conversationId: body?.conversation_id,
    capability,
    actorContextHash: body?.actor_context_hash,
    requestedCapabilities: requested,
  });

  if (!out.ok) {
    return jsonResponse(out, 400);
  }

  return jsonResponse({
    ok: true,
    plane_id: planeId,
    grant_hash: out.grant?.grant_hash,
    grant_key: out.grant_key,
    capabilities: out.grant?.capabilities ?? [],
    expires_at_unix: out.grant?.expires_at_unix,
  });
}
