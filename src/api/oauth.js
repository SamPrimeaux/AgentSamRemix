/**
 * OAuth + API Key connection endpoints
 *
 * Pattern:
 *  - GET  /api/oauth/:provider/start    -> 302 to provider (login flows when unauthenticated for google/github match worker.js)
 *  - GET  /api/oauth/:provider/callback (provider redirect) -> 302 back to return_to (default: /dashboard/overview; integrations flows pass explicit return_to)
 *  - POST /api/oauth/apikey/:provider   (auth required) -> validate + store encrypted
 *
 * Notes:
 *  - Uses SESSION_CACHE KV for state storage (10m TTL).
 *  - Persists tokens in D1 `user_oauth_tokens` with forward-compatible encrypted columns.
 */
import { fetchAuthUserTenantId, jsonResponse } from '../core/auth.js';
import { getAuthUser } from '../../backend/identity/resolve-identity.js';
import { googleLoginOAuthRedirectUri, githubLoginOAuthRedirectUri } from '../core/iam-oauth-origin.js';
import {
  upsertOauthToken,
  ensureOauthTokenColumns,
  normalizeProvider,
  nowSeconds,
  encryptWithVault,
  decryptWithVault,
} from '../../backend/identity/oauth/token-store.js';
import { isVaultConfigured } from '../../backend/credentials/vault-key-material.js';
import {
  fetchSupabaseManagementProjects,
  getSupabaseManagementOAuthCredentials,
  supabaseOAuthAccountIdentifier,
} from '../../backend/identity/oauth/user-token.js';
import {
  handleGoogleLoginOAuthCallback,
  handleGitHubLoginOAuthCallback,
} from './oauth-login-callbacks.js';
import { getAESKey, aesGcmEncryptToB64, aesGcmDecryptFromB64 } from '../../backend/credentials/crypto-vault.js';
import { resolveIntegrationUserId } from '../../backend/identity/oauth/integration-user-id.js';
import {
  appendOAuthReturnParams,
  integrationOAuthShouldPopup,
  oauthPopupCompleteHtml,
} from '../core/oauth-popup-complete.js';
import { resolveCanonicalWorkspace } from '../../backend/identity/workspace-resolve.js';

export { upsertOauthToken, ensureOauthTokenColumns, normalizeProvider } from '../../backend/identity/oauth/token-store.js';
export { resolveCanonicalWorkspace };

import { syncProviderModels } from './integrations/model-sync.js';
import {
  MCP_OAUTH_CODE_TTL_SECONDS,
  MCP_OAUTH_TOKEN_TTL_SECONDS,
  MCP_OAUTH_AUTHZ_TTL_SECONDS,
  mcpOAuthNow,
  mcpOAuthSha256Hex,
  mcpOAuthPkceS256,
  mcpOAuthRandomToken,
  mcpOAuthJsonError,
  mcpOAuthValidateRedirectUri,
  mcpOAuthIsPublicDcrRedirect,
  iamMcpOAuthAuthorizationServerMetadata,
  iamMcpOpenIdConfiguration,
  IAM_OAUTH_ISSUER,
  IAM_MCP_RESOURCE_URL,
  MCP_CANONICAL_CLIENT_ID,
  resolveUnauthenticatedDcrTenantId,
  resolveMcpOAuthResourceParam,
  assertMcpOAuthResourceMatches,
  normalizeMcpOAuthResourceUrl,
  parseMcpOAuthAuthorizationMetadata,
  mcpOAuthLoadClient,
  mcpOAuthRedirectAllowed,
  mcpOAuthScopeAllowed,
  mcpOAuthNormalizeScope,
  mcpOAuthParseScopeList,
  loadMcpOAuthExternalAllowedToolsJson,
  loadMcpOAuthExternalToolKeys,
  loadWorkspaceMcpTokenBindings,
  buildMcpOAuthTokenEntitlements,
  oauthToolAccessDomainsPayload,
  resolveMcpOAuthTokenTtlSeconds,
  intersectOAuthToolsWithUserPolicy,
  loadMcpOAuthAllowlistRows,
  augmentMcpOAuthScopeForWriteTools,
} from './mcp-oauth-shared.js';
import { checkMcpOAuthRateLimit } from './mcp-oauth-rate-limit.js';
import { logAuthEvent } from '../../backend/identity/auth-events.js';
import {
  signIamOidcIdToken,
  buildIamMcpIdTokenClaims,
  iamOidcJwksResponse,
} from '../core/mcp-oidc-id-token.js';

function mcpOAuthRequestMeta(request) {
  return {
    cf_ray: request.headers.get('cf-ray') || null,
    colo: request.headers.get('cf-ipcountry') || null,
  };
}

async function logMcpOAuthTokenFailure(env, request, error, extra = {}) {
  let recovery = extra.recovery ?? null;
  if (!recovery) {
    try {
      const { mcpOAuthRecoveryExtras } = await import('../../backend/identity/recovery.js');
      recovery = mcpOAuthRecoveryExtras(error)?.recovery ?? null;
    } catch (_) {}
  }
  await logAuthEvent(env, {
    request,
    eventType: 'iam_mcp_oauth_token_failed',
    status: 'fail',
    metadata: { error, recovery, ...mcpOAuthRequestMeta(request), ...extra },
  });
}

export { logMcpOAuthTokenFailure };

const OAUTH_STATE_TTL_SECONDS = 600;


/** Last 6 chars of client id for logs only — never log full ids or secrets. */
function oauthClientIdTail(clientId) {
  const t = String(clientId || '').trim();
  if (!t) return '(empty)';
  return t.length <= 6 ? t : t.slice(-6);
}

const PROVIDERS = new Set(['github', 'google', 'cloudflare', 'supabase']);
const APIKEY_PROVIDERS = new Set(['openai', 'anthropic', 'google_ai', 'resend', 'cursor']);


function oauthStateKey(state) {
  return `oauth_state_${state}`;
}

/**
 * Integration OAuth state keys in SESSION_CACHE. Supabase Management uses its own prefix so it
 * never collides with project login OAuth in auth.js (`supabase_auth_oauth_state:*`).
 */
function integrationOAuthKvKey(provider, state) {
  const p = String(provider || '').trim().toLowerCase();
  if (p === 'supabase') return `supabase_management_oauth_state:${state}`;
  return oauthStateKey(state);
}

async function kvPutIntegrationOAuthState(env, provider, state, payload) {
  if (!env?.SESSION_CACHE?.put) return false;
  await env.SESSION_CACHE.put(integrationOAuthKvKey(provider, state), JSON.stringify(payload), {
    expirationTtl: OAUTH_STATE_TTL_SECONDS,
  });
  return true;
}

async function kvGetIntegrationOAuthState(env, provider, state) {
  if (!env?.SESSION_CACHE?.get) return null;
  const raw = await env.SESSION_CACHE.get(integrationOAuthKvKey(provider, state));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function kvDeleteIntegrationOAuthState(env, provider, state) {
  if (!env?.SESSION_CACHE?.delete) return;
  await env.SESSION_CACHE.delete(integrationOAuthKvKey(provider, state));
}

const DEFAULT_OAUTH_RETURN = '/dashboard/agent';

function safeReturnTo(url) {
  const raw = String(url || '').trim();
  if (!raw) return DEFAULT_OAUTH_RETURN;
  if (raw.startsWith('/dashboard/')) return raw;
  return DEFAULT_OAUTH_RETURN;
}

/**
 * Unauthenticated Google login/start — state + redirect_uri must match handleGoogleOAuthCallback in worker.js.
 */
async function loginGoogleOAuthStart(_request, url, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.SESSION_CACHE) {
    return jsonResponse({ error: 'OAuth not configured' }, 503);
  }
  const returnTo = url.searchParams.get('return_to') || url.searchParams.get('next') || '';
  const connectDrive =
    url.searchParams.get('connectDrive') === '1' ||
    url.searchParams.get('connect') === 'drive';
  const popup = url.searchParams.get('popup') === '1';
  const safeReturn =
    returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes(':')
      ? returnTo
      : '/dashboard/agent';
  const state = crypto.randomUUID();
  const redirectUri = googleLoginOAuthRedirectUri(url);
  const scope = connectDrive
    ? 'openid email profile https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file'
    : 'openid email profile';
  const statePayload = JSON.stringify({
    redirectUri,
    returnTo: safeReturn,
    connectDrive: !!connectDrive,
    popup,
  });
  await env.SESSION_CACHE.put(`oauth_state_${state}`, statePayload, {
    expirationTtl: OAUTH_STATE_TTL_SECONDS,
  });
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    state,
    access_type: 'offline',
    prompt: connectDrive ? 'consent' : 'select_account',
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}

