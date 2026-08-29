/**
 * identity-oauth-provider.js — "Sign in with Inner Animal Media" for customer apps.
 *
 * User-to-app auth. NOT to be confused with AGENTSAM_BRIDGE_KEY, which is
 * machine-to-machine (Worker-to-Worker) auth -- see backend/auth/bridge-key-auth.js.
 * This module is a human clicking "Continue with IAM" on a customer's login page.
 *
 * Reuses the existing oauth_clients / oauth_authorizations / oauth_authorization_codes
 * tables as-is (they're already spec-correct: hashed secrets, PKCE, allowed_scopes per
 * client) -- see dependency-law/layers.json for why that schema didn't need forking.
 * Issued tokens land in oauth_identity_tokens (migrations/20260822_oauth_identity_tokens.sql),
 * kept separate from mcp_workspace_tokens because that table is MCP-tool-access-shaped,
 * not login-session-shaped.
 *
 * Scope namespace: standard OIDC (openid, profile, email) -- disjoint from mcp:tools,
 * iam:workspaces, iam:agent so a client registered here can never carry MCP tool-execution
 * entitlements.
 *
 * Crypto/PKCE helpers (mcpOAuthNow, mcpOAuthSha256Hex, mcpOAuthPkceS256, mcpOAuthRandomToken)
 * are reused from shared/oauth-crypto.js rather than duplicated here --
 * same primitives, different scope namespace and different token table.
 */

import {
  mcpOAuthNow,
  mcpOAuthSha256Hex,
  mcpOAuthPkceS256,
  mcpOAuthRandomToken,
} from '../../shared/oauth-crypto.js';

export const IDENTITY_ALLOWED_SCOPES = Object.freeze(['openid', 'profile', 'email']);
const AUTHZ_TTL_SECONDS = 10 * 60; // 10 minutes to complete consent
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function normalizeRedirectUris(input) {
  const list = Array.isArray(input) ? input : [input];
  const out = [];
  for (const raw of list) {
    const s = String(raw || '').trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
        continue; // https only, except local dev
      }
      out.push(u.href);
    } catch {
      /* skip invalid URL */
    }
  }
  return out;
}

/**
 * POST /api/oauth/identity/register
 * Self-service registration for a customer app. Returns { client_id, client_secret }
 * exactly once -- client_secret is never retrievable again (only its hash is stored,
 * matching oauth_clients' existing convention for the MCP DCR path).
 *
 * The caller mirrors this into their own Worker as IAM_CLIENT_ID (plaintext var, safe --
 * client IDs are public) and IAM_CLIENT_SECRET (wrangler secret, encrypted, never in git) --
 * same convention as GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.
 *
 * @param {Request} request
 * @param {any} env
 * @param {{ id?: string, tenant_id?: string|null }|null} authUser
 */
