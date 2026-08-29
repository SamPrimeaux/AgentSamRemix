/**
 * POST /api/internal/cwd-resolution-probe
 * Triggers resolveIdentityScopedGcpCwd with env.DB so cwd_resolution lands in
 * agentsam_error_log from the main Worker surface (not a forged INSERT).
 * Auth: AGENTSAM_BRIDGE_KEY or X-ExecOS-Key.
 *
 * Body (optional):
 *   { "mode": "identity_required" | "owner_unresolved", "workspace_id", "tenant_id", "user_id" }
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { resolveIdentityScopedGcpCwd } from '../core/identity-scoped-gcp-cwd.js';

function authorized(request, env) {
  return verifyBridgeKey(request, env);
}

function probeField(body, key) {
  const v = body?.[key];
  return v != null ? String(v).trim() : '';
}

/**
 * @param {Request} request
 * @param {any} env
 */
export async function handleCwdResolutionProbe(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!authorized(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const mode = String(body.mode || 'identity_required').trim();
  /** @type {Record<string, unknown>} */
  const ctx = { env, sessionId: 'cwd_resolution_probe' };

  if (mode === 'owner_unresolved') {
    ctx.userId = probeField(body, 'user_id') || 'unknown';
    ctx.tenantId = probeField(body, 'tenant_id') || 'unknown';
    ctx.workspaceId = probeField(body, 'workspace_id') || 'unknown';
    ctx.settings = {};
  } else {
    // identity_required — omit user/tenant on purpose
    ctx.workspaceId = probeField(body, 'workspace_id') || 'unknown';
  }

  const result = await resolveIdentityScopedGcpCwd(ctx);
  return jsonResponse({
    ok: result.ok,
    result,
    surface: 'identity_scoped_gcp_cwd',
    logged_when_failed: !result.ok,
  });
}