/**
 * Unauthenticated GitHub login/start — state key + redirect_uri must match handleGitHubOAuthCallback in worker.js.
 */
async function loginGitHubOAuthStart(_request, url, env) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.SESSION_CACHE) {
    return jsonResponse({ error: 'OAuth not configured' }, 503);
  }
  const returnTo = url.searchParams.get('return_to') || url.searchParams.get('next') || '';
  const popup = url.searchParams.get('popup') === '1';
  const safeReturn =
    returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes(':')
      ? returnTo
      : '/dashboard/agent';
  const state = crypto.randomUUID();
  const redirectUri = githubLoginOAuthRedirectUri(url);
  const statePayload = JSON.stringify({
    redirectUri,
    returnTo: safeReturn,
    connectGitHub:
      popup ||
      safeReturn.startsWith('/dashboard/agent') ||
      safeReturn.startsWith('/dashboard/artifacts'),
    popup,
  });
  await env.SESSION_CACHE.put(`oauth_state_github_${state}`, statePayload, {
    expirationTtl: OAUTH_STATE_TTL_SECONDS,
  });
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'repo user:email read:user',
    state,
  });
  return Response.redirect(`https://github.com/login/oauth/authorize?${params}`, 302);
}








/** Canonical callback for Supabase Management OAuth (must match Supabase OAuth app redirect URLs). */
export function supabaseManagementOAuthRedirectUri(request, env) {
  const fromEnv =
    typeof env?.WORKER_BASE_URL === 'string' ? env.WORKER_BASE_URL.trim().replace(/\/$/, '') : '';
  if (fromEnv) return `${fromEnv}/api/auth/supabase/callback`;
  try {
    return `${new URL(request.url).origin}/api/auth/supabase/callback`;
  } catch {
    return 'https://inneranimalmedia.com/api/auth/supabase/callback';
  }
}

/** Match `user_oauth_tokens.user_id` — auth_users.id (au_*) only. */
function integrationUserId(authUser) {
  const sid = authUser?.id != null && String(authUser.id).trim() !== '' ? String(authUser.id).trim() : '';
  return sid.startsWith('au_') ? sid : '';
}

function isGoogleDriveConnectRequest(url) {
  return (
    url.searchParams.get('connectDrive') === '1' ||
    url.searchParams.get('connect') === 'drive'
  );
}

/** Sign-in / sign-up Google OAuth — must not bind to an existing session's user_id (integration path). */
function isGoogleLoginOAuthStart(url) {
  if (isGoogleDriveConnectRequest(url)) return false;
  // Catalog / integrations may pass Drive scopes without connectDrive — still not login.
  const scopesBlob = `${url.searchParams.get('oauth_scopes') || ''} ${url.searchParams.get('scope') || ''}`;
  if (/googleapis\.com\/auth\/drive/i.test(scopesBlob)) return false;
  if (url.searchParams.get('login') === '1' || url.searchParams.get('intent') === 'login') {
    return true;
  }
  const returnTo = String(url.searchParams.get('return_to') || url.searchParams.get('next') || '').trim();
  if (!returnTo) return true;
  if (returnTo.includes('/dashboard/settings')) return false;
  if (returnTo.startsWith('/auth/')) return true;
  if (returnTo.startsWith('/dashboard/')) return true;
  return false;
}

function isGitHubLoginOAuthStart(url) {
  if (url.searchParams.get('login') === '1' || url.searchParams.get('intent') === 'login') {
    return true;
  }
  const returnTo = String(url.searchParams.get('return_to') || url.searchParams.get('next') || '').trim();
  if (!returnTo) return true;
  if (returnTo.includes('/dashboard/settings')) return false;
  if (returnTo.startsWith('/auth/')) return true;
  if (returnTo.startsWith('/dashboard/')) return true;
  return false;
}


function githubAuthUrl(env, state, oauthScopeString) {
  const u = new URL('https://github.com/login/oauth/authorize');
  u.searchParams.set('client_id', env.GITHUB_CLIENT_ID || '');
  u.searchParams.set('redirect_uri', 'https://inneranimalmedia.com/api/oauth/github/callback');
  u.searchParams.set(
    'scope',
    (oauthScopeString && String(oauthScopeString).trim())
      ? String(oauthScopeString).trim()
      : 'repo read:user read:org workflow',
  );
  u.searchParams.set('state', state);
  return u.toString();
}

function googleAuthUrl(env, state, oauthScopeString) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', env.GOOGLE_CLIENT_ID || '');
  u.searchParams.set('redirect_uri', 'https://inneranimalmedia.com/api/oauth/google/callback');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set(
    'scope',
    (oauthScopeString && String(oauthScopeString).trim())
      ? String(oauthScopeString).trim()
      : [
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
        ].join(' '),
  );
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', state);
  return u.toString();
}

const CLOUDFLARE_OAUTH_REDIRECT_URI = 'https://inneranimalmedia.com/api/oauth/cloudflare/callback';
/**
 * Must be a subset of scopes enabled on the IAM Cloudflare OAuth client
 * "Inner Animal Media Platform" (Manage Account → OAuth clients).
 * Full client catalog (60): docs/auth/CLOUDFLARE_OAUTH_CLIENT_SCOPES.md
 * Requesting a scope not on the client → invalid_scope / no code.
 *
 * Override at runtime with wrangler secret/var CLOUDFLARE_OAUTH_SCOPES (space-separated).
 */
const CLOUDFLARE_OAUTH_SCOPES = [
  'account-settings.read',
  'zone.read',
  'cf-agents.write',
  'd1.read',
  'd1.write',
  'query-cache.read',
  'query-cache.write',
  'mcp-portals.read',
  'mcp-portals.write',
  'page.read',
  'page.write',
  'vectorize.read',
  'vectorize.write',
  'workers-r2.read',
  'workers-r2.write',
  'workers-r2-bucket-item.read',
  'workers-r2-bucket-item.write',
  'workers-routes.read',
  'workers-routes.write',
  'workers-scripts.read',
  'workers-scripts.write',
  // Media — offered on OAuth client (see CLOUDFLARE_OAUTH_CLIENT_SCOPES.md)
  'images.read',
  'images.write',
  // Stream BYOK — customers must reconnect once after this ships
  'stream.read',
  'stream.write',
  'offline_access',
].join(' ');

function resolveCloudflareOAuthScopes(env, oauthScopeString) {
  if (oauthScopeString != null && String(oauthScopeString).trim()) {
    return String(oauthScopeString).trim();
  }
  const fromEnv = env?.CLOUDFLARE_OAUTH_SCOPES != null ? String(env.CLOUDFLARE_OAUTH_SCOPES).trim() : '';
  if (fromEnv) return fromEnv.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return CLOUDFLARE_OAUTH_SCOPES;
}

function cloudflareAuthUrl(env, state, oauthScopeString) {
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID) return null;
  const u = new URL('https://dash.cloudflare.com/oauth2/auth');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', env.CLOUDFLARE_OAUTH_CLIENT_ID);
  u.searchParams.set('redirect_uri', CLOUDFLARE_OAUTH_REDIRECT_URI);
  u.searchParams.set('scope', resolveCloudflareOAuthScopes(env, oauthScopeString));
  u.searchParams.set('state', state);
  return u.toString();
}