export async function registerIdentityClient(request, env, authUser) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  const displayName = String(body?.display_name || body?.name || '').trim();
  const ownerAccountId = String(authUser?.id || '').trim();
  const tenantId = String(authUser?.tenant_id || '').trim();
  const redirectUris = normalizeRedirectUris(body?.redirect_uris);

  if (!displayName) return jsonResponse({ ok: false, error: 'display_name_required' }, 400);
  if (!ownerAccountId || !tenantId) {
    return jsonResponse({ ok: false, error: 'authenticated_tenant_required' }, 403);
  }
  if (!redirectUris.length) {
    return jsonResponse({ ok: false, error: 'at_least_one_valid_https_redirect_uri_required' }, 400);
  }

  const requestedScopes = Array.isArray(body?.scopes) ? body.scopes : IDENTITY_ALLOWED_SCOPES;
  const allowedScopeSet = new Set(IDENTITY_ALLOWED_SCOPES);
  const selectedScopes = requestedScopes.filter((s) => allowedScopeSet.has(s));
  if (!selectedScopes.length) return jsonResponse({ ok: false, error: 'invalid_scope' }, 400);

  const createdAt = mcpOAuthNow();
  const clientId = `iam_identity_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const issuedClientSecret = mcpOAuthRandomToken('iamcs', 24);
  const clientSecretHash = await mcpOAuthSha256Hex(issuedClientSecret);

  await env.DB.prepare(
    `INSERT INTO oauth_clients (
       id, client_id, client_secret_hash, name, display_name, description,
       owner_account_id, tenant_id, redirect_uris, allowed_scopes, grant_types,
       token_endpoint_auth_method, client_type, is_active, is_first_party, requires_pkce,
       logo_url, homepage_url, privacy_policy_url, terms_url, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'client_secret_basic', 'confidential', 1, 0, 1,
               ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `oac_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
      clientId,
      clientSecretHash,
      displayName,
      displayName,
      'Identity OAuth client registered via /api/oauth/identity/register',
      ownerAccountId,
      tenantId,
      JSON.stringify(redirectUris),
      JSON.stringify(selectedScopes),
      JSON.stringify(['authorization_code', 'refresh_token']),
      body?.logo_url || null,
      body?.homepage_url || null,
      body?.privacy_policy_url || null,
      body?.terms_url || null,
      createdAt,
      createdAt,
    )
    .run();

  return jsonResponse({
    ok: true,
    client_id: clientId,
    client_secret: issuedClientSecret, // shown once -- caller must wrangler secret put this now
    scopes: selectedScopes,
    redirect_uris: redirectUris,
    authorize_endpoint: '/api/oauth/identity/authorize',
    token_endpoint: '/api/oauth/identity/token',
  });
}

/**
 * GET /api/oauth/identity/authorize?client_id=...&redirect_uri=...&scope=...&state=...
 *   &code_challenge=...&code_challenge_method=S256
 * Requires an authenticated IAM session (authUser) -- this is "sign in with IAM", the
 * user must already be signed in to IAM itself to consent to sharing identity with the
 * relying-party app. Creates a pending oauth_authorizations row and redirects to consent.
 *
 * @param {Request} request @param {any} env @param {{ id: string } | null} authUser
 */
export async function identityAuthorize(request, env, authUser) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id') || '';
  const redirectUri = url.searchParams.get('redirect_uri') || '';
  const scope = url.searchParams.get('scope') || IDENTITY_ALLOWED_SCOPES.join(' ');
  const state = url.searchParams.get('state') || '';
  const codeChallenge = url.searchParams.get('code_challenge') || '';
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'S256';

  if (!authUser?.id) {
    const loginUrl = new URL('/auth/login', url.origin);
    loginUrl.searchParams.set('next', url.pathname + url.search);
    return Response.redirect(loginUrl.href, 302);
  }
  if (!clientId || !redirectUri || !codeChallenge || codeChallengeMethod !== 'S256') {
    return jsonResponse({ ok: false, error: 'missing_required_params' }, 400);
  }

  const client = await env.DB.prepare(
    `SELECT client_id, redirect_uris, allowed_scopes, tenant_id
       FROM oauth_clients WHERE client_id = ? AND is_active = 1 LIMIT 1`,
  )
    .bind(clientId)
    .first();
  if (!client) return jsonResponse({ ok: false, error: 'invalid_client' }, 400);
  if (
    String(client.tenant_id || '').trim() &&
    String(client.tenant_id).trim() !== String(authUser.tenant_id || '').trim()
  ) {
    return jsonResponse({ ok: false, error: 'client_tenant_mismatch' }, 403);
  }

  let allowedRedirects = [];
  let allowedScopes = [];
  try {
    allowedRedirects = JSON.parse(client.redirect_uris || '[]');
    allowedScopes = JSON.parse(client.allowed_scopes || '[]');
  } catch {
    return jsonResponse({ ok: false, error: 'client_config_corrupt' }, 500);
  }
  if (!allowedRedirects.includes(redirectUri)) {
    return jsonResponse({ ok: false, error: 'redirect_uri_not_registered' }, 400);
  }
  const requestedScopes = scope.split(/\s+/).filter(Boolean);
  const grantedScopes = requestedScopes.filter((s) => allowedScopes.includes(s));
  if (!grantedScopes.length) return jsonResponse({ ok: false, error: 'invalid_scope' }, 400);
  if (!grantedScopes.includes('openid')) {
    return jsonResponse({ ok: false, error: 'openid_required' }, 400);
  }

  const now = mcpOAuthNow();
  const authorizationId = `oaa_${crypto.randomUUID().replace(/-/g, '')}`;

  await env.DB.prepare(
    `INSERT INTO oauth_authorizations (
       id, client_id, user_id, tenant_id, workspace_id, redirect_uri, scope, state,
       code_challenge, code_challenge_method, status, expires_at, metadata_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'pending', ?, ?, unixepoch(), unixepoch())`,
  )
    .bind(
      authorizationId,
      clientId,
      authUser.id,
      client.tenant_id,
      redirectUri,
      grantedScopes.join(' '),
      state,
      codeChallenge,
      codeChallengeMethod,
      now + AUTHZ_TTL_SECONDS,
      JSON.stringify({ path: 'identity' }),
    )
    .run();

  const consent = new URL('/api/oauth/identity/consent', url.origin);
  consent.searchParams.set('authorization_id', authorizationId);
  return Response.redirect(consent.href, 302);
}

/**
 * POST /api/oauth/identity/consent  { authorization_id, decision: 'approve' | 'deny' }
 * On approve: mints a one-time authorization code (stored hashed in
 * oauth_authorization_codes, reusing that table exactly as the MCP path does) and
 * redirects back to the relying party's redirect_uri.
 *
 * @param {Request} request @param {any} env @param {{ id: string } | null} authUser
 */
export async function identityConsentDecision(request, env, authUser) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }
  const authorizationId = String(body?.authorization_id || '').trim();
  const decision = String(body?.decision || '').trim();
  if (!authorizationId || !['approve', 'deny'].includes(decision)) {
    return jsonResponse({ ok: false, error: 'invalid_request' }, 400);
  }
  if (!authUser?.id) return jsonResponse({ ok: false, error: 'unauthenticated' }, 401);

  const authz = await env.DB.prepare(
    `SELECT id, client_id, user_id, redirect_uri, scope, state, code_challenge,
            code_challenge_method, status, expires_at, tenant_id
       FROM oauth_authorizations WHERE id = ? LIMIT 1`,
  )
    .bind(authorizationId)
    .first();
  if (!authz) return jsonResponse({ ok: false, error: 'authorization_not_found' }, 404);
  if (authz.user_id !== authUser.id) return jsonResponse({ ok: false, error: 'forbidden' }, 403);
  if (authz.status !== 'pending') return jsonResponse({ ok: false, error: 'already_decided' }, 409);
  if (Number(authz.expires_at) <= mcpOAuthNow()) {
    return jsonResponse({ ok: false, error: 'authorization_expired' }, 410);
  }

  const now = mcpOAuthNow();
  const redirect = new URL(authz.redirect_uri);

  if (decision === 'deny') {
    await env.DB.prepare(
      `UPDATE oauth_authorizations SET status = 'denied', denied_at = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(now, now, authorizationId)
      .run();
    redirect.searchParams.set('error', 'access_denied');
    if (authz.state) redirect.searchParams.set('state', authz.state);
    return jsonResponse({ ok: true, redirect: redirect.href });
  }

  const code = mcpOAuthRandomToken('iac', 32);
  const codeHash = await mcpOAuthSha256Hex(code);

  await env.DB.prepare(
    `INSERT INTO oauth_authorization_codes
       (code, user_id, tenant_id, client_id, redirect_uri, code_challenge,
        code_challenge_method, scope, expires_at, used, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  )
    .bind(
      codeHash,
      authz.user_id,
      authz.tenant_id,
      authz.client_id,
      authz.redirect_uri,
      authz.code_challenge,
      authz.code_challenge_method,
      authz.scope,
      now + 600, // 10 min code lifetime
      now,
    )
    .run();

  await env.DB.prepare(
    `UPDATE oauth_authorizations
        SET status = 'approved', approved_at = ?, authorization_code_hash = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(now, codeHash, now, authorizationId)
    .run();

  redirect.searchParams.set('code', code);
  if (authz.state) redirect.searchParams.set('state', authz.state);
  return jsonResponse({ ok: true, redirect: redirect.href });
}

