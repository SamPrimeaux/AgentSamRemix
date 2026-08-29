/**
 * Unified Gmail OAuth — single connect/callback for Mail, Integrations, and Chat.
 */

import { getAuthUser } from '../../core/auth.js';
import { jsonResponse } from '../../core/responses.js';
import { resolveIntegrationUserId } from '../../../backend/identity/oauth/integration-user-id.js';
import { upsertOauthToken } from '../../../backend/identity/oauth/token-store.js';
import { GMAIL_PROVIDER } from '../../core/gmail-user-tokens.js';

const STATE_PREFIX = 'gmail_integrations_oauth:';

/** Must match Google Cloud Console → OAuth client → Authorized redirect URIs exactly. */
export const GMAIL_OAUTH_CALLBACK_PATH = '/api/oauth/gmail/callback';

/**
 * Stable Gmail OAuth redirect (apex via WORKER_BASE_URL — not request Host).
 * @param {Request} request
 * @param {*} env
 */
export function resolveGmailOAuthRedirectUri(request, env) {
  const explicit =
    typeof env?.GMAIL_OAUTH_REDIRECT_URI === 'string' ? env.GMAIL_OAUTH_REDIRECT_URI.trim() : '';
  if (explicit) return explicit;

  const fromEnv =
    typeof env?.WORKER_BASE_URL === 'string' ? env.WORKER_BASE_URL.trim().replace(/\/$/, '') : '';
  if (fromEnv) return `${fromEnv}${GMAIL_OAUTH_CALLBACK_PATH}`;

  try {
    const parsed = new URL(request.url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'inneranimalmedia.com' || host === 'www.inneranimalmedia.com') {
      return `https://inneranimalmedia.com${GMAIL_OAUTH_CALLBACK_PATH}`;
    }
    return `${parsed.origin.replace(/\/$/, '')}${GMAIL_OAUTH_CALLBACK_PATH}`;
  } catch {
    return `https://inneranimalmedia.com${GMAIL_OAUTH_CALLBACK_PATH}`;
  }
}

export const GMAIL_OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];

function googleClientSecret(env) {
  const a = typeof env.GOOGLE_CLIENT_SECRET === 'string' ? env.GOOGLE_CLIENT_SECRET.trim() : '';
  if (a) return a;
  return typeof env.GOOGLE_OAUTH_CLIENT_SECRET === 'string' ? env.GOOGLE_OAUTH_CLIENT_SECRET.trim() : '';
}

function safeReturnTo(url) {
  const raw = url.searchParams.get('return_to') || '';
  if (raw.startsWith('/dashboard/') && !raw.startsWith('//') && !raw.includes(':')) {
    return raw;
  }
  return '/dashboard/settings/integrations';
}