// ── Supabase MANAGEMENT OAuth (/api/oauth/supabase/*) ────────────────────────
// Uses ONLY SUPABASE_MANAGEMENT_OAUTH_* → https://api.supabase.com/v1/oauth/*
// redirect_uri: https://inneranimalmedia.com/api/oauth/supabase/callback
//
// Project Auth login OAuth (different secrets, different KV keys) — auth.js ONLY:
//   GET /api/auth/supabase/start|callback → {project}.supabase.co/auth/v1/oauth/* (SUPABASE_OAUTH_*)
//
// IAM OAuth Server consent SPA (InnerAnimalMedia as provider — not Supabase login):
//   GET /api/auth/oauth/consent — unrelated to either flow above.
// ─────────────────────────────────────────────────────────────────────────────
function supabaseAuthUrl(env, request, state, oauthScopeString, redirectUri) {
  const creds = getSupabaseManagementOAuthCredentials(env);
  if (!creds) return null;
  const u = new URL('https://api.supabase.com/v1/oauth/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', creds.clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set(
    'scope',
    (oauthScopeString && String(oauthScopeString).trim())
      ? String(oauthScopeString).trim()
      : 'all',
  );
  u.searchParams.set('state', state);
  console.log(
    `[supabase_management_oauth] ${JSON.stringify({
      phase: 'authorize_redirect',
      provider: 'supabase_management_api',
      callback_path: '/api/auth/supabase/callback',
      redirect_uri: redirectUri,
      authorize_host: 'api.supabase.com',
      client_id_tail: oauthClientIdTail(creds.clientId),
    })}`,
  );
  return u.toString();
}

async function exchangeGithub(env, code) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: 'https://inneranimalmedia.com/api/oauth/github/callback',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || 'GitHub token exchange failed');
  return data;
}

async function githubAccount(accessToken) {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'IAM-Platform', Accept: 'application/vnd.github+json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'GitHub user fetch failed');
  return { login: data.login || '', email: data.email || null };
}

async function exchangeGoogle(env, code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: 'https://inneranimalmedia.com/api/oauth/google/callback',
      grant_type: 'authorization_code',
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error_description || 'Google token exchange failed');
  return data;
}

async function googleUserinfo(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || 'Google userinfo fetch failed');
  return { email: data.email || null, name: data.name || null };
}

/** Gmail integration OAuth — distinct from login Google (`/api/oauth/google/*`) and Drive integration. */
const GMAIL_OAUTH_REDIRECT_URI = 'https://inneranimalmedia.com/api/oauth/gmail/callback';
const GMAIL_OAUTH_SCOPES =
  'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';

function gmailOauthStateKvKey(token) {
  return `oauth_state:${token}`;
}

function googleClientSecretForGmailCallback(env) {
  const a = typeof env.GOOGLE_CLIENT_SECRET === 'string' ? env.GOOGLE_CLIENT_SECRET.trim() : '';
  if (a) return a;
  const b =
    typeof env.GOOGLE_OAUTH_CLIENT_SECRET === 'string' ? env.GOOGLE_OAUTH_CLIENT_SECRET.trim() : '';
  return b;
}

async function exchangeGoogleAuthCodeForGmail(env, code) {
  const clientSecret = googleClientSecretForGmailCallback(env);
  if (!env.GOOGLE_CLIENT_ID || !clientSecret) {
    throw new Error('Google OAuth client not configured');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: clientSecret,
      redirect_uri: GMAIL_OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Google token exchange failed');
  }
  return data;
}

async function gmailOAuthStart(request, _url, env) {
  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!env.GOOGLE_CLIENT_ID || !env.SESSION_CACHE?.put) {
    return jsonResponse({ error: 'OAuth not configured' }, 503);
  }
  const state = crypto.randomUUID();
  await env.SESSION_CACHE.put(
    gmailOauthStateKvKey(state),
    JSON.stringify({ user_id: authUser.id, provider: 'gmail' }),
    { expirationTtl: OAUTH_STATE_TTL_SECONDS },
  );
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: GMAIL_OAUTH_REDIRECT_URI,
    scope: GMAIL_OAUTH_SCOPES,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}

async function gmailOAuthCallback(_request, url, env) {
  const origin = url.origin;
  const fail = () => Response.redirect(`${origin}/dashboard/mail?error=gmail_auth_failed`, 302);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  if (!state || !code) return fail();

  if (!env.SESSION_CACHE?.get || !env.SESSION_CACHE?.delete) return fail();

  const raw = await env.SESSION_CACHE.get(gmailOauthStateKvKey(state));
  if (!raw) return fail();

  let stored;
  try {
    stored = JSON.parse(raw);
  } catch {
    await env.SESSION_CACHE.delete(gmailOauthStateKvKey(state));
    return fail();
  }

  const userId = stored?.user_id != null ? String(stored.user_id) : '';
  if (!userId || stored?.provider !== 'gmail') {
    await env.SESSION_CACHE.delete(gmailOauthStateKvKey(state));
    return fail();
  }

  await env.SESSION_CACHE.delete(gmailOauthStateKvKey(state));

  if (!env.DB || !isVaultConfigured(env)) return fail();

  try {
    const tok = await exchangeGoogleAuthCodeForGmail(env, code);
    const resolvedTok = await resolveOAuthAccessToken(env, tok);
    if (!resolvedTok) throw new Error('Google token unavailable — please reconnect');
    const info = await googleUserinfo(resolvedTok);
    const email = info.email != null ? String(info.email).trim() : '';
    if (!email) throw new Error('missing_email');

    await upsertOauthToken(env, {
      user_id: userId,
      tenant_id: '',
      person_uuid: '',
      provider: 'gmail',
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || null,
      scope: tok.scope || GMAIL_OAUTH_SCOPES,
      expires_at: tok.expires_in ? nowSeconds() + Number(tok.expires_in) : null,
      account_identifier: email,
      account_email: email,
      account_display: email,
    });
  } catch {
    return fail();
  }

  return Response.redirect(`${origin}/dashboard/mail`, 302);
}

async function exchangeCloudflare(env, code) {
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID || !env.CLOUDFLARE_OAUTH_CLIENT_SECRET) {
    throw new Error('Cloudflare OAuth not configured');
  }
  const basic = btoa(`${env.CLOUDFLARE_OAUTH_CLIENT_ID}:${env.CLOUDFLARE_OAUTH_CLIENT_SECRET}`);
  const res = await fetch('https://dash.cloudflare.com/oauth2/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      code,
      redirect_uri: CLOUDFLARE_OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Cloudflare token exchange failed');
  return data;
}

async function exchangeSupabase(env, code, redirectUri) {
  const creds = getSupabaseManagementOAuthCredentials(env);
  if (!creds) {
    throw new Error('Supabase Management OAuth not configured (SUPABASE_MANAGEMENT_OAUTH_*)');
  }
  const res = await fetch('https://api.supabase.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Supabase token exchange failed');
  return data;
}

async function validateApiKey(provider, apiKey) {
  const key = String(apiKey || '');
  if (!key) return { ok: false, error: 'api_key required' };
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401) return { ok: false, error: 'Invalid API key — check and retry' };
    return { ok: res.ok, error: res.ok ? null : `Validation failed (${res.status})` };
  }
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    if (res.status === 401) return { ok: false, error: 'Invalid API key — check and retry' };
    // 200 OK or 400 Bad Request both indicate the key is accepted.
    if (res.status === 200 || res.status === 400) return { ok: true, error: null };
    return { ok: false, error: `Validation failed (${res.status})` };
  }
  if (provider === 'google_ai') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Invalid API key — check and retry' };
    return { ok: res.ok, error: res.ok ? null : `Validation failed (${res.status})` };
  }
  if (provider === 'resend') {
    const res = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401) return { ok: false, error: 'Invalid API key — check and retry' };
    return { ok: res.ok, error: res.ok ? null : `Validation failed (${res.status})` };
  }
  if (provider === 'cursor') {
    return { ok: true, error: null };
  }
  return { ok: false, error: 'Unsupported provider' };
}

async function storeApiKeyAsOauth(env, authUser, provider, apiKey) {
  const { upsertIntegrationByokKey } = await import('../core/integration-byok-sync.js');
  const registrySlug = String(provider || '').trim().toLowerCase().replace(/-/g, '_');
  await upsertIntegrationByokKey(env, authUser, registrySlug, apiKey, {
    validate: false,
    triggeredBy: 'oauth_apikey',
    source: 'oauth_apikey',
  });
}


// ── MCP OAuth Provider Contract -------------------------------------------------
// Implements the app-side OAuth provider endpoints consumed by the custom MCP server:
//
// GET  /api/oauth/authorize
// POST /api/oauth/token
// GET  /api/oauth/userinfo
//
// Existing integration OAuth routes remain under /api/oauth/:provider/start|callback.