async function loadIdentityClient(env, clientId) {
  return env.DB.prepare(
    `SELECT client_id, client_secret_hash, tenant_id, allowed_scopes, token_endpoint_auth_method
       FROM oauth_clients WHERE client_id = ? AND is_active = 1 LIMIT 1`,
  )
    .bind(clientId)
    .first();
}

async function assertClientAuth(request, body, client) {
  if (!client) return { ok: false, error: 'invalid_client' };
  const authHeader = request.headers.get('authorization') || '';
  let providedSecret = '';
  if (authHeader.startsWith('Basic ')) {
    try {
      const decoded = atob(authHeader.slice(6));
      const idx = decoded.indexOf(':');
      providedSecret = idx >= 0 ? decoded.slice(idx + 1) : '';
    } catch {
      /* fall through to body */
    }
  }
  if (!providedSecret) providedSecret = String(body?.client_secret || '');
  if (!providedSecret) return { ok: false, error: 'invalid_client_authentication' };
  const providedHash = await mcpOAuthSha256Hex(providedSecret);
  if (providedHash !== client.client_secret_hash) {
    return { ok: false, error: 'invalid_client_authentication' };
  }
  return { ok: true };
}

/**
 * POST /api/oauth/identity/token
 * grant_type=authorization_code (+PKCE code_verifier) or grant_type=refresh_token.
 * Issues into oauth_identity_tokens -- NOT mcp_workspace_tokens.
 *
 * @param {Request} request @param {any} env
 */
