/**
 * Stripe Connect OAuth — GET /api/oauth/stripe/start | /callback
 *
 * Secrets (Wrangler — never hardcode):
 *   STRIPE_CONNECT_CLIENT_ID  — Connect application client id (ca_...)
 *   STRIPE_RESTRICTED_KEY     — platform restricted key for token exchange (preferred)
 *   STRIPE_SECRET_KEY         — fallback platform secret for token exchange
 */
import { getAuthUser, jsonResponse } from '../../core/auth.js';
import { resolveIntegrationUserId } from '../../../backend/identity/oauth/integration-user-id.js';
import { upsertOauthToken } from '../../../backend/identity/oauth/token-store.js';
import { appendOAuthReturnParams } from '../../core/oauth-popup-complete.js';

async function resolveCanonicalWorkspace(env, userId) {
  if (!env?.DB || !userId) return null;
  try {
    const row = await env.DB.prepare(`
      SELECT COALESCE(
        (SELECT w.id FROM workspaces w
          INNER JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = au.id
         WHERE w.id = au.default_workspace_id AND COALESCE(wm.is_active, 1) = 1
         LIMIT 1),
        (SELECT w.id FROM workspaces w
          INNER JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = au.id
         WHERE w.id = au.active_workspace_id AND COALESCE(wm.is_active, 1) = 1
         LIMIT 1),
        (SELECT wm.workspace_id FROM workspace_members wm
          INNER JOIN workspaces w ON w.id = wm.workspace_id
         WHERE wm.user_id = au.id AND COALESCE(wm.is_active, 1) = 1
         ORDER BY COALESCE(wm.joined_at, wm.created_at) ASC
         LIMIT 1)
      ) AS workspace_id
      FROM auth_users au
      WHERE au.id = ?
    `)
      .bind(userId)
      .first();
    return row?.workspace_id ?? null;
  } catch {
    return null;
  }
}

const STRIPE_OAUTH_REDIRECT_URI = 'https://inneranimalmedia.com/api/oauth/stripe/callback';
const STRIPE_OAUTH_SCOPE = 'read_write';
const OAUTH_STATE_TTL_SECONDS = 600;
const DEFAULT_RETURN_TO = '/dashboard/settings/integrations';

function safeReturnTo(url) {
  const raw = String(url || '').trim();
  if (!raw) return DEFAULT_RETURN_TO;
  if (raw.startsWith('/dashboard/') && !raw.startsWith('//') && !raw.includes(':')) return raw;
  return DEFAULT_RETURN_TO;
}

function stripeConnectClientId(env) {
  const id =
    typeof env.STRIPE_CONNECT_CLIENT_ID === 'string' ? env.STRIPE_CONNECT_CLIENT_ID.trim() : '';
  return id || null;
}

function stripePlatformSecret(env) {
  const restricted =
    typeof env.STRIPE_RESTRICTED_KEY === 'string' ? env.STRIPE_RESTRICTED_KEY.trim() : '';
  if (restricted) return restricted;
  const secret = typeof env.STRIPE_SECRET_KEY === 'string' ? env.STRIPE_SECRET_KEY.trim() : '';
  return secret || null;
}