async function mcpOAuthResolveTenantId(env, authUser) {
  const direct = String(authUser?.tenant_id || env.TENANT_ID || env.DEFAULT_TENANT_ID || '').trim();
  if (direct) return direct;

  if (env.DB && authUser?.id) {
    try {
      const row = await env.DB.prepare(`SELECT tenant_id FROM auth_users WHERE id = ? LIMIT 1`)
        .bind(authUser.id)
        .first();
      if (row?.tenant_id) return String(row.tenant_id);
    } catch (_) {}
  }

  return null;
}

async function mcpOAuthReadBody(request) {
  const ct = String(request.headers.get('Content-Type') || '').toLowerCase();

  if (ct.includes('application/json')) {
    const j = await request.json().catch(() => ({}));
    return {
      grant_type: String(j.grant_type || j.grantType || ''),
      code: String(j.code || ''),
      redirect_uri: String(j.redirect_uri || j.redirectUri || ''),
      code_verifier: String(j.code_verifier || j.codeVerifier || ''),
      client_id: String(j.client_id || j.clientId || ''),
      client_secret: String(j.client_secret || j.clientSecret || ''),
      refresh_token: String(j.refresh_token || j.refreshToken || ''),
      resource: resolveMcpOAuthResourceParam(j),
    };
  }

  const raw = await request.text().catch(() => '');
  const form = new URLSearchParams(raw);
  return {
    grant_type: String(form.get('grant_type') || ''),
    code: String(form.get('code') || ''),
    redirect_uri: String(form.get('redirect_uri') || ''),
    code_verifier: String(form.get('code_verifier') || ''),
    client_id: String(form.get('client_id') || ''),
    client_secret: String(form.get('client_secret') || ''),
    refresh_token: String(form.get('refresh_token') || ''),
    resource: resolveMcpOAuthResourceParam(form),
  };
}

export { mcpOAuthReadBody };

function readOAuthClientBasicAuth(request) {
  const auth = String(request.headers.get('Authorization') || '').trim();
  if (!auth.toLowerCase().startsWith('basic ')) return { clientId: '', clientSecret: '' };
  const encoded = auth.slice(6).trim();
  if (!encoded) return { clientId: '', clientSecret: '' };
  try {
    const decoded = atob(encoded);
    const sep = decoded.indexOf(':');
    if (sep < 0) return { clientId: '', clientSecret: '' };
    return {
      clientId: decoded.slice(0, sep),
      clientSecret: decoded.slice(sep + 1),
    };
  } catch {
    return { clientId: '', clientSecret: '' };
  }
}

function parseOAuthRegistrationBody(raw) {
  const body = raw && typeof raw === 'object' ? raw : {};
  const redirectUrisRaw = body.redirect_uris;
  const redirectUris = Array.isArray(redirectUrisRaw)
    ? redirectUrisRaw.map((u) => String(u || '').trim()).filter(Boolean)
    : [];
  const grantTypesRaw = body.grant_types;
  const grantTypes = Array.isArray(grantTypesRaw)
    ? grantTypesRaw.map((g) => String(g || '').trim()).filter(Boolean)
    : ['authorization_code'];
  const responseTypesRaw = body.response_types;
  const responseTypes = Array.isArray(responseTypesRaw)
    ? responseTypesRaw.map((g) => String(g || '').trim()).filter(Boolean)
    : ['code'];
  const requestedMethod = String(body.token_endpoint_auth_method || '').trim().toLowerCase();
  const tokenEndpointAuthMethod = requestedMethod || 'none';
  const requestedScopes = Array.isArray(body.scope)
    ? body.scope.map((s) => String(s || '').trim()).filter(Boolean)
    : mcpOAuthParseScopeList(String(body.scope || ''));

  return {
    clientName: String(
      body.client_name || body.software_name || body.software_id || body.client_id || '',
    ).trim(),
    logoUri: String(body.logo_uri || '').trim(),
    clientUri: String(body.client_uri || '').trim(),
    policyUri: String(body.policy_uri || '').trim(),
    tosUri: String(body.tos_uri || '').trim(),
    redirectUris,
    grantTypes,
    responseTypes,
    tokenEndpointAuthMethod,
    requestedScopes,
  };
}