export async function identityToken(request, env) {
  let body;
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      const form = await request.formData();
      body = Object.fromEntries(form.entries());
    }
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_request_body' }, 400);
  }

  const grantType = String(body?.grant_type || '');
  const clientId = String(body?.client_id || '');
  const client = await loadIdentityClient(env, clientId);
  const authCheck = await assertClientAuth(request, body, client);
  if (!authCheck.ok) return jsonResponse({ ok: false, error: authCheck.error }, 401);

  const now = mcpOAuthNow();

  if (grantType === 'authorization_code') {
    const code = String(body?.code || '');
    const codeVerifier = String(body?.code_verifier || '');
    const redirectUri = String(body?.redirect_uri || '');
    if (!code || !codeVerifier || !redirectUri) {
      return jsonResponse({ ok: false, error: 'invalid_request' }, 400);
    }

    const codeHash = await mcpOAuthSha256Hex(code);
    const row = await env.DB.prepare(
      `SELECT code, user_id, tenant_id, client_id, redirect_uri, code_challenge,
              code_challenge_method, scope, expires_at, used
         FROM oauth_authorization_codes WHERE code = ? LIMIT 1`,
    )
      .bind(codeHash)
      .first();
    if (!row) return jsonResponse({ ok: false, error: 'invalid_grant' }, 400);
    if (Number(row.used) === 1) return jsonResponse({ ok: false, error: 'invalid_grant_consumed' }, 400);
    if (Number(row.expires_at || 0) <= now) {
      return jsonResponse({ ok: false, error: 'invalid_grant_expired' }, 400);
    }
    if (row.client_id !== clientId) return jsonResponse({ ok: false, error: 'client_mismatch' }, 400);
    if (String(row.redirect_uri || '') !== redirectUri) {
      return jsonResponse({ ok: false, error: 'redirect_uri_mismatch' }, 400);
    }
    const gotChallenge = await mcpOAuthPkceS256(codeVerifier);
    if (gotChallenge !== String(row.code_challenge || '')) {
      return jsonResponse({ ok: false, error: 'invalid_code_verifier' }, 400);
    }

    const consumed = await env.DB.prepare(
      `UPDATE oauth_authorization_codes
          SET used = 1
        WHERE code = ? AND used = 0 AND expires_at > ?`,
    ).bind(codeHash, now).run();
    if (!consumed?.meta?.changes) {
      return jsonResponse({ ok: false, error: 'invalid_grant_consumed' }, 400);
    }

    const accessToken = mcpOAuthRandomToken('iat', 32);
    const refreshToken = mcpOAuthRandomToken('irt', 32);
    const accessTokenHash = await mcpOAuthSha256Hex(accessToken);
    const refreshTokenHash = await mcpOAuthSha256Hex(refreshToken);
    const accessExpiresAt = now + ACCESS_TOKEN_TTL_SECONDS;
    const refreshExpiresAt = now + REFRESH_TOKEN_TTL_SECONDS;

    await env.DB.prepare(
      `INSERT INTO oauth_identity_tokens
         (id, client_id, user_id, tenant_id, scope, access_token_hash, access_expires_at,
          refresh_token_hash, refresh_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        `oit_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
        clientId,
        row.user_id,
        row.tenant_id,
        row.scope,
        accessTokenHash,
        accessExpiresAt,
        refreshTokenHash,
        refreshExpiresAt,
        now,
        now,
      )
      .run();

    return jsonResponse({
      ok: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: row.scope,
    });
  }

  if (grantType === 'refresh_token') {
    const refreshToken = String(body?.refresh_token || '');
    if (!refreshToken) return jsonResponse({ ok: false, error: 'invalid_request' }, 400);
    const refreshHash = await mcpOAuthSha256Hex(refreshToken);

    const row = await env.DB.prepare(
      `SELECT id, client_id, user_id, tenant_id, scope, refresh_expires_at, is_active
         FROM oauth_identity_tokens WHERE refresh_token_hash = ? LIMIT 1`,
    )
      .bind(refreshHash)
      .first();
    if (!row || !row.is_active) return jsonResponse({ ok: false, error: 'invalid_grant' }, 400);
    if (row.client_id !== clientId) return jsonResponse({ ok: false, error: 'client_mismatch' }, 400);
    if (Number(row.refresh_expires_at || 0) <= now) {
      return jsonResponse({ ok: false, error: 'invalid_grant_expired' }, 400);
    }

    const newAccessToken = mcpOAuthRandomToken('iat', 32);
    const newRefreshToken = mcpOAuthRandomToken('irt', 32);
    const newAccessTokenHash = await mcpOAuthSha256Hex(newAccessToken);
    const newRefreshTokenHash = await mcpOAuthSha256Hex(newRefreshToken);
    const newAccessExpiresAt = now + ACCESS_TOKEN_TTL_SECONDS;

    const updated = await env.DB.prepare(
      `UPDATE oauth_identity_tokens
          SET access_token_hash = ?, access_expires_at = ?,
              refresh_token_hash = ?, last_used_at = ?, updated_at = ?
        WHERE id = ? AND refresh_token_hash = ? AND is_active = 1
          AND refresh_expires_at > ?`,
    )
      .bind(
        newAccessTokenHash,
        newAccessExpiresAt,
        newRefreshTokenHash,
        now,
        now,
        row.id,
        refreshHash,
        now,
      )
      .run();
    if (!updated?.meta?.changes) {
      return jsonResponse({ ok: false, error: 'invalid_grant_replayed' }, 400);
    }

    return jsonResponse({
      ok: true,
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: row.scope,
    });
  }

  return jsonResponse({ ok: false, error: 'unsupported_grant_type' }, 400);
}