function oauthStateId() {
  return `state_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * @param {any} env
 * @param {string} stateId
 * @param {{ user_id: string, tenant_id: string, return_to: string, workspace_id?: string|null }} payload
 */
async function putStripeOAuthState(env, stateId, payload) {
  if (!env?.DB) throw new Error('DB not configured');
  const expiresAt = nowSeconds() + OAUTH_STATE_TTL_SECONDS;
  const scopeJson = JSON.stringify({
    scope: STRIPE_OAUTH_SCOPE,
    return_to: payload.return_to,
    tenant_id: payload.tenant_id,
    workspace_id: payload.workspace_id || null,
  });
  await env.DB.prepare(
    `INSERT INTO oauth_states (id, user_id, provider_id, redirect_uri, scope, expires_at, created_at)
     VALUES (?, ?, 'stripe', ?, ?, ?, ?)`,
  )
    .bind(
      stateId,
      payload.user_id,
      payload.return_to,
      scopeJson,
      expiresAt,
      nowSeconds(),
    )
    .run();
}

/**
 * @param {any} env
 * @param {string} stateId
 */
async function getStripeOAuthState(env, stateId) {
  if (!env?.DB) return null;
  const row = await env.DB.prepare(
    `SELECT id, user_id, provider_id, redirect_uri, scope, expires_at
     FROM oauth_states
     WHERE id = ? AND provider_id = 'stripe'
     LIMIT 1`,
  )
    .bind(stateId)
    .first();
  if (!row) return null;
  const expiresAt = Number(row.expires_at || 0);
  if (expiresAt && expiresAt < nowSeconds()) return null;
  let meta = {};
  try {
    meta = row.scope ? JSON.parse(String(row.scope)) : {};
  } catch {
    meta = {};
  }
  return {
    user_id: String(row.user_id || ''),
    return_to: String(meta.return_to || row.redirect_uri || DEFAULT_RETURN_TO),
    tenant_id: String(meta.tenant_id || ''),
    workspace_id: meta.workspace_id ? String(meta.workspace_id) : null,
  };
}

async function deleteStripeOAuthState(env, stateId) {
  if (!env?.DB || !stateId) return;
  try {
    await env.DB.prepare(`DELETE FROM oauth_states WHERE id = ? AND provider_id = 'stripe'`)
      .bind(stateId)
      .run();
  } catch (e) {
    console.warn('[stripe_oauth] state delete', e?.message || e);
  }
}

function stripeAuthUrl(env, state) {
  const clientId = stripeConnectClientId(env);
  if (!clientId) return null;
  const u = new URL('https://connect.stripe.com/oauth/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('scope', STRIPE_OAUTH_SCOPE);
  u.searchParams.set('redirect_uri', STRIPE_OAUTH_REDIRECT_URI);
  u.searchParams.set('state', state);
  return u.toString();
}

async function exchangeStripeConnectCode(env, code) {
  const clientSecret = stripePlatformSecret(env);
  if (!clientSecret) {
    throw new Error('Stripe platform secret not configured (STRIPE_RESTRICTED_KEY or STRIPE_SECRET_KEY)');
  }
  const res = await fetch('https://connect.stripe.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error?.message || data.error || 'Stripe token exchange failed');
  }
  return data;
}

async function fetchStripeAccountDisplay(accessToken, stripeUserId) {
  try {
    const res = await fetch('https://api.stripe.com/v1/account', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const acct = await res.json().catch(() => ({}));
      return (
        acct?.display_name ||
        acct?.business_profile?.name ||
        acct?.email ||
        stripeUserId ||
        'Stripe'
      );
    }
  } catch {
    /* non-fatal */
  }
  return stripeUserId || 'Stripe';
}

async function upsertStripeRegistry(env, tenantId, displayName, stripeUserId) {
  if (!env?.DB || !tenantId) return;
  const configJson = JSON.stringify({
    mcp_server_url: 'https://mcp.stripe.com',
    auth_method: 'connect_oauth',
    stripe_user_id: stripeUserId,
  });
  try {
    await env.DB.prepare(
      `INSERT INTO integration_registry (
         id, tenant_id, provider_key, display_name, category, auth_type, status,
         config_json, account_display, sort_order, updated_at
       ) VALUES (?, ?, 'stripe', 'Stripe', 'payment', 'oauth2', 'connected', ?, ?, 40, datetime('now'))
       ON CONFLICT(tenant_id, provider_key) DO UPDATE SET
         status = 'connected',
         auth_type = 'oauth2',
         config_json = excluded.config_json,
         account_display = excluded.account_display,
         updated_at = datetime('now')`,
    )
      .bind(
        `int_stripe_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        tenantId,
        configJson,
        displayName,
      )
      .run();
  } catch (e) {
    console.warn('[stripe_oauth] registry upsert', e?.message || e);
  }
}