async function handleMcpOAuthRegister(request, env, _ctx) {
  if (!env.DB) return mcpOAuthJsonError('database_not_configured', 503);
  const authUser = await getAuthUser(request, env);

  const rl = await checkMcpOAuthRateLimit(env, request, 'register', 30);
  if (!rl.ok) return mcpOAuthJsonError(rl.error, 429, { retry_after: rl.retry_after });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    console.warn('[mcp-oauth-register] invalid_client_metadata (non-object body)');
    return mcpOAuthJsonError('invalid_client_metadata', 400);
  }

  const parsed = parseOAuthRegistrationBody(body);
  // Cursor / some MCP hosts omit client_name — don't fail the whole OAuth chain on a label.
  if (!parsed.clientName) {
    parsed.clientName = 'MCP Client';
  }
  if (!parsed.redirectUris.length) {
    console.warn('[mcp-oauth-register] invalid_redirect_uris', {
      keys: Object.keys(body),
    });
    return mcpOAuthJsonError('invalid_redirect_uris', 400);
  }
  if (!parsed.grantTypes.includes('authorization_code')) {
    console.warn('[mcp-oauth-register] unsupported_grant_type', { grantTypes: parsed.grantTypes });
    return mcpOAuthJsonError('unsupported_grant_type', 400);
  }
  if (!parsed.responseTypes.includes('code')) {
    console.warn('[mcp-oauth-register] unsupported_response_type', {
      responseTypes: parsed.responseTypes,
    });
    return mcpOAuthJsonError('unsupported_response_type', 400);
  }
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(parsed.tokenEndpointAuthMethod)) {
    console.warn('[mcp-oauth-register] invalid_token_endpoint_auth_method', {
      method: parsed.tokenEndpointAuthMethod,
    });
    return mcpOAuthJsonError('invalid_token_endpoint_auth_method', 400);
  }

  const validatedRedirects = [];
  for (const redirect of parsed.redirectUris) {
    const check = mcpOAuthValidateRedirectUri(redirect, null, env);
    if (!check.ok || !check.url?.href) {
      console.warn('[mcp-oauth-register] redirect rejected', {
        redirect,
        error: check.error || 'invalid_redirect_uri',
      });
      return mcpOAuthJsonError(check.error || 'invalid_redirect_uri', 400);
    }
    validatedRedirects.push(check.url.href);
  }

  const normalizedRedirectUris = Array.from(new Set(validatedRedirects));

  // Unauthenticated DCR: loopback, cursor://, Cursor Agents (www.cursor.com), or hosted connectors.
  if (!authUser) {
    const allOk = normalizedRedirectUris.every((href) => mcpOAuthIsPublicDcrRedirect(href));
    if (!allOk) {
      console.warn('[mcp-oauth-register] redirect_uri_not_allowed (public DCR)', {
        redirects: normalizedRedirectUris,
      });
      return mcpOAuthJsonError('redirect_uri_not_allowed', 400);
    }

    // Native / hosted connectors: public + PKCE only (no client secret).
    parsed.tokenEndpointAuthMethod = 'none';
  }

  const allowedScopeSet = new Set([
    'openid',
    'iam:profile',
    'iam:workspaces',
    'iam:agent',
    'mcp:tools',
    'mcp:userinfo',
  ]);
  const selectedScopes = parsed.requestedScopes.length
    ? parsed.requestedScopes.filter((s) => allowedScopeSet.has(s))
    : ['iam:profile', 'iam:workspaces', 'mcp:tools', 'mcp:userinfo'];
  if (!selectedScopes.length) return mcpOAuthJsonError('invalid_scope', 400);

  const userId = authUser ? integrationUserId(authUser) : 'system_dcr';
  let tenantId;
  if (authUser) {
    tenantId = await mcpOAuthResolveTenantId(env, authUser);
  } else {
    tenantId = await resolveUnauthenticatedDcrTenantId(env);
  }
  if (!userId || !tenantId) return mcpOAuthJsonError('dcr_not_configured', 503);

  const createdAt = mcpOAuthNow();
  const clientId = `iam_dcr_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const issuedClientSecret = mcpOAuthRandomToken('ocs', 24);
  const clientSecretHash = await mcpOAuthSha256Hex(issuedClientSecret);
  const requiresPkce = 1;

  await env.DB.prepare(
    `INSERT INTO oauth_clients (
       id, client_id, client_secret_hash, name, display_name, description,
       owner_account_id, tenant_id, redirect_uris, allowed_scopes, grant_types,
       token_endpoint_auth_method, client_type, is_active, is_first_party, requires_pkce,
       logo_url, homepage_url, privacy_policy_url, terms_url, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `oac_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
      clientId,
      clientSecretHash,
      parsed.clientName,
      parsed.clientName,
      'OAuth client registered via /api/oauth/register',
      userId,
      tenantId,
      JSON.stringify(normalizedRedirectUris),
      JSON.stringify(Array.from(new Set(selectedScopes))),
      JSON.stringify(['authorization_code']),
      parsed.tokenEndpointAuthMethod,
      parsed.tokenEndpointAuthMethod === 'none' ? 'public' : 'confidential',
      requiresPkce,
      parsed.logoUri || null,
      parsed.clientUri || null,
      parsed.policyUri || null,
      parsed.tosUri || null,
      createdAt,
      createdAt,
    )
    .run();

  await logAuthEvent(env, {
    request,
    eventType: 'iam_mcp_oauth_client_registered',
    userId,
    metadata: {
      client_id: clientId,
      token_endpoint_auth_method: parsed.tokenEndpointAuthMethod,
      redirect_uri_count: normalizedRedirectUris.length,
    },
  });

  const response = {
    client_id: clientId,
    client_id_issued_at: createdAt,
    client_name: parsed.clientName,
    redirect_uris: normalizedRedirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    scope: Array.from(new Set(selectedScopes)).join(' '),
    token_endpoint_auth_method: parsed.tokenEndpointAuthMethod,
  };

  if (parsed.tokenEndpointAuthMethod !== 'none') {
    response.client_secret = issuedClientSecret;
    response.client_secret_expires_at = 0;
  }

  return jsonResponse(response, 201);
}

async function handleMcpOAuthAuthorize(request, env, _ctx) {
  if (!env.DB) return mcpOAuthJsonError('database_not_configured', 503);

  const rl = await checkMcpOAuthRateLimit(env, request, 'authorize', 120);
  if (!rl.ok) return mcpOAuthJsonError(rl.error, 429, { retry_after: rl.retry_after });

  const url = new URL(request.url);
  const authUser = await getAuthUser(request, env);
  if (!authUser) {
    const { createMcpOAuthLoginChallengeFromAuthorizeUrl } = await import('./mcp-oauth-login-challenge.js');
    try {
      const challengeId = await createMcpOAuthLoginChallengeFromAuthorizeUrl(env, url);
      const login = new URL('/auth/login', url.origin);
      login.searchParams.set('flow', 'oauth');
      login.searchParams.set('challenge', challengeId);
      return Response.redirect(login.href, 302);
    } catch (err) {
      console.error('[mcp_oauth_authorize] login challenge store failed:', err?.message || err);
      return mcpOAuthJsonError('oauth_login_challenge_unavailable', 503);
    }
  }

  const responseType = String(url.searchParams.get('response_type') || 'code').toLowerCase();
  const clientId = String(url.searchParams.get('client_id') || '').trim();
  const redirectRaw = String(url.searchParams.get('redirect_uri') || '').trim();
  const state = String(url.searchParams.get('state') || '').trim();
  const codeChallenge = String(url.searchParams.get('code_challenge') || '').trim();
  const codeChallengeMethod = String(url.searchParams.get('code_challenge_method') || 'S256').toUpperCase();

  if (responseType !== 'code') return mcpOAuthJsonError('unsupported_response_type', 400);
  if (!clientId) return mcpOAuthJsonError('invalid_client', 400);
  if (!state) return mcpOAuthJsonError('invalid_state', 400);
  if (!codeChallenge) return mcpOAuthJsonError('missing_code_challenge', 400);
  if (codeChallengeMethod !== 'S256') return mcpOAuthJsonError('unsupported_code_challenge_method', 400);

  const client = await mcpOAuthLoadClient(env, clientId);
  if (!client) {
    const extra =
      /^Ov23/i.test(clientId)
        ? {
            hint:
              'This client_id looks like a GitHub OAuth App ID, not an IAM MCP client. ' +
              'Add connector URL https://mcp.inneranimalmedia.com/mcp only — do not paste a Client ID. ' +
              'Hosts must Dynamic Client Register (iam_dcr_*).',
          }
        : {
            hint:
              'Unknown OAuth client. Point the host at https://mcp.inneranimalmedia.com/mcp and let it ' +
              'DCR via POST /api/oauth/register (iam_dcr_*). Do not hardcode iam_mcp_inneranimalmedia in Cursor.',
          };
    return mcpOAuthJsonError('invalid_client', 400, extra);
  }
  if (Number(client.requires_pkce) === 1 && !codeChallenge) {
    return mcpOAuthJsonError('missing_code_challenge', 400);
  }

  const redirectCheck = mcpOAuthValidateRedirectUri(redirectRaw, client, env);
  if (!redirectCheck.ok) return mcpOAuthJsonError(redirectCheck.error, 400);
  if (!mcpOAuthRedirectAllowed(client, redirectCheck.url.href)) {
    return mcpOAuthJsonError('redirect_uri_not_registered', 400);
  }

  const scope = mcpOAuthNormalizeScope(url.searchParams.get('scope'), client);
  if (!mcpOAuthScopeAllowed(client, scope)) {
    return mcpOAuthJsonError('invalid_scope', 400);
  }

  let resourceRaw = resolveMcpOAuthResourceParam(url.searchParams);
  if (
    !resourceRaw &&
    (clientId === MCP_CANONICAL_CLIENT_ID || String(clientId).startsWith('iam_dcr_'))
  ) {
    resourceRaw = IAM_MCP_RESOURCE_URL;
  }
  const resourceCheck = assertMcpOAuthResourceMatches(resourceRaw);
  if (!resourceCheck.ok) {
    return mcpOAuthJsonError(resourceCheck.error, 400);
  }

  const tenantId = await mcpOAuthResolveTenantId(env, authUser);
  if (!tenantId) return mcpOAuthJsonError('invalid_tenant', 400);

  const workspaceId = await resolveCanonicalWorkspace(env, authUser.id);
  if (!workspaceId) return mcpOAuthJsonError('invalid_workspace', 400);

  // Canonical + DCR clients: resolve host key and enforce registry / revoke.
  // Consent writes agentsam_mcp_oauth_user_client_allowlist; runtime requireGrant=true.
  let externalClientKey = null;
  {
    const { resolveExternalClientKeyFromRedirect, assertUserMayUseExternalClient } = await import(
      '../core/mcp-oauth-external-clients.js'
    );
    externalClientKey = await resolveExternalClientKeyFromRedirect(
      env,
      redirectCheck.url.href,
      MCP_CANONICAL_CLIENT_ID,
    );
    const extAllow = await assertUserMayUseExternalClient(env, {
      userId: authUser.id,
      workspaceId,
      externalClientKey,
      oauthClientId: clientId,
      requireGrant: false,
    });
    if (!extAllow.ok) {
      return mcpOAuthJsonError(extAllow.code || 'external_client_not_allowed', 403);
    }
  }

  const now = mcpOAuthNow();
  const expiresAt = now + MCP_OAUTH_AUTHZ_TTL_SECONDS;
  const authorizationId = `oaa_${crypto.randomUUID().replace(/-/g, '')}`;

  const authMetadata = JSON.stringify({
    resource: resourceCheck.resource,
    audience: resourceCheck.resource,
    ...(externalClientKey ? { external_client_key: externalClientKey } : {}),
  });

  await env.DB.prepare(
    `INSERT INTO oauth_authorizations (
       id, client_id, user_id, tenant_id, workspace_id, redirect_uri, scope, state,
       code_challenge, code_challenge_method, status, expires_at, metadata_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, unixepoch(), unixepoch())`,
  )
    .bind(
      authorizationId,
      clientId,
      authUser.id,
      tenantId,
      workspaceId,
      redirectCheck.url.href,
      scope,
      state,
      codeChallenge,
      codeChallengeMethod,
      expiresAt,
      authMetadata,
    )
    .run();

  await logAuthEvent(env, {
    request,
    eventType: 'iam_mcp_oauth_authorize_pending',
    userId: authUser.id,
    metadata: {
      client_id: clientId,
      authorization_id: authorizationId,
      resource: resourceCheck.resource,
      external_client_key: externalClientKey,
    },
  });

  const consent = new URL('/oauth/mcp/consent', url.origin);
  consent.searchParams.set('authorization_id', authorizationId);
  return Response.redirect(consent.href, 302);
}

async function mcpOAuthValidateAuthorizationCode(env, body) {
  const codeHash = await mcpOAuthSha256Hex(body.code);
  const row = await env.DB.prepare(
    `SELECT code, user_id, tenant_id, client_id, redirect_uri, code_challenge, code_challenge_method,
            scope, expires_at, used
       FROM oauth_authorization_codes
      WHERE code = ?
      LIMIT 1`,
  )
    .bind(codeHash)
    .first();

  if (!row) return { ok: false, error: 'invalid_grant' };
  if (Number(row.used) === 1) return { ok: false, error: 'invalid_grant_consumed' };
  if (Number(row.expires_at || 0) <= mcpOAuthNow()) return { ok: false, error: 'invalid_grant_expired' };

  const expectedRedirect = String(row.redirect_uri || '').trim();
  if (expectedRedirect && expectedRedirect !== body.redirect_uri) {
    return { ok: false, error: 'redirect_uri_mismatch' };
  }

  const expectedChallenge = String(row.code_challenge || '');
  const gotChallenge = await mcpOAuthPkceS256(body.code_verifier);
  if (!expectedChallenge || gotChallenge !== expectedChallenge) {
    return { ok: false, error: 'invalid_code_verifier' };
  }

  const clientId = String(body.client_id || row.client_id || '').trim();
  if (clientId && String(row.client_id) !== clientId) {
    return { ok: false, error: 'invalid_client' };
  }

  return { ok: true, row, codeHash };
}

/** @returns {Promise<Response|null>} */
async function assertMcpOAuthTokenClientAuth(request, body, client, expectedClientId) {
  const tokenAuthMethod = String(client?.token_endpoint_auth_method || 'none').toLowerCase();
  if (tokenAuthMethod === 'client_secret_post') {
    if (!body.client_id || !body.client_secret) return mcpOAuthJsonError('invalid_client', 401);
    const gotSecretHash = await mcpOAuthSha256Hex(body.client_secret);
    if (gotSecretHash !== String(client.client_secret_hash || '')) {
      return mcpOAuthJsonError('invalid_client', 401);
    }
  } else if (tokenAuthMethod === 'client_secret_basic') {
    const basic = readOAuthClientBasicAuth(request);
    const presentedClientId = String(basic.clientId || '').trim();
    const presentedSecret = String(basic.clientSecret || '').trim();
    if (!presentedClientId || !presentedSecret) return mcpOAuthJsonError('invalid_client', 401);
    if (presentedClientId !== String(expectedClientId || '').trim()) {
      return mcpOAuthJsonError('invalid_client', 401);
    }
    const gotSecretHash = await mcpOAuthSha256Hex(presentedSecret);
    if (gotSecretHash !== String(client.client_secret_hash || '')) {
      return mcpOAuthJsonError('invalid_client', 401);
    }
  } else if (tokenAuthMethod === 'none') {
    if (body.client_id && String(body.client_id).trim() !== String(expectedClientId || '').trim()) {
      return mcpOAuthJsonError('invalid_client', 401);
    }
  }
  return null;
}

export { assertMcpOAuthTokenClientAuth };

async function mcpOAuthConsumeAuthorizationCode(env, body) {
  const validated = await mcpOAuthValidateAuthorizationCode(env, body);
  if (!validated.ok) return validated;

  const { row, codeHash } = validated;
  const consumed = await env.DB.prepare(
    `UPDATE oauth_authorization_codes SET used = 1 WHERE code = ? AND used = 0`,
  )
    .bind(codeHash)
    .run();

  if (!consumed?.meta?.changes) {
    return { ok: false, error: 'invalid_grant_consumed' };
  }

  return { ok: true, row, codeHash };
}

export { mcpOAuthValidateAuthorizationCode };

async function handleMcpOAuthToken(request, env, ctx) {
  const { dispatchMcpOAuthTokenRequest } = await import('./mcp-oauth-token-grants.js');
  return dispatchMcpOAuthTokenRequest(request, env, ctx);
}

async function handleMcpOAuthUserinfo(request, env, _ctx) {
  if (!env.DB) return mcpOAuthJsonError('database_not_configured', 503);

  const auth = String(request.headers.get('Authorization') || '');
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return mcpOAuthJsonError('missing_bearer_token', 401);

  const token = m[1].trim();
  const tokenHash = await mcpOAuthSha256Hex(token);
  const now = mcpOAuthNow();

  const row = await env.DB.prepare(
    `SELECT
        t.id AS token_id,
        t.workspace_id,
        t.tenant_id,
        t.user_id,
        t.scopes_json,
        t.expires_at,
        t.is_active,
        u.email AS email,
        u.name AS name,
        u.person_uuid AS person_uuid
       FROM mcp_workspace_tokens t
       LEFT JOIN auth_users u ON u.id = t.user_id
      WHERE t.token_hash = ?
        AND t.is_active = 1
        AND (t.revoked_at IS NULL OR t.revoked_at = 0)
      LIMIT 1`,
  )
    .bind(tokenHash)
    .first();

  if (!row) return mcpOAuthJsonError('invalid_token', 401);
  if (row.expires_at && Number(row.expires_at) <= now) {
    return mcpOAuthJsonError('token_expired', 401);
  }

  await env.DB.prepare(
    `UPDATE mcp_workspace_tokens
        SET last_used_at = unixepoch()
      WHERE id = ?`,
  )
    .bind(row.token_id)
    .run()
    .catch(() => {});

  let scopes = [];
  try {
    scopes = JSON.parse(row.scopes_json || '[]');
  } catch {
    scopes = [];
  }

  return jsonResponse({
    sub: row.user_id,
    user_id: row.user_id,
    email: row.email || null,
    name: row.name || null,
    tenant_id: row.tenant_id,
    workspace_id: row.workspace_id,
    person_uuid: row.person_uuid || null,
    scopes,
  });
}

export async function handleIamOAuthWellKnown(request, env) {
  const url = new URL(request.url);
  const pathLower = url.pathname.toLowerCase().replace(/\/$/, '');
  if (pathLower === '/.well-known/oauth-authorization-server') {
    return jsonResponse(iamMcpOAuthAuthorizationServerMetadata());
  }
  if (pathLower === '/.well-known/openid-configuration') {
    return jsonResponse(iamMcpOpenIdConfiguration());
  }
  if (pathLower === '/.well-known/jwks.json') {
    return iamOidcJwksResponse(env);
  }
  return null;
}

export async function handleOAuthApi(request, env, ctx) {
  const url = new URL(request.url);
  const pathLower = url.pathname.toLowerCase().replace(/\/$/, '');
  const method = request.method.toUpperCase();

  if (pathLower === '/api/oauth/authorize' && method === 'GET') {
    return handleMcpOAuthAuthorize(request, env, ctx);
  }
  if (pathLower === '/api/oauth/login-challenge/resume' && method === 'GET') {
    const { handleMcpOAuthLoginChallengeResume } = await import('./mcp-oauth-login-challenge.js');
    return handleMcpOAuthLoginChallengeResume(request, env);
  }
  if (pathLower === '/api/oauth/token' && method === 'POST') {
    return handleMcpOAuthToken(request, env, ctx);
  }
  if (pathLower === '/api/oauth/register' && method === 'POST') {
    return handleMcpOAuthRegister(request, env, ctx);
  }
  if (pathLower === '/api/oauth/userinfo' && method === 'GET') {
    return handleMcpOAuthUserinfo(request, env, ctx);
  }

  // Identity OAuth path -- user-to-app auth (customer apps registering for
  // "Sign in with Inner Animal Media"), distinct from the MCP DCR routes above.
  // Delegates to backend/identity/identity-oauth-provider.js (worker-composition
  // -> backend, allowed by dependency-law); never share code paths with the MCP
  // routes above -- different scope namespace, different token table.
  if (pathLower === '/api/oauth/identity/register' && method === 'POST') {
    const { registerIdentityClient } = await import('../../backend/identity/identity-oauth-provider.js');
    const authUser = await getAuthUser(request, env).catch(() => null);
    return registerIdentityClient(request, env, authUser);
  }
  if (pathLower === '/api/oauth/identity/authorize' && method === 'GET') {
    const { identityAuthorize } = await import('../../backend/identity/identity-oauth-provider.js');
    const authUser = await getAuthUser(request, env).catch(() => null);
    return identityAuthorize(request, env, authUser);
  }
  if (pathLower === '/api/oauth/identity/consent' && (method === 'GET' || method === 'POST')) {
    const { handleIdentityOAuthConsentPage } = await import('./identity-oauth-consent.js');
    return handleIdentityOAuthConsentPage(request, env);
  }
  if (pathLower === '/api/oauth/identity/token' && method === 'POST') {
    const { identityToken } = await import('../../backend/identity/identity-oauth-provider.js');
    return identityToken(request, env);
  }
  if (pathLower === '/api/oauth/identity/userinfo' && method === 'GET') {
    const { identityUserinfo } = await import('../../backend/identity/identity-oauth-provider.js');
    return identityUserinfo(request, env);
  }

  if (pathLower === '/api/oauth/gmail/start' && method === 'GET') {
    const returnTo = url.searchParams.get('return_to') || '/dashboard/mail';
    const target = new URL(`${url.origin}/api/integrations/gmail/connect`);
    target.searchParams.set('return_to', returnTo);
    if (url.searchParams.get('popup') === '1') target.searchParams.set('popup', '1');
    return Response.redirect(target.toString(), 302);
  }
  if (pathLower === '/api/oauth/google-calendar/callback' && method === 'GET') {
    const { handleGoogleCalendarConnectCallback } = await import('./integrations/google-calendar-connect.js');
    return handleGoogleCalendarConnectCallback(request, url, env, ctx);
  }

  if (pathLower === '/api/oauth/gmail/callback' && method === 'GET') {
    const { handleGmailConnectCallback } = await import('./integrations/gmail-connect.js');
    return handleGmailConnectCallback(request, url, env);
  }

  if (pathLower === '/api/oauth/stripe/start' && method === 'GET') {
    const { handleStripeOAuthStart } = await import('./oauth/stripe.js');
    return handleStripeOAuthStart(request, env);
  }
  if (pathLower === '/api/oauth/stripe/callback' && method === 'GET') {
    const { handleStripeOAuthCallback } = await import('./oauth/stripe.js');
    return handleStripeOAuthCallback(request, env);
  }

  const startMatch = pathLower.match(/^\/api\/oauth\/([^/]+)\/start$/);
  const cbMatch = pathLower.match(/^\/api\/oauth\/([^/]+)\/callback$/);
  const apiKeyMatch = pathLower.match(/^\/api\/oauth\/apikey\/([^/]+)$/);

  if (!startMatch && !cbMatch && !apiKeyMatch) return jsonResponse({ error: 'not_found' }, 404);

  if (apiKeyMatch) {
    const provider = normalizeProvider(apiKeyMatch[1]);
    if (method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
    if (!APIKEY_PROVIDERS.has(provider)) return jsonResponse({ error: 'unsupported_provider' }, 400);
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const body = await request.json().catch(() => ({}));
    const apiKey = String(body.api_key || '');
    const v = await validateApiKey(provider, apiKey);
    if (!v.ok) return jsonResponse({ success: false, provider, error: v.error || 'Invalid API key — check and retry' }, 400);

    await storeApiKeyAsOauth(env, authUser, provider, apiKey);
    try {
      ctx?.waitUntil?.(
        syncProviderModels(env, provider, apiKey, {
          tenantId: authUser.tenant_id || env.TENANT_ID,
          createdBy: authUser.id || authUser.email || 'apikey_sync',
        }),
      );
    } catch (_) { /* non-fatal */ }
    return jsonResponse({ success: true, provider, account_display: 'API key validated' });
  }

  if (startMatch) {
    const provider = normalizeProvider(startMatch[1]);
    if (method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
    if (!PROVIDERS.has(provider)) return jsonResponse({ error: 'unsupported_provider' }, 400);

    const authUser = await getAuthUser(request, env);
    // Login/sign-up OAuth: always use login handlers for app/dashboard/auth return_to even when a stale
    // session cookie exists — otherwise Google tokens attach to the wrong user_id (integration path).
    if (provider === 'google' && (isGoogleLoginOAuthStart(url) || !authUser)) {
      return loginGoogleOAuthStart(request, url, env);
    }
    if (provider === 'github' && (isGitHubLoginOAuthStart(url) || !authUser)) {
      return loginGitHubOAuthStart(request, url, env);
    }
    // Dashboard Cloudflare OAuth requires a session; browser navigations get a login redirect
    // instead of a bare 401 JSON so the marketing auth page can show a clear path.
    if (!authUser && provider === 'cloudflare') {
      const accept = (request.headers.get('Accept') || '').toLowerCase();
      if (accept.includes('text/html')) {
        const returnTo = safeReturnTo(url.searchParams.get('return_to'));
        const next = encodeURIComponent(returnTo);
        return Response.redirect(
          `${url.origin}/auth/login?next=${next}&cf_connect=1`,
          302,
        );
      }
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    if (!authUser && provider === 'supabase') {
      return jsonResponse(
        { error: 'Authentication required to connect Supabase Management integration.' },
        401,
      );
    }
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const userId =
      (await resolveIntegrationUserId(env, authUser)) || integrationUserId(authUser);
    const tenantId = authUser?.tenant_id || '';
    const personUuid = authUser?.person_uuid || '';

    const state = crypto.randomUUID();
    const returnTo = safeReturnTo(url.searchParams.get('return_to'));
    const workspace_id = await resolveCanonicalWorkspace(env, userId);
    if (!workspace_id) {
      return jsonResponse({ error: 'invalid_workspace' }, 400);
    }
    const redirectUriMgmt = provider === 'supabase' ? supabaseManagementOAuthRedirectUri(request, env) : null;
    await kvPutIntegrationOAuthState(env, provider, state, {
      user_id: userId,
      tenant_id: tenantId,
      person_uuid: personUuid,
      provider,
      initiated_at: Date.now(),
      return_to: returnTo,
      workspace_id,
      redirect_uri: redirectUriMgmt,
      popup: url.searchParams.get('popup') === '1',
    });

    const oauthScopes = url.searchParams.get('oauth_scopes');

    let redirectUrl = null;
    if (provider === 'github') redirectUrl = githubAuthUrl(env, state, oauthScopes);
    if (provider === 'google') redirectUrl = googleAuthUrl(env, state, oauthScopes);
    if (provider === 'cloudflare') redirectUrl = cloudflareAuthUrl(env, state, oauthScopes);
    if (provider === 'supabase') redirectUrl = supabaseAuthUrl(env, request, state, oauthScopes, redirectUriMgmt);

    if (!redirectUrl) {
      return jsonResponse({
        error: `${provider}_oauth_not_configured`,
        setup: `Set Worker secrets, then retry.`,
      }, 503);
    }
    return Response.redirect(redirectUrl, 302);
  }

  if (cbMatch) {
    const provider = normalizeProvider(cbMatch[1]);
    if (method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
    if (!PROVIDERS.has(provider)) return jsonResponse({ error: 'unsupported_provider' }, 400);

    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    const oauthError = url.searchParams.get('error') || '';
    const oauthErrorDesc = url.searchParams.get('error_description') || '';
    const origin = new URL(request.url).origin;
    const integrationsReturn = `${origin}/dashboard/settings/integrations`;
    if (oauthError) {
      const detail = oauthErrorDesc || oauthError;
      console.warn('[oauth_callback] provider error', {
        provider,
        error: oauthError,
        detail: detail.slice(0, 240),
      });
      return Response.redirect(
        `${integrationsReturn}?error=${encodeURIComponent(oauthError)}&detail=${encodeURIComponent(detail.slice(0, 300))}`,
        302,
      );
    }
    if (!state || !code) {
      if (provider === 'google' || provider === 'github') {
        return Response.redirect(`${origin}/auth/login?error=missing`, 302);
      }
      return Response.redirect(`${integrationsReturn}?error=missing_params`, 302);
    }

    // GitHub: login flow uses oauth_state_github_* — must run before integration (oauth_state_*).
    if (provider === 'github') {
      const rawGh = await env.SESSION_CACHE.get(`oauth_state_github_${state}`);
      if (rawGh) {
        await env.SESSION_CACHE.delete(`oauth_state_github_${state}`);
        return handleGitHubLoginOAuthCallback(request, url, env, { cachedRedirect: rawGh });
      }
    }

    /** @type {object | null} */
    let stored = null;

    // Google: integration KV payload has user_id; login payload has redirectUri (same key prefix oauth_state_*).
    if (provider === 'google') {
      const raw = await env.SESSION_CACHE.get(oauthStateKey(state));
      if (!raw) return new Response(null, { status: 404 });
      try {
        const p = JSON.parse(raw);
        if (p && p.user_id) stored = p;
      } catch (_) {
        /* non-JSON legacy string — login path */
      }
      if (!stored) {
        await env.SESSION_CACHE.delete(oauthStateKey(state));
        return handleGoogleLoginOAuthCallback(request, url, env, { cachedRedirect: raw });
      }
    }

    if (!stored) {
      stored = await kvGetIntegrationOAuthState(env, provider, state);
    }
    if (!stored) {
      if (provider === 'supabase') {
        return Response.redirect(`${origin}/dashboard/settings/integrations?error=oauth_state`, 302);
      }
      // State already consumed (refresh of callback URL) — send them home, not opaque 404 JSON.
      if (provider === 'github' || provider === 'google' || provider === 'cloudflare') {
        return Response.redirect(
          `${origin}/dashboard/agent?error=oauth_state&provider=${encodeURIComponent(provider)}`,
          302,
        );
      }
      return new Response(null, { status: 404 });
    }

    const userId =
      (await resolveIntegrationUserId(env, { id: stored.user_id })) ||
      String(stored.user_id || '').trim();
    const tenantId = stored.tenant_id || '';
    const personUuid = stored.person_uuid || '';
    const oauthWorkspaceId = String(stored.workspace_id || '').trim() || null;
    const returnTo = safeReturnTo(stored.return_to);

    try {
      if (provider === 'github') {
        const tok = await exchangeGithub(env, code);
        const acct = await githubAccount(tok.access_token);
        await upsertOauthToken(env, {
          user_id: userId,
          tenant_id: tenantId,
          person_uuid: personUuid,
          provider: 'github',
          access_token: tok.access_token,
          refresh_token: null,
          scope: tok.scope || null,
          expires_at: null,
          account_identifier: acct.login || acct.email || userId,
          account_email: acct.email,
          account_display: acct.login ? `github.com/${acct.login}` : null,
        });
      } else if (provider === 'google') {
        const tok = await exchangeGoogle(env, code);
        const info = await googleUserinfo(tok.access_token);
        await upsertOauthToken(env, {
          user_id: userId,
          tenant_id: tenantId,
          person_uuid: personUuid,
          provider: 'google_drive',
          access_token: tok.access_token,
          refresh_token: tok.refresh_token || null,
          scope: tok.scope || null,
          expires_at: tok.expires_in ? nowSeconds() + Number(tok.expires_in) : null,
          account_identifier: '',
          account_email: info.email || null,
          account_display: info.email || null,
        });
      } else if (provider === 'cloudflare') {
        const tok = await exchangeCloudflare(env, code);
        const { resolveCfAccountFromAccessToken } = await import('../core/cf-token-account.js');
        const { persistUserCfStackSettings } = await import('../core/account-cloudflare-context.js');
        let cfAccount = null;
        try {
          cfAccount = await resolveCfAccountFromAccessToken(tok.access_token);
        } catch (e) {
          console.warn('[cloudflare_oauth] /v4/accounts resolution failed', e?.message || e);
        }
        const { looksLikeCfAccountId } = await import('../core/cf-token-account.js');
        const rawId = cfAccount?.id != null ? String(cfAccount.id).trim() : '';
        const accountId = looksLikeCfAccountId(rawId) ? rawId : null;
        const accountName = cfAccount?.name != null ? String(cfAccount.name).trim() : null;
        // Never persist CF display name as account_identifier (must be 32-char hex or placeholder).
        await upsertOauthToken(env, {
          user_id: userId,
          tenant_id: tenantId,
          person_uuid: personUuid,
          provider: 'cloudflare',
          access_token: tok.access_token,
          refresh_token: tok.refresh_token || null,
          scope: tok.scope || null,
          expires_at: tok.expires_in ? nowSeconds() + Number(tok.expires_in) : null,
          account_identifier: accountId || `cf_oauth_${userId}`,
          account_email: null,
          account_display: accountName || (accountId ? 'Cloudflare account' : null),
          metadata_json: accountId
            ? JSON.stringify({ cloudflare_account_id: accountId })
            : null,
        });
        if (accountId) {
          try {
            await persistUserCfStackSettings(env, userId, { cf_account_id: accountId });
          } catch (e) {
            console.warn('[cloudflare_oauth] cf_stack persist failed', e?.message || e);
          }
        } else {
          console.warn(
            '[cloudflare_oauth] no valid CF account hex id after /v4/accounts; stored placeholder identifier',
            { user_id: userId },
          );
        }
      } else if (provider === 'supabase') {
        const mgmtCreds = getSupabaseManagementOAuthCredentials(env);
        const redirectUriTok =
          typeof stored.redirect_uri === 'string' && stored.redirect_uri.trim()
            ? stored.redirect_uri.trim()
            : supabaseManagementOAuthRedirectUri(request, env);
        console.log(
          `[supabase_management_oauth] ${JSON.stringify({
            phase: 'callback_token_exchange',
            provider: 'supabase_management_api',
            callback_path: url.pathname,
            redirect_uri: redirectUriTok,
            client_id_tail: oauthClientIdTail(mgmtCreds?.clientId),
            next_redirect: returnTo,
          })}`,
        );
        const tok = await exchangeSupabase(env, code, redirectUriTok);
        const supabaseAcct = supabaseOAuthAccountIdentifier(oauthWorkspaceId);
        let metadata_json = null;
        try {
          const projects = await fetchSupabaseManagementProjects(tok.access_token);
          metadata_json = JSON.stringify({
            projects,
            workspace_id: oauthWorkspaceId,
          });
        } catch {
          metadata_json = JSON.stringify({ projects: [], workspace_id: oauthWorkspaceId });
        }
        await upsertOauthToken(env, {
          user_id: userId,
          tenant_id: tenantId,
          person_uuid: personUuid,
          provider: 'supabase_management',
          access_token: tok.access_token,
          refresh_token: tok.refresh_token || null,
          scope: tok.scope || null,
          expires_at: tok.expires_in ? nowSeconds() + Number(tok.expires_in) : null,
          account_identifier: supabaseAcct,
          account_email: null,
          account_display: 'Supabase',
          workspace_id: oauthWorkspaceId,
          metadata_json,
        });
      }
    } catch (e) {
      await kvDeleteIntegrationOAuthState(env, provider, state);
      const msg = e?.message || 'oauth_failed';
      const absReturnErr = returnTo.startsWith('http') ? returnTo : new URL(request.url).origin + returnTo;
      if (integrationOAuthShouldPopup(stored, absReturnErr)) {
        return new Response(
          oauthPopupCompleteHtml(provider, { error: msg, returnTo: absReturnErr }),
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      }
      const _origin = new URL(request.url).origin;
      const _abs638 = returnTo.startsWith('http') ? returnTo : _origin + returnTo;
      return Response.redirect(appendOAuthReturnParams(_abs638, { error: msg }), 302);
    }

    await kvDeleteIntegrationOAuthState(env, provider, state);
    const absReturn = returnTo.startsWith('http') ? returnTo : new URL(request.url).origin + returnTo;
    if (integrationOAuthShouldPopup(stored, absReturn)) {
      return new Response(oauthPopupCompleteHtml(provider, { returnTo: absReturn }), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return Response.redirect(
      appendOAuthReturnParams(absReturn, { connected: provider, success: 'true' }),
      302,
    );
  }

  return jsonResponse({ error: 'not_found' }, 404);
}

export {
  getOAuthToken,
  getUserSupabaseToken,
  refreshGoogleToken,
  resolveOAuthAccessToken,
  resolveOAuthRefreshToken,
  supabaseOAuthAccountIdentifier,
} from '../../backend/identity/oauth/user-token.js';