/**
 * Validate a bearer access token for a relying-party API call (e.g. their /api/company
 * or /dashboard session gate calling back to check the token is still good).
 * @param {any} env @param {string} accessToken
 */
export async function resolveIdentityAccessToken(env, accessToken) {
  const hash = await mcpOAuthSha256Hex(accessToken);
  const row = await env.DB.prepare(
    `SELECT id, client_id, user_id, tenant_id, scope, access_expires_at, is_active
       FROM oauth_identity_tokens WHERE access_token_hash = ? LIMIT 1`,
  )
    .bind(hash)
    .first();
  if (!row || !row.is_active) return null;
  if (Number(row.access_expires_at || 0) <= mcpOAuthNow()) return null;
  await env.DB.prepare(`UPDATE oauth_identity_tokens SET last_used_at = ? WHERE id = ?`)
    .bind(mcpOAuthNow(), row.id)
    .run()
    .catch(() => {});
  return { clientId: row.client_id, userId: row.user_id, tenantId: row.tenant_id, scope: row.scope };
}

/**
 * GET /api/oauth/identity/userinfo — OIDC userinfo for identity-path bearer tokens.
 * Validates via resolveIdentityAccessToken (oauth_identity_tokens, not mcp_workspace_tokens).
 *
 * @param {Request} request @param {any} env
 */
export async function identityUserinfo(request, env) {
  const auth = String(request.headers.get('Authorization') || '');
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return jsonResponse({ ok: false, error: 'missing_bearer_token' }, 401);

  const tokenCtx = await resolveIdentityAccessToken(env, m[1].trim());
  if (!tokenCtx) return jsonResponse({ ok: false, error: 'invalid_token' }, 401);

  const scopes = new Set(String(tokenCtx.scope || '').split(/\s+/).filter(Boolean));
  const row = await env.DB.prepare(
    `SELECT id, email, name, person_uuid FROM auth_users WHERE id = ? LIMIT 1`,
  )
    .bind(tokenCtx.userId)
    .first();
  if (!row) return jsonResponse({ ok: false, error: 'user_not_found' }, 404);

  /** @type {Record<string, unknown>} */
  const claims = { sub: row.id };
  if (scopes.has('profile')) {
    claims.name = row.name || null;
    if (row.person_uuid) claims.person_uuid = row.person_uuid;
  }
  if (scopes.has('email')) {
    claims.email = row.email || null;
    claims.email_verified = !!row.email;
  }
  return jsonResponse(claims);
}
