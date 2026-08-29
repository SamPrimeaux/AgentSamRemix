/**
 * POST /api/internal/google/refresh-token — MCP / automation Google OAuth refresh.
 * Auth: AGENTSAM_BRIDGE_KEY (Bearer or X-Internal-Secret).
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { getIntegrationOAuthRow, refreshGoogleToken } from '../../backend/identity/oauth/user-token.js';

export function isInternalSecretAuthorized(request, env) {
  return verifyBridgeKey(request, env);
}

export async function handleGoogleTokenRefresh(env, request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid json body' }, 400);
  }

  const user_id = body.user_id != null ? String(body.user_id).trim() : '';
  const tenant_id = body.tenant_id != null ? String(body.tenant_id).trim() : '';
  const provider = body.provider != null ? String(body.provider).trim() : 'google_drive';

  if (!user_id || !tenant_id) {
    return jsonResponse({ ok: false, error: 'missing user_id or tenant_id' }, 400);
  }

  const accountParam =
    body.account_identifier != null
      ? String(body.account_identifier).trim()
      : body.account != null
        ? String(body.account).trim()
        : '';

  const row = await getIntegrationOAuthRow(env, user_id, provider, accountParam);
  if (!row?.refresh_token) {
    const label =
      provider === 'google_gmail' || provider === 'gmail'
        ? 'Gmail'
        : provider === 'google_calendar'
          ? 'Google Calendar'
          : 'Google Drive';
    return jsonResponse(
      { ok: false, error: `no refresh token found — reconnect ${label} in IAM` },
      404,
    );
  }

  if (row.tenant_id != null && String(row.tenant_id).trim() && String(row.tenant_id).trim() !== tenant_id) {
    return jsonResponse({ ok: false, error: 'tenant_id does not match stored OAuth row' }, 403);
  }

  const access_token = await refreshGoogleToken(env, user_id, provider, row.refresh_token, row);
  if (!access_token) {
    return jsonResponse({ ok: false, error: 'google refresh failed' }, 502);
  }

  return jsonResponse({ ok: true, access_token });
}
