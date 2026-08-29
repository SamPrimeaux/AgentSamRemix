/**
 * POST /api/internal/cloudflare/resolve-token
 * Resolve an active Cloudflare OAuth token for the separate MCP Worker.
 * Auth: AGENTSAM_BRIDGE_KEY (Bearer or X-Internal-Secret).
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { resolveIntegrationUserId } from '../../backend/identity/oauth/integration-user-id.js';
import { resolveCloudflareOAuthToken } from '../../backend/identity/oauth/user-token.js';

const STATUS_BY_CODE = {
  INVALID_REQUEST: 400,
  INVALID_JSON: 400,
  IDENTITY_NOT_FOUND: 404,
  TOKEN_NOT_FOUND: 404,
  TOKEN_INACTIVE: 409,
  TOKEN_REVOKED: 409,
  TENANT_MISMATCH: 403,
  REFRESH_TOKEN_MISSING: 409,
  REFRESH_NOT_CONFIGURED: 503,
  PROVIDER_REFRESH_FAILED: 502,
  TOKEN_ENCRYPTION_UNAVAILABLE: 503,
  TOKEN_ENCRYPTION_FAILED: 500,
  TOKEN_STATE_CHANGED: 409,
  TOKEN_UNAVAILABLE: 409,
};

function errorResponse(code, status = STATUS_BY_CODE[code] || 500) {
  return jsonResponse({ ok: false, error_code: code }, status);
}

export async function handleInternalCloudflareResolveToken(request, env) {
  if (!verifyBridgeKey(request, env)) {
    return errorResponse('INTERNAL_AUTH_REQUIRED', 401);
  }
  if (!env?.DB) return errorResponse('DATABASE_UNAVAILABLE', 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('INVALID_JSON');
  }

  const requestedUserId = String(body?.user_id || '').trim();
  const requestedTenantId = String(body?.tenant_id || '').trim();
  const accountIdentifier = String(body?.account_identifier || body?.account_id || '').trim();
  if (!requestedUserId) return errorResponse('INVALID_REQUEST');

  try {
    const canonicalUserId = await resolveIntegrationUserId(env, { id: requestedUserId });
    if (!canonicalUserId) return errorResponse('IDENTITY_NOT_FOUND');

    const authUser = await env.DB.prepare(
      `SELECT id, tenant_id FROM auth_users WHERE id = ? LIMIT 1`,
    )
      .bind(canonicalUserId)
      .first();
    if (!authUser) return errorResponse('IDENTITY_NOT_FOUND');

    const authoritativeTenantId = String(authUser.tenant_id || '').trim();
    if (
      requestedTenantId &&
      authoritativeTenantId &&
      requestedTenantId !== authoritativeTenantId
    ) {
      return errorResponse('TENANT_MISMATCH');
    }
    const tenantId = authoritativeTenantId || requestedTenantId;
    if (!tenantId) return errorResponse('INVALID_REQUEST');

    const resolved = await resolveCloudflareOAuthToken(env, canonicalUserId, {
      tenantId,
      accountIdentifier,
      nearExpirySeconds: 300,
    });
    if (!resolved.ok) return errorResponse(resolved.code);

    return jsonResponse({
      ok: true,
      account_id: resolved.accountId,
      scopes: resolved.scopes,
      expiry: resolved.expiresAt,
      refreshed: resolved.refreshed,
      access_token: resolved.accessToken,
    });
  } catch {
    // Provider and persistence errors are intentionally not reflected to the caller.
    return errorResponse('INTERNAL_ERROR');
  }
}