function parseJwtPayload(jwt) {
  const token = String(jwt || '');
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const pad = parts[1].length % 4 === 0 ? '' : '='.repeat(4 - (parts[1].length % 4));
    const bin = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/') + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function upsertGmailRegistry(env, tenantId, userId, accountEmail) {
  if (!env?.DB || !tenantId) return;
  const display = String(accountEmail || '').trim();
  try {
    await env.DB.prepare(
      `INSERT INTO integration_registry (
         id, tenant_id, provider_key, display_name, category, auth_type, status,
         account_display, sort_order, updated_at
       ) VALUES (?, ?, 'google_gmail', 'Gmail', 'communication', 'oauth2', 'connected', ?, 25, datetime('now'))
       ON CONFLICT(tenant_id, provider_key) DO UPDATE SET
         status = 'connected',
         account_display = COALESCE(excluded.account_display, integration_registry.account_display),
         updated_at = datetime('now')`
    ).bind(
      `int_gmail_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      tenantId,
      display || null,
    ).run();
  } catch (e) {
    console.warn('[gmail-connect] registry upsert', e?.message ?? e);
  }
  try {
    await env.DB.prepare(
      `INSERT INTO integration_events (tenant_id, provider_key, event_type, actor, message, metadata_json)
       VALUES (?, 'google_gmail', 'connected', ?, ?, ?)`
    ).bind(
      tenantId,
      userId,
      'Gmail account connected',
      JSON.stringify({ account_display: display || null }),
    ).run();
  } catch { /* ignore */ }
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {*} env
 * @param {{ id?: string, email?: string, tenant_id?: string, active_tenant_id?: string }} authUser
 */
export async function startGmailConnect(request, url, env, authUser) {
  if (!env.GOOGLE_CLIENT_ID || !googleClientSecret(env)) {
    return jsonResponse({ error: 'Google OAuth not configured' }, 503);
  }
  if (!env.SESSION_CACHE) return jsonResponse({ error: 'SESSION_CACHE not configured' }, 503);

  const userId = await resolveIntegrationUserId(env, authUser);
  if (!userId) return jsonResponse({ error: 'User id required' }, 400);

  const returnTo = safeReturnTo(url);
  const redirectUri = resolveGmailOAuthRedirectUri(request, env);
  const stateId = crypto.randomUUID();
  await env.SESSION_CACHE.put(
    `${STATE_PREFIX}${stateId}`,
    JSON.stringify({
      user_id: userId,
      tenant_id: authUser.tenant_id ?? authUser.active_tenant_id ?? null,
      return_to: returnTo,
      popup: url.searchParams.get('popup') === '1',
      redirect_uri: redirectUri,
    }),
    { expirationTtl: 600 },
  );

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', GMAIL_OAUTH_SCOPES.join(' '));
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('state', stateId);

  return Response.redirect(authUrl.toString(), 302);
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {*} env
 */
export async function handleGmailConnectCallback(request, url, env) {
  const origin =
    (typeof env?.WORKER_BASE_URL === 'string' && env.WORKER_BASE_URL.trim().replace(/\/$/, '')) ||
    url.origin;
  const fail = (reason = 'gmail_auth_failed') =>
    Response.redirect(`${origin}/dashboard/mail?error=${encodeURIComponent(reason)}`, 302);

  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  if (!code || !state || !env.SESSION_CACHE) return fail();

  const stateKey = `${STATE_PREFIX}${state}`;
  const stateRaw = await env.SESSION_CACHE.get(stateKey);
  if (!stateRaw) return fail('gmail_state_expired');
  await env.SESSION_CACHE.delete(stateKey).catch(() => {});

  let parsed;
  try {
    parsed = JSON.parse(stateRaw);
  } catch {
    return fail('gmail_state_invalid');
  }

  const userId = parsed?.user_id ? String(parsed.user_id) : '';
  if (!userId) return fail('gmail_state_invalid');

  const authUser = await getAuthUser(request, env);
  const tenantId =
    (parsed?.tenant_id && String(parsed.tenant_id).trim()) ||
    (authUser?.tenant_id && String(authUser.tenant_id).trim()) ||
    (env?.TENANT_ID && String(env.TENANT_ID).trim()) ||
    '';

  const redirectUri =
    (parsed?.redirect_uri && String(parsed.redirect_uri).trim()) ||
    resolveGmailOAuthRedirectUri(request, env);
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: googleClientSecret(env),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const tok = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok || !tok?.access_token) return fail('gmail_token_exchange_failed');

  const idPayload = tok.id_token ? parseJwtPayload(tok.id_token) : null;
  const acct = idPayload?.email ? String(idPayload.email).trim().toLowerCase() : '';
  if (!acct) return fail('gmail_no_account_email');

  await upsertOauthToken(env, {
    user_id: userId,
    tenant_id: tenantId || null,
    provider: GMAIL_PROVIDER,
    access_token: String(tok.access_token),
    refresh_token: tok.refresh_token ? String(tok.refresh_token) : null,
    scope: tok.scope ? String(tok.scope) : GMAIL_OAUTH_SCOPES.join(' '),
    expires_at: tok.expires_in
      ? Math.floor(Date.now() / 1000) + Number(tok.expires_in)
      : null,
    account_identifier: acct,
    account_email: acct,
    account_display: acct,
    workspace_id: authUser?.active_workspace_id || authUser?.default_workspace_id || null,
    metadata_json: JSON.stringify({ connect_surface: 'integrations_gmail' }),
  }, { skipRegistry: false });

  await upsertGmailRegistry(env, tenantId, userId, acct);

  const returnTo = parsed?.return_to && String(parsed.return_to).startsWith('/dashboard/')
    ? String(parsed.return_to)
    : '/dashboard/mail';
  const sep = returnTo.includes('?') ? '&' : '?';
  return Response.redirect(`${origin}${returnTo}${sep}connected=1&account=${encodeURIComponent(acct)}`, 302);
}

/**
 * Disconnect one Gmail account (or all if account omitted).
 * @param {*} env
 * @param {{ id?: string, email?: string }} authUser
 * @param {string} [account]
 */
export async function disconnectGmailAccount(env, authUser, account = '') {
  if (!env?.DB) return { ok: false, error: 'DB not configured' };
  const userId = await resolveIntegrationUserId(env, authUser);
  if (!userId) return { ok: false, error: 'User id required' };

  const acct = account ? String(account).trim().toLowerCase() : '';
  if (acct) {
    await env.DB.prepare(
      `DELETE FROM user_oauth_tokens
       WHERE user_id = ? AND lower(provider) IN ('google_gmail', 'gmail')
         AND lower(account_identifier) = ?`
    ).bind(userId, acct).run();
    const email = authUser?.email ? String(authUser.email).trim().toLowerCase() : '';
    if (email && email !== userId.toLowerCase()) {
      await env.DB.prepare(
        `DELETE FROM user_oauth_tokens
         WHERE user_id = ? AND lower(provider) IN ('google_gmail', 'gmail')
           AND lower(account_identifier) = ?`
      ).bind(email, acct).run();
    }
  } else {
    await env.DB.prepare(
      `DELETE FROM user_oauth_tokens
       WHERE user_id = ? AND lower(provider) IN ('google_gmail', 'gmail')`
    ).bind(userId).run();
    const email = authUser?.email ? String(authUser.email).trim().toLowerCase() : '';
    if (email && email !== userId.toLowerCase()) {
      await env.DB.prepare(
        `DELETE FROM user_oauth_tokens
         WHERE user_id = ? AND lower(provider) IN ('google_gmail', 'gmail')`
      ).bind(email).run();
    }
  }

  return { ok: true, account: acct || 'all' };
}