/**
 * GET /api/oauth/stripe/start
 */
export async function handleStripeOAuthStart(request, env) {
  const url = new URL(request.url);
  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  const clientId = stripeConnectClientId(env);
  if (!clientId) {
    return jsonResponse(
      {
        error: 'stripe_oauth_not_configured',
        setup: 'Set Worker secret STRIPE_CONNECT_CLIENT_ID (ca_...) from Stripe Connect settings, then retry.',
      },
      503,
    );
  }

  const userId =
    (await resolveIntegrationUserId(env, authUser)) ||
    String(authUser.id || authUser.user_id || '').trim();
  if (!userId) return jsonResponse({ error: 'User id required' }, 400);

  const tenantId = String(authUser.tenant_id || env.TENANT_ID || '').trim();
  const workspaceId = await resolveCanonicalWorkspace(env, userId);
  const returnTo = safeReturnTo(url.searchParams.get('return_to'));
  const state = oauthStateId();

  await putStripeOAuthState(env, state, {
    user_id: userId,
    tenant_id: tenantId,
    return_to: returnTo,
    workspace_id: workspaceId,
  });

  const redirectUrl = stripeAuthUrl(env, state);
  if (!redirectUrl) {
    return jsonResponse({ error: 'stripe_oauth_not_configured' }, 503);
  }
  return Response.redirect(redirectUrl, 302);
}

/**
 * GET /api/oauth/stripe/callback
 */
export async function handleStripeOAuthCallback(request, env) {
  const url = new URL(request.url);
  const origin = url.origin;
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const oauthError = url.searchParams.get('error') || url.searchParams.get('error_description') || '';

  if (oauthError) {
    return Response.redirect(
      `${origin}${DEFAULT_RETURN_TO}?error=${encodeURIComponent(oauthError)}`,
      302,
    );
  }
  if (!state || !code) {
    return Response.redirect(
      `${origin}${DEFAULT_RETURN_TO}?error=missing_params`,
      302,
    );
  }

  const stored = await getStripeOAuthState(env, state);
  if (!stored?.user_id) {
    return Response.redirect(`${origin}${DEFAULT_RETURN_TO}?error=oauth_state`, 302);
  }

  const returnTo = safeReturnTo(stored.return_to);
  const absReturn = returnTo.startsWith('http') ? returnTo : `${origin}${returnTo}`;

  try {
    const tok = await exchangeStripeConnectCode(env, code);
    const stripeUserId = String(tok.stripe_user_id || '').trim() || 'stripe';
    const displayName = await fetchStripeAccountDisplay(tok.access_token, stripeUserId);

    await upsertOauthToken(
      env,
      {
        user_id: stored.user_id,
        tenant_id: stored.tenant_id,
        provider: 'stripe',
        access_token: tok.access_token,
        refresh_token: tok.refresh_token || null,
        scope: tok.scope || STRIPE_OAUTH_SCOPE,
        expires_at: null,
        account_identifier: stripeUserId,
        account_display: displayName,
        workspace_id: stored.workspace_id,
        metadata_json: JSON.stringify({
          auth_method: 'connect_oauth',
          stripe_user_id: stripeUserId,
          mcp_server_url: 'https://mcp.stripe.com',
        }),
      },
      { skipRegistry: false },
    );

    await upsertStripeRegistry(env, stored.tenant_id, displayName, stripeUserId);
  } catch (e) {
    await deleteStripeOAuthState(env, state);
    const msg = e?.message || 'oauth_failed';
    return Response.redirect(appendOAuthReturnParams(absReturn, { error: msg }), 302);
  }

  await deleteStripeOAuthState(env, state);
  return Response.redirect(
    appendOAuthReturnParams(absReturn, { connected: 'stripe', success: 'true' }),
    302,
  );
}
