/**
 * Auth API Service
 * Handles login, logout, and backup-code verification.
 */
import { jsonResponse } from '../core/responses.js';
import { resolveTenantAtLogin, getAuthUser, getSession, resolveUserEnrichment, createLoginSession, revokeAuthSession, resolveSessionIdFromCookieValue } from '../../backend/identity/index.js';
import { AUTH_COOKIE_NAME, AUTH_LOGIN_PATH, DASHBOARD_AFTER_LOGIN_PATH, DEFAULT_AGENT_SESSION_TTL_SECONDS, MIN_AGENT_SESSION_TTL_SECONDS, MAX_AGENT_SESSION_TTL_SECONDS } from '../../backend/auth/constants.js';
import { sanitizeBrowserNextPath } from '../../backend/http/auth/browser-paths.js';
import { appendBrowserLoginSessionCookies, formatSessionCookieHeader, normalizeLoginSessionResult } from '../../backend/auth/session-cookies.js';
import { verifyPassword, hashPassword } from '../../backend/auth/password-crypto.js';
import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';

import { ensureIdentityPlaneBeforeSession } from '../../backend/identity/ensure-identity-plane.js';
import { createIamPasswordResetServiceForEnv as createIamPasswordResetService } from '../../backend/identity/password-reset-env.js';
import { ensureAppUser } from '../../backend/identity/ensure-app-user.js';
import { logAuthEvent } from '../../backend/identity/auth-events.js';
import {
  finalizeInboundOAuth,
} from './oauth-login-callbacks.js';
import { upsertOauthToken, resolveCanonicalWorkspace } from './oauth.js';
import {
  sendSignupVerificationEmail,
  signupEmailVerificationEnabled,
  userNeedsSignupEmailVerification,
} from '../core/auth-email-verify.js';
import { isVaultConfigured } from '../../backend/credentials/vault-key-material.js';
import {
  requestIdentityRecoveryEmail,
  verifyIdentityRecoveryCode,
  buildAuthRecoveryPayload,
} from '../../backend/identity/recovery.js';
import { resolveAuthUserByEmail, resolveAuthUserLookup } from '../../backend/identity/users/index.js';

/**
 * Primary Auth Dispatcher
 */
export async function handleAuthApi(request, url, env) {
  const path = url.pathname.toLowerCase();
  const method = request.method.toUpperCase();

  if (path === '/api/auth/agent-session/mint' && method === 'POST') {
    return handleAgentSessionMint(request, env);
  }

  if (path === '/api/auth/login' && method === 'POST') {
    return handleEmailPasswordLogin(request, url, env);
  }
  if (path === '/api/auth/signup' && method === 'POST') {
    return handleEmailSignup(request, url, env);
  }
  if (path === '/api/auth/verify-email' && method === 'GET') {
    return handleEmailVerification(request, url, env);
  }
  if (path === '/api/auth/resend-verification' && method === 'POST') {
    return handleResendVerification(request, env);
  }
  if (path === '/api/auth/session' && method === 'GET') {
    const session = await getSession(env, request);
    if (!session) return jsonResponse({ valid: false }, 200);
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ valid: false }, 200);
    return jsonResponse({
      valid: true,
      expires_at: session.expires_at ?? null,
      user: { id: authUser.id ?? null, email: authUser.email ?? null },
    });
  }
  if (path === '/api/auth/recovery/request' && method === 'POST') {
    return handleIdentityRecoveryRequest(request, env);
  }
  if (path === '/api/auth/recovery/verify' && method === 'POST') {
    return handleIdentityRecoveryVerify(request, url, env);
  }
  if (path === '/api/auth/backup-code' && method === 'POST') {
    return handleBackupCodeLogin(request, url, env);
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    return handleLogout(request, url, env);
  }
  if (
    (path === '/api/auth/password-reset/request'
      || path === '/api/auth/reset/request'
      || path === '/api/auth/forgot-password')
    && method === 'POST'
  ) {
    return handlePasswordResetRequest(request, env);
  }
  if (
    (path === '/api/auth/password-reset/confirm'
      || path === '/api/auth/reset/confirm')
    && method === 'POST'
  ) {
    return handlePasswordResetConfirm(request, env);
  }
  if (path === '/api/settings/profile' && method === 'GET') {
    return handleSettingsProfileRequest(request, env);
  }
  if (path === '/api/auth/password-change' && method === 'POST') {
    return handlePasswordChange(request, env);
  }
  if (path === '/api/auth/email-change/request' && method === 'POST') {
    return handleEmailChangeRequest(request, env);
  }
  if (path === '/api/auth/identities' && method === 'GET') {
    return handleAuthIdentities(request, env);
  }

  return jsonResponse({ error: 'Auth route not found' }, 404);
}

/**
 * POST /api/auth/agent-session/mint
 * Auth: AGENTSAM_BRIDGE_KEY (Bearer, X-Internal-Secret, X-IAM-Service-Key, etc.).
 * Body: { user_id?, user_email?, workspace_id?, ttl_seconds? } — or rely on env AGENT_SESSION_DEFAULT_USER_ID.
 * Caller user must be workspace owner (workspace_members.role = 'owner').
 * Returns a short-lived session id (same as browser `session` cookie value).
 */
async function isWorkspaceOwner(env, workspaceId, userId) {
  if (!env?.DB || !workspaceId || !userId) return false;
  const row = await env.DB.prepare(
    `SELECT role FROM workspace_members
     WHERE workspace_id = ? AND user_id = ? AND COALESCE(is_active, 1) = 1
     LIMIT 1`,
  )
    .bind(String(workspaceId).trim(), String(userId).trim())
    .first()
    .catch(() => null);
  return String(row?.role || '') === 'owner';
}

async function handleAgentSessionMint(request, env) {
  if (!env?.DB) return jsonResponse({ error: 'Database not configured' }, 503);
  if (!env.AGENTSAM_BRIDGE_KEY || String(env.AGENTSAM_BRIDGE_KEY).trim() === '') {
    return jsonResponse({ error: 'Agent session mint is not configured' }, 503);
  }
  if (!verifyBridgeKey(request, env)) {
    await logAuthEvent(env, {
      request,
      eventType: 'auth_agent_session_mint_denied',
      status: 'fail',
      metadata: { reason: 'bad_bridge_key' },
    });
    return jsonResponse({ error: 'Unauthorized', code: 'BRIDGE_KEY_INVALID' }, 401);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const ttlRaw = body.ttl_seconds ?? body.ttlSeconds;
  let ttlSeconds = DEFAULT_AGENT_SESSION_TTL_SECONDS;
  if (ttlRaw != null && ttlRaw !== '') {
    const n = Number(ttlRaw);
    if (Number.isFinite(n)) {
      ttlSeconds = Math.min(MAX_AGENT_SESSION_TTL_SECONDS, Math.max(MIN_AGENT_SESSION_TTL_SECONDS, n));
    }
  }

  let userId = String(body.user_id || body.userId || '').trim();
  const email = String(body.user_email || body.userEmail || '')
    .trim()
    .toLowerCase();
  if (!userId && email && env.DB) {
    const row = await resolveAuthUserByEmail(env, email);
    if (row?.id) userId = String(row.id);
  }
  if (!userId) {
    const def = String(env.AGENT_SESSION_DEFAULT_USER_ID || '').trim();
    if (def) userId = def;
  }
  if (!userId) {
    return jsonResponse(
      { error: 'user_id, user_email, or AGENT_SESSION_DEFAULT_USER_ID binding is required' },
      400,
    );
  }

  const workspaceId = String(body.workspace_id || body.workspaceId || env.WORKSPACE_ID || '').trim();
  if (!workspaceId) {
    return jsonResponse({ error: 'workspace_id is required' }, 400);
  }

  const userCheck = await env.DB.prepare(`SELECT id, email FROM auth_users WHERE id = ? LIMIT 1`)
    .bind(userId)
    .first()
    .catch(() => null);
  if (!userCheck) {
    return jsonResponse({ error: 'user not found' }, 404);
  }

  const userEmail = String(userCheck.email || '').trim().toLowerCase();
  if (userEmail === 'ai@inneranimalmedia.com') {
    ttlSeconds = Math.min(ttlSeconds, DEFAULT_AGENT_SESSION_TTL_SECONDS);
  }

  const ownerOk = await isWorkspaceOwner(env, workspaceId, userId);
  if (!ownerOk) {
    await logAuthEvent(env, {
      request,
      eventType: 'auth_agent_session_mint_denied',
      status: 'fail',
      userId,
      metadata: { reason: 'not_workspace_owner', workspace_id: workspaceId, user_id: userId },
    });
    return jsonResponse({
      error: 'Unauthorized',
      code: 'NOT_WORKSPACE_OWNER',
      workspace_id: workspaceId,
      user_id: userId,
    }, 401);
  }

  try {
    const loginSession = await createLoginSession(request, env, userId, 'agent_mint', { ttlSeconds });
    const { sessionId, sessionToken } = normalizeLoginSessionResult(loginSession);
    const tenantId =
      String(body.tenant_id || body.tenantId || '').trim() ||
      (await resolveTenantAtLogin(env, userId).catch(() => null)) ||
      null;
    const wsForSession = await resolveCanonicalWorkspace(env, userId);
    try {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO work_sessions (
          session_id, user_id, tenant_id, workspace_id,
          started_at, last_activity_at, page_context
        ) VALUES (?, ?, ?, ?, unixepoch(), unixepoch(), ?)
      `).bind(
        sessionId,
        userId,
        tenantId ?? null,
        wsForSession ?? null,
        'agent_mint',
      ).run();
      await env.DB.prepare(`
        INSERT INTO time_entries (
          user_id, tenant_id, workspace_id,
          description, hours, source,
          work_session_id, started_at, ended_at, billable
        ) VALUES (?, ?, ?, ?, ?, 'auto', ?, unixepoch(), unixepoch(), 0)
      `).bind(
        userId,
        tenantId ?? null,
        wsForSession ?? null,
        'Agent session — admin invoked',
        0,
        sessionId,
      ).run();
    } catch (e) {
      console.warn('[work_session] create failed (non-fatal):', e?.message);
    }
    const expiresAtMs = Date.now() + ttlSeconds * 1000;
    await logAuthEvent(env, {
      request,
      eventType: 'auth_agent_session_minted',
      status: 'ok',
      userId,
      metadata: {
        ttl_seconds: ttlSeconds,
        user_id: userId,
        workspace_id: workspaceId,
        target_email: userEmail || null,
      },
    });
    return jsonResponse({
      ok: true,
      session_id: sessionId,
      cookie_name: AUTH_COOKIE_NAME,
      cookie_header: formatSessionCookieHeader(sessionToken, ttlSeconds),
      ttl_seconds: ttlSeconds,
      expires_at: new Date(expiresAtMs).toISOString(),
    });
  } catch (e) {
    await logAuthEvent(env, {
      request,
      eventType: 'auth_agent_session_mint_denied',
      status: 'fail',
      userId,
      metadata: {
        reason: 'mint_failed',
        workspace_id: workspaceId,
        error: String(e?.message || e).slice(0, 200),
      },
    });
    console.warn('[agent-session/mint]', e?.message ?? e);
    return jsonResponse({ error: e?.message || 'mint_failed' }, 500);
  }
}

/**
 * POST /api/auth/login
 */
async function handleEmailPasswordLogin(request, url, env) {
  const accept = request.headers.get('Accept') || '';
  const contentType = request.headers.get('Content-Type') || '';
  const wantsJson = accept.includes('application/json') || contentType.includes('application/json');

  if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 500);

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const email = (body.email || '').toString().toLowerCase().trim();
  const password = (body.password || '').toString();

  if (!email || !password) {
    return jsonResponse({ error: 'Email and password required' }, 400);
  }

  const user = await resolveAuthUserLookup(env, email);

  if (!user || !user.password_hash || !user.salt) {
    return jsonResponse({
      error: 'Invalid email or password',
      ...buildAuthRecoveryPayload('invalid_credentials'),
    }, 401);
  }

  if (user.password_hash === 'oauth') {
    return jsonResponse({ error: 'This account uses OAuth. Please sign in with Google or GitHub.' }, 400);
  }

  const ok = await verifyPassword(password, user.salt, user.password_hash);
  if (!ok) {
    await logAuthEvent(env, {
      request,
      eventType: 'auth_login_failed',
      userId: user.id,
      status: 'fail',
      provider: 'email',
      metadata: { reason: 'bad_password' },
    });
    return jsonResponse({ error: 'Invalid email or password' }, 401);
  }

  const identityOk = await ensureIdentityPlaneBeforeSession(env, request, {
    authUserId: user.id,
    email,
    name: user.name || email.split('@')[0],
    source: 'email',
    provider: 'email',
    providerSubject: email,
  });
  if (!identityOk?.ok) {
    return jsonResponse({ error: 'Account provisioning failed', reason: identityOk?.reason }, 503);
  }

  return finishLogin(request, url, env, user.id, body.next);
}

/**
 * POST /api/auth/recovery/request — Resend 6-digit code (rate-limited, D1 audit).
 */
async function handleIdentityRecoveryRequest(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body', ...buildAuthRecoveryPayload('default') }, 400);
  }
  const result = await requestIdentityRecoveryEmail(env, request, body);
  return jsonResponse(result.body, result.status);
}

/**
 * POST /api/auth/recovery/verify — verify email code; optional browser session mint.
 */
async function handleIdentityRecoveryVerify(request, url, env) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body', ...buildAuthRecoveryPayload('invalid_credentials') }, 400);
  }
  const result = await verifyIdentityRecoveryCode(env, request, body);
  if (!result.ok) {
    return jsonResponse(result.body, result.status);
  }
  if (body?.create_session !== true || !result.user?.id) {
    return jsonResponse(result.body, result.status);
  }

  const identityOk = await ensureIdentityPlaneBeforeSession(env, request, {
    authUserId: result.user.id,
    email: result.user.email,
    name: result.user.name,
    source: 'identity_recovery',
    provider: 'email_code',
    providerSubject: result.user.email,
  });
  if (!identityOk?.ok) {
    return jsonResponse({
      error: 'Account provisioning failed',
      reason: identityOk?.reason,
      ...buildAuthRecoveryPayload('invalid_workspace'),
    }, 503);
  }

  const loginSession = await createLoginSession(request, env, result.user.id, 'identity_recovery');
  return redirectWithLoginSession(request, loginSession);
}

/**
 * POST /api/auth/backup-code
 */
async function handleBackupCodeLogin(request, _url, env) {
  if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 500);

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const email = (body.email || '').toString().toLowerCase().trim();
  const code = (body.code || '').toString().replace(/\s/g, '');

  if (!email || !code) {
    return jsonResponse({ error: 'Email and backup code required' }, 400);
  }

  const rawNext = String(body.next || body.return_to || '').trim();
  const nextPath = rawNext ? sanitizeBrowserNextPath(rawNext) : null;

  const authUserRow = await resolveAuthUserLookup(env, email);

  if (!authUserRow) {
    return jsonResponse({
      error: 'Invalid credentials',
      ...buildAuthRecoveryPayload('invalid_credentials'),
    }, 401);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, code_hash FROM user_backup_codes WHERE user_id = ? AND used_at IS NULL`,
  )
    .bind(authUserRow.id)
    .all();

  const rows = Array.isArray(results) ? results : [];

  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  const codeHash = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  let matchedId = null;
  for (const r of rows) {
    if (r.code_hash === codeHash) {
      matchedId = r.id;
      break;
    }
  }

  if (!matchedId) {
    return jsonResponse({ error: 'Invalid backup code', ...buildAuthRecoveryPayload('invalid_credentials') }, 401);
  }

  const consumed = await env.DB.prepare(
    `UPDATE user_backup_codes SET used_at = unixepoch() WHERE id = ? AND used_at IS NULL`,
  )
    .bind(matchedId)
    .run();
  if (!consumed?.meta?.changes) {
    return jsonResponse({ error: 'Invalid backup code', ...buildAuthRecoveryPayload('invalid_credentials') }, 401);
  }

  const fullUser = await env.DB.prepare(`SELECT email, name FROM auth_users WHERE id = ? LIMIT 1`)
    .bind(authUserRow.id)
    .first();
  const identityOk = await ensureIdentityPlaneBeforeSession(env, request, {
    authUserId: authUserRow.id,
    email: fullUser?.email || email,
    name: fullUser?.name,
    source: 'backup_code',
    provider: 'backup_code',
    providerSubject: email,
  });
  if (!identityOk?.ok) {
    return jsonResponse({ error: 'Account provisioning failed', reason: identityOk?.reason }, 503);
  }

  const loginSession = await createLoginSession(request, env, authUserRow.id, 'backup_code');
  const { sessionId } = normalizeLoginSessionResult(loginSession);
  const tenantId = await resolveTenantAtLogin(env, authUserRow.id).catch(() => null);
  try {
    const wsForSession = await resolveCanonicalWorkspace(env, authUserRow.id);
    await env.DB.prepare(`
      INSERT OR IGNORE INTO work_sessions (
        session_id, user_id, tenant_id, workspace_id,
        started_at, last_activity_at, page_context
      ) VALUES (?, ?, ?, ?, unixepoch(), unixepoch(), ?)
    `).bind(
      sessionId,
      authUserRow.id,
      tenantId ?? null,
      wsForSession ?? null,
      request.url ? new URL(request.url).pathname : '/api/auth/login',
    ).run();
  } catch (e) {
    console.warn('[work_session] create failed (non-fatal):', e?.message);
  }
  return jsonLoginSessionResponse(request, loginSession, nextPath);
}

/**
 * GET /api/auth/verify-email?token=
 */
async function handleEmailVerification(request, url, env) {
  const origin = new URL(request.url).origin;
  const token = url.searchParams.get('token');
  if (!token || !env.SESSION_CACHE) {
    return Response.redirect(`${origin}/auth/login?error=invalid_token`, 302);
  }
  const raw = await env.SESSION_CACHE.get(`email_verify_${token}`);
  if (!raw) {
    return Response.redirect(`${origin}/auth/login?error=token_expired`, 302);
  }

  let authUserId = null;
  try {
    const parsed = JSON.parse(raw);
    authUserId = parsed?.authUserId || null;
    if (authUserId) {
      await env.DB.prepare(
        `UPDATE auth_users SET is_verified = 1, verified_at = unixepoch(), updated_at = datetime('now') WHERE id = ?`,
      )
        .bind(authUserId)
        .run();
    }
    await env.SESSION_CACHE.delete(`email_verify_${token}`);
  } catch (e) {
    console.warn('[verify-email]', e?.message);
    return Response.redirect(`${origin}/auth/login?error=invalid_token`, 302);
  }

  if (!authUserId) {
    return Response.redirect(`${origin}/auth/login?error=invalid_token`, 302);
  }

  const loginSession = await createLoginSession(request, env, authUserId, 'email_verify');
  const { sessionToken } = normalizeLoginSessionResult(loginSession);
  await logAuthEvent(env, {
    request,
    eventType: 'auth_session_created',
    userId: authUserId,
    provider: 'email_verify',
  });

  const headers = new Headers({ Location: `${origin}/dashboard/agent` });
  appendBrowserLoginSessionCookies(headers, sessionToken);
  return new Response(null, { status: 302, headers });
}

async function handleResendVerification(request, env) {
  if (!signupEmailVerificationEnabled(env)) {
    return jsonResponse({ ok: false, error: 'Email verification is not configured' }, 503);
  }
  if (!env.DB) return jsonResponse({ ok: false, error: 'Service unavailable' }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid request body' }, 400);
  }

  const email = String(body.email || '')
    .toLowerCase()
    .trim();
  if (!email) return jsonResponse({ ok: false, error: 'Email is required' }, 400);

  const user = await resolveAuthUserByEmail(env, email);

  // Do not reveal whether the account exists.
  if (!user || user.password_hash === 'oauth' || Number(user.is_verified) === 1) {
    return jsonResponse({
      ok: true,
      message: 'If an unverified account exists for that email, a new verification link was sent.',
    });
  }

  const origin = new URL(request.url).origin;
  const sent = await sendSignupVerificationEmail(env, {
    origin,
    email,
    authUserId: user.id,
  });

  return jsonResponse({
    ok: true,
    email_sent: sent,
    message: sent
      ? 'Verification email sent. Check your inbox.'
      : 'Could not send email right now. Try again in a few minutes.',
  });
}

const DISPOSABLE_SIGNUP_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'tempmail.com',
  'yopmail.com',
  '10minutemail.com',
]);

function signupDisposableBlocked(env, email) {
  const raw = String(env.AUTH_BLOCK_DISPOSABLE_EMAILS || '').toLowerCase().trim();
  if (raw !== 'true' && raw !== '1') return false;
  const e = String(email || '').toLowerCase().trim();
  if (e === 'meauxbility@gmail.com') return false;
  const domain = e.split('@')[1] || '';
  return DISPOSABLE_SIGNUP_DOMAINS.has(domain);
}

/**
 * POST /api/auth/signup — { name?, email, password, invite_code? }
 */
async function handleEmailSignup(request, url, env) {
  const accept = request.headers.get('Accept') || '';
  const wantsJson =
    accept.includes('application/json') || (request.headers.get('Content-Type') || '').includes('application/json');

  function signupErr(msg, status = 400) {
    return jsonResponse({ ok: false, error: msg }, status);
  }

  if (!env.DB) return signupErr('Service unavailable', 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return signupErr('Invalid request body');
  }

  const mode = String(env.AUTH_SIGNUP_MODE || 'public').toLowerCase();
  if (mode === 'invite_only') {
    const expected = String(env.AUTH_INVITE_CODE || '').trim();
    const got = String(body.invite_code || '').trim();
    if (!expected || got !== expected) {
      await logAuthEvent(env, {
        request,
        eventType: 'auth_signup_started',
        status: 'blocked',
        metadata: { reason: 'invite_required' },
      });
      return signupErr('Valid invite code required', 403);
    }
  }

  const name = (body.name || '').toString().trim().slice(0, 100);
  const email = (body.email || '').toString().toLowerCase().trim();
  const password = (body.password || '').toString();

  if (!email || !password) return signupErr('Email and password are required');
  if (password.length < 8) return signupErr('Password must be at least 8 characters');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return signupErr('Invalid email address');
  if (signupDisposableBlocked(env, email)) {
    await logAuthEvent(env, {
      request,
      eventType: 'auth_signup_started',
      status: 'blocked',
      metadata: { reason: 'disposable_email' },
    });
    return signupErr('This email domain is not allowed for signup', 400);
  }

  await logAuthEvent(env, { request, eventType: 'auth_signup_started', status: 'ok', metadata: {} });

  const existing = await resolveAuthUserByEmail(env, email);
  if (existing) return signupErr('An account with this email already exists', 409);

  let passwordHash;
  let saltHex;
  try {
    const result = await hashPassword(password);
    passwordHash = result.hashHex;
    saltHex = result.saltHex;
  } catch (e) {
    console.error('[signup] hashPassword failed:', e?.message);
    return signupErr('Account creation failed', 500);
  }

  const ensured = await ensureAppUser(
    env,
    {
      email,
      name: name || email.split('@')[0],
      passwordHash,
      salt: saltHex,
      source: 'email_signup',
    },
    { allowCreate: true },
  );
  if (!ensured?.authUserId) {
    console.error('[signup] ensureAppUser failed');
    return signupErr('Account creation failed — email may already be registered', 409);
  }
  const authUserId = ensured.authUserId;

  await logAuthEvent(env, {
    request,
    eventType: 'auth_user_created',
    userId: authUserId,
    metadata: { email_domain: email.includes('@') ? email.split('@')[1] : null },
  });

  const identityOk = await ensureIdentityPlaneBeforeSession(env, request, {
    authUserId,
    email,
    name: name || email.split('@')[0],
    source: 'email_signup',
    provider: 'email',
    providerSubject: email,
    passwordHash,
    salt: saltHex,
  });
  if (!identityOk?.ok) {
    return signupErr('Account provisioning failed', 503);
  }

  const origin = new URL(request.url).origin;
  const enforceVerify = signupEmailVerificationEnabled(env);

  if (enforceVerify) {
    const emailSent = await sendSignupVerificationEmail(env, { origin, email, authUserId });
    await logAuthEvent(env, {
      request,
      eventType: 'auth_signup_pending_verification',
      userId: authUserId,
      metadata: { email_sent: emailSent ? 1 : 0 },
    });

    const payload = {
      ok: true,
      requires_verification: true,
      email_sent: emailSent,
      message: emailSent
        ? 'Check your email for a verification link. Sign in after you verify.'
        : 'Account created, but we could not send the verification email. Use Sign in → resend verification.',
    };

    if (wantsJson) return jsonResponse(payload);
    const loginNext = encodeURIComponent(DASHBOARD_AFTER_LOGIN_PATH);
    return Response.redirect(
      `${origin}/auth/login?registered=1&verify=pending&next=${loginNext}`,
      302,
    );
  }

  const loginSession = await createLoginSession(request, env, authUserId, 'email_signup');
  const { sessionId, sessionToken } = normalizeLoginSessionResult(loginSession);
  const tid = await resolveTenantAtLogin(env, authUserId).catch(() => null);
  try {
    const wsForSession = await resolveCanonicalWorkspace(env, authUserId);
    await env.DB.prepare(`
      INSERT OR IGNORE INTO work_sessions (
        session_id, user_id, tenant_id, workspace_id,
        started_at, last_activity_at, page_context
      ) VALUES (?, ?, ?, ?, unixepoch(), unixepoch(), ?)
    `).bind(
      sessionId,
      authUserId,
      tid ?? null,
      wsForSession ?? null,
      url.pathname,
    ).run();
  } catch (e) {
    console.warn('[work_session] create failed (non-fatal):', e?.message);
  }

  await logAuthEvent(env, {
    request,
    eventType: 'auth_session_created',
    userId: authUserId,
    provider: 'email_signup',
  });

  const next = DASHBOARD_AFTER_LOGIN_PATH;
  if (wantsJson) {
    const res = jsonResponse({ ok: true, redirect: next });
    appendBrowserLoginSessionCookies(res.headers, sessionToken);
    return res;
  }
  const headers = new Headers({ Location: `${origin}${next}` });
  appendBrowserLoginSessionCookies(headers, sessionToken);
  return new Response(null, { status: 302, headers });
}

function redirectWithLoginSession(request, loginResult) {
  const { sessionToken } = normalizeLoginSessionResult(loginResult);
  const target = new URL(DASHBOARD_AFTER_LOGIN_PATH, request.url).href;
  const res = Response.redirect(target, 302);
  appendBrowserLoginSessionCookies(res.headers, sessionToken);
  return res;
}

/** JSON login success for fetch-based auth (backup code, etc.) — mirrors finishLogin cookies. */
function jsonLoginSessionResponse(request, loginResult, redirectPath) {
  const { sessionToken } = normalizeLoginSessionResult(loginResult);
  const next =
    sanitizeBrowserNextPath(
      redirectPath && redirectPath.startsWith('/') ? redirectPath : DASHBOARD_AFTER_LOGIN_PATH,
    ) ?? DASHBOARD_AFTER_LOGIN_PATH;
  const payload = {
    ok: true,
    redirect: next,
    workspace_id: loginResult.workspaceId ?? null,
    tenant_id: loginResult.tenantId ?? null,
    capabilities: loginResult.capabilities ?? null,
    terminal: loginResult.terminal ?? null,
    github_repo: loginResult.github_repo ?? null,
  };
  const response = new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  appendBrowserLoginSessionCookies(response.headers, sessionToken);
  return response;
}

/**
 * POST /api/auth/logout
 */
async function handleLogout(request, url, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`${AUTH_COOKIE_NAME}=([^;]+)`));
  const rawCookie = match ? decodeURIComponent(String(match[1]).trim()) : null;
  const sessionId = rawCookie ? await resolveSessionIdFromCookieValue(env, rawCookie) : null;

  let sessionUserId = null;
  if (sessionId && env?.DB) {
    try {
      const row = await env.DB.prepare(`SELECT user_id FROM auth_sessions WHERE id = ? LIMIT 1`)
        .bind(sessionId)
        .first();
      sessionUserId = row?.user_id != null ? String(row.user_id).trim() : null;
    } catch (_) {}
    await revokeAuthSession(env, sessionId, 'logout', sessionUserId);
  }

  const responseBody = JSON.stringify({ ok: true });
  const response = new Response(responseBody, {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });

  // Host-only session cookie clearing
  response.headers.append('Set-Cookie', `${AUTH_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  
  // Legacy domain clearing
  response.headers.append('Set-Cookie', `${AUTH_COOKIE_NAME}=; Domain=.inneranimalmedia.com; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`);
  response.headers.append('Set-Cookie', `${AUTH_COOKIE_NAME}=; Domain=.sandbox.inneranimalmedia.com; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`);

  if (sessionId && env?.DB) {
    env.DB.prepare(`
      UPDATE work_sessions
      SET ended_at = unixepoch()
      WHERE session_id = ?
        AND ended_at IS NULL
    `).bind(sessionId).run().catch(() => {});
  }

  return response;
}

/**
 * Shared Session Finalizer
 */
async function finishLogin(request, url, env, userId, redirectPath) {
  if (await userNeedsSignupEmailVerification(env, userId)) {
    return jsonResponse(
      {
        ok: false,
        error: 'Verify your email before signing in.',
        code: 'email_not_verified',
      },
      403,
    );
  }

  const loginSession = await createLoginSession(request, env, userId, 'email');
  const { sessionId, sessionToken } = normalizeLoginSessionResult(loginSession);
  const tenantId = loginSession.tenantId ?? (await resolveTenantAtLogin(env, userId).catch(() => null));
  const wsForSession = loginSession.workspaceId ?? (await resolveCanonicalWorkspace(env, userId));
  try {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO work_sessions (
        session_id, user_id, tenant_id, workspace_id,
        started_at, last_activity_at, page_context
      ) VALUES (?, ?, ?, ?, unixepoch(), unixepoch(), ?)
    `).bind(
      sessionId,
      userId,
      tenantId ?? null,
      wsForSession ?? null,
      url.pathname,
    ).run();
  } catch (e) {
    console.warn('[work_session] create failed (non-fatal):', e?.message);
  }

  const next =
    sanitizeBrowserNextPath(
      redirectPath && redirectPath.startsWith('/') ? redirectPath : DASHBOARD_AFTER_LOGIN_PATH,
    ) ?? DASHBOARD_AFTER_LOGIN_PATH;
  const loginPayload = {
    ok: true,
    redirect: next,
    workspace_id: loginSession.workspaceId ?? wsForSession ?? null,
    tenant_id: tenantId ?? null,
    capabilities: loginSession.capabilities ?? null,
    terminal: loginSession.terminal ?? null,
    github_repo: loginSession.github_repo ?? null,
  };
  const response = new Response(JSON.stringify(loginPayload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  appendBrowserLoginSessionCookies(response.headers, sessionToken);
  return response;
}

/**
 * GET /api/settings/profile
 */
async function handleSettingsProfileRequest(request, env) {
  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  
  const worker_base_url = (typeof env.WORKER_BASE_URL === 'string') ? env.WORKER_BASE_URL.trim() : 'https://inneranimalmedia.com';

  const flat = {
    full_name: authUser.name || 'User',
    display_name: authUser.name || 'User',
    primary_email: authUser.email,
    tenant_id: authUser.tenant_id,
    person_uuid: authUser.person_uuid,
    role: 'user',
    timezone: 'America/Chicago',
    language: 'en',
  };

  return jsonResponse({
    display_name: authUser.name || 'User',
    email: authUser.email,
    tenant_id: authUser.tenant_id,
    worker_base_url,
    flat,
  });
}

async function handlePasswordChange(request, env) {
  if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 500);

  const session = await getSession(env, request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  const authRow = await env.DB.prepare(`SELECT * FROM auth_users WHERE id = ? LIMIT 1`)
    .bind(session.user_id)
    .first();
  if (!authRow) return jsonResponse({ error: 'User not found' }, 404);

  if (authRow.password_hash === 'oauth') {
    return jsonResponse({ error: 'OAuth account has no password' }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const currentPassword = (body.currentPassword ?? '').toString();
  const newPassword = (body.newPassword ?? '').toString();

  if (!newPassword || newPassword.length < 10) {
    return jsonResponse({ error: 'New password must be at least 10 characters' }, 400);
  }

  const valid = await verifyPassword(currentPassword, authRow.salt, authRow.password_hash);
  if (!valid) return jsonResponse({ error: 'Current password incorrect' }, 401);

  const { saltHex, hashHex } = await hashPassword(newPassword);
  await env.DB.prepare(
    `UPDATE auth_users SET password_hash=?, salt=?, updated_at=datetime('now') WHERE id=?`,
  )
    .bind(hashHex, saltHex, authRow.id)
    .run();

  await env.DB.prepare(
    `INSERT INTO password_resets
       (email, user_id, auth_id, tenant_id, reset_type, used, used_at, expires_at, metadata_json)
     VALUES (?, ?, ?, ?, 'password_change', 1, unixepoch(), unixepoch()+60, '{"source":"self_service"}')`,
  )
    .bind(authRow.email, authRow.id, authRow.id, authRow.tenant_id)
    .run();

  return jsonResponse({ ok: true }, 200);
}

async function handleEmailChangeRequest(request, env) {
  if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 500);

  const session = await getSession(env, request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  const authUser = await env.DB.prepare(`SELECT id FROM auth_users WHERE id = ? LIMIT 1`)
    .bind(session.user_id)
    .first();
  if (!authUser) return jsonResponse({ error: 'User not found' }, 404);

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const newEmail = String(body.newEmail ?? '')
    .toLowerCase()
    .trim();
  if (!newEmail || !newEmail.includes('@')) {
    return jsonResponse({ error: 'Invalid email address' }, 400);
  }

  const existing = await env.DB.prepare(`SELECT id FROM auth_users WHERE email = ?`)
    .bind(newEmail)
    .first();
  if (existing) return jsonResponse({ error: 'Email already in use' }, 409);

  const token = crypto.randomUUID();
  const tokenId = `evt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await env.DB.prepare(
    `INSERT INTO email_verification_tokens
       (id, auth_user_id, token, token_type, expires_at, created_at)
     VALUES (?, ?, ?, 'email_change', unixepoch()+86400, unixepoch())`,
  )
    .bind(tokenId, authUser.id, token)
    .run();

  if (!env.RESEND_API_KEY) {
    return jsonResponse({ error: 'Email not configured' }, 503);
  }

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'Inner Animal Media <hey@inneranimalmedia.com>',
      to: [newEmail],
      subject: 'Confirm your new email address',
      html: `<p>Hi,</p>
             <p>Click to confirm your new email address:</p>
             <p><a href="https://inneranimalmedia.com/auth/verify-email?token=${token}">Confirm email</a></p>
             <p>This link expires in 24 hours. If you did not request this, ignore it.</p>`,
    }),
  }).catch((e) => console.error('[email-change] resend error', e));

  return jsonResponse({ ok: true }, 200);
}

async function handleAuthIdentities(request, env) {
  if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 500);

  const session = await getSession(env, request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  const authUser = await env.DB.prepare(`SELECT id FROM auth_users WHERE id = ? LIMIT 1`)
    .bind(session.user_id)
    .first();
  if (!authUser) return jsonResponse({ error: 'User not found' }, 404);

  const { results } = await env.DB.prepare(
    `SELECT provider, email, created_at
       FROM auth_user_identities
      WHERE auth_user_id = ?
      ORDER BY created_at ASC`,
  )
    .bind(authUser.id)
    .all();

  return jsonResponse({ identities: results || [] }, 200);
}

/** POST /api/auth/password-reset/request — body: { email } */
async function handlePasswordResetRequest(request, env) {
  if (!env.DB || !env.SESSION_CACHE) {
    return jsonResponse({ error: 'Service unavailable' }, 503);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  try {
    const svc = createIamPasswordResetService(env);
    const result = await svc.requestReset({ email: body.email });
    return jsonResponse(result);
  } catch (e) {
    if (e?.code === 'email_not_configured' || e?.message === 'email_not_configured') {
      console.error('[password-reset] RESEND_API_KEY missing');
      return jsonResponse({ error: 'Email not configured' }, 503);
    }
    console.error('[password-reset] request failed', e?.message ?? e);
    return jsonResponse({ error: 'Service unavailable' }, 503);
  }
}

/** POST /api/auth/password-reset/confirm — body: { email, code, password, confirm_password } */
async function handlePasswordResetConfirm(request, env) {
  if (!env.DB || !env.SESSION_CACHE) {
    return jsonResponse({ error: 'Service unavailable' }, 503);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  const svc = createIamPasswordResetService(env);
  const result = await svc.confirmReset({
    email: body.email,
    code: body.code,
    password: body.password,
    confirmPassword: body.confirm_password ?? body.confirmPassword ?? body.confirm,
  });
  if (!result.ok) {
    return jsonResponse({ error: result.error }, result.status || 400);
  }
  return jsonResponse({ ok: true });
}

// ── Supabase Auth OAuth Server (IAM login) ───────────────────────────────────
// Uses ONLY env.SUPABASE_OAUTH_CLIENT_ID / SUPABASE_OAUTH_CLIENT_SECRET — OAuth app under
// Supabase Dashboard > Authentication > OAuth Apps (project Auth server). PKCE S256.
// redirect_uri must match exactly (register in that OAuth app): {origin}/api/auth/supabase/callback
// Supabase Management API OAuth (/api/oauth/supabase/*) uses SUPABASE_MANAGEMENT_OAUTH_* in oauth.js — different credentials.
//
// Requires env.SUPABASE_URL (preferred) or env.SUPABASE_PROJECT_REF — no project-ref fallback in code.
// Optional: env.WORKER_BASE_URL for stable redirect_uri (prod apex).
//
// KV state MUST use this prefix — never `oauth_state_${state}` or Management's `supabase_management_oauth_state:`.

const SUPABASE_AUTH_OAUTH_STATE_KEY_PREFIX = 'supabase_auth_oauth_state:';

function supabaseAuthLoginStateKey(state) {
  return `${SUPABASE_AUTH_OAUTH_STATE_KEY_PREFIX}${state}`;
}

function oauthClientIdTail(clientId) {
  const t = String(clientId || '').trim();
  if (!t) return '(empty)';
  return t.length <= 6 ? t : t.slice(-6);
}

function supabaseAuthV1Base(env) {
  return `${resolveSupabaseRestOrigin(env)}/auth/v1`;
}

function resolvePublicOriginForOAuth(request, env) {
  const fromEnv =
    typeof env.WORKER_BASE_URL === 'string' ? env.WORKER_BASE_URL.trim().replace(/\/$/, '') : '';
  if (fromEnv) return fromEnv;
  return new URL(request.url).origin;
}

function resolveSupabaseLoginRedirectUri(request, env) {
  return `${resolvePublicOriginForOAuth(request, env)}/api/auth/supabase/callback`;
}

function logSupabaseLoginDebug(payload) {
  try {
    console.log(`[supabase_oauth_login] ${JSON.stringify(payload)}`);
  } catch (_) {}
}

/** Decode Supabase access_token JWT payload (no signature verify — already exchanged with Auth server). */
function parseSupabaseAccessTokenPayload(accessToken) {
  const raw = String(accessToken || '').trim();
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length < 2) return null;
  let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  try {
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

function base64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function collectSetCookieValues(headers) {
  if (typeof headers.getSetCookie === 'function') {
    const list = headers.getSetCookie();
    if (list && list.length) return list;
  }
  const single = headers.get('Set-Cookie');
  return single ? [single] : [];
}

function appendLegacySessionCookieClears(targetHeaders) {
  targetHeaders.append(
    'Set-Cookie',
    `${AUTH_COOKIE_NAME}=; Domain=.inneranimalmedia.com; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`,
  );
  targetHeaders.append(
    'Set-Cookie',
    `${AUTH_COOKIE_NAME}=; Domain=.sandbox.inneranimalmedia.com; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`,
  );
}

/** Workers Response.redirect requires an absolute URL (relative throws → CF 1101). */
function redirectToAuthLogin(request, queryWithoutLeadingQuestion) {
  const u = new URL(request.url);
  u.pathname = AUTH_LOGIN_PATH;
  u.search = queryWithoutLeadingQuestion.replace(/^\?/, '');
  return Response.redirect(u.href, 302);
}

function safeOauthNextPath(raw) {
  const s = String(raw || '').trim();
  if (!s.startsWith('/') || s.startsWith('//')) return null;
  return s;
}

function readIamOauthNextCookie(request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)iam_oauth_next=([^;]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].trim());
  } catch {
    return null;
  }
}

export async function handleSupabaseOAuthStart(request, env) {
  try {
    if (!env.SUPABASE_OAUTH_CLIENT_ID) {
      console.error(
        '[handleSupabaseOAuthStart] SUPABASE_OAUTH_CLIENT_ID is undefined or empty; aborting OAuth start',
      );
      return redirectToAuthLogin(request, 'error=oauth_not_configured');
    }
    if (!env.SESSION_CACHE) {
      console.error(
        '[handleSupabaseOAuthStart] SESSION_CACHE binding missing on env; aborting OAuth start',
      );
      return redirectToAuthLogin(request, 'error=oauth_not_configured');
    }
    const reqUrl = new URL(request.url);
    const rawNext =
      safeOauthNextPath(reqUrl.searchParams.get('next')) ||
      safeOauthNextPath(readIamOauthNextCookie(request));
    let nextPath = rawNext ? sanitizeBrowserNextPath(rawNext) : null;

    const state = crypto.randomUUID();
    const codeVerifier =
      crypto.randomUUID().replace(/-/g, '') +
      crypto.randomUUID().replace(/-/g, '');

    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(codeVerifier),
    );
    const codeChallenge = base64url(digest);

    const redirectUri = resolveSupabaseLoginRedirectUri(request, env);
    const authBase = supabaseAuthV1Base(env);
    const authorizeUrl = `${authBase}/oauth/authorize`;

    try {
      await env.SESSION_CACHE.put(
        supabaseAuthLoginStateKey(state),
        JSON.stringify({
          state,
          provider: 'supabase_project_oauth',
          code_verifier: codeVerifier,
          created_at: Date.now(),
          next: nextPath,
          redirect_uri: redirectUri,
        }),
        { expirationTtl: 600 },
      );
    } catch (kvErr) {
      console.error(
        '[handleSupabaseOAuthStart] SESSION_CACHE.put failed:',
        kvErr && kvErr.stack ? kvErr.stack : kvErr,
      );
      return redirectToAuthLogin(request, 'error=oauth_not_configured');
    }

    const params = new URLSearchParams({
      client_id: env.SUPABASE_OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'login',
    });

    logSupabaseLoginDebug({
      phase: 'start',
      provider: 'supabase_project_oauth',
      callback_path: '/api/auth/supabase/callback',
      redirect_uri: redirectUri,
      authorize_host: new URL(authBase).host,
      client_id_tail: oauthClientIdTail(env.SUPABASE_OAUTH_CLIENT_ID),
    });

    const redirectRes = Response.redirect(`${authorizeUrl}?${params}`, 302);
    if (readIamOauthNextCookie(request)) {
      redirectRes.headers.append(
        'Set-Cookie',
        'iam_oauth_next=; Path=/; Max-Age=0; Secure; SameSite=Lax',
      );
    }
    return redirectRes;
  } catch (err) {
    console.error(
      '[handleSupabaseOAuthStart] unexpected error:',
      err && err.stack ? err.stack : err,
    );
    return redirectToAuthLogin(request, 'error=server_error');
  }
}

export async function handleSupabaseOAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const redirectUri = resolveSupabaseLoginRedirectUri(request, env);
  const authBase = supabaseAuthV1Base(env);
  const tokenUrl = `${authBase}/oauth/token`;
  const userinfoUrl = `${authBase}/oauth/userinfo`;
  const userFallbackUrl = `${authBase}/user`;

  if (error) return redirectToAuthLogin(request, 'error=oauth_denied');
  if (!code || !state) return redirectToAuthLogin(request, 'error=invalid_callback');
  if (!env.SESSION_CACHE || !env.DB) {
    return redirectToAuthLogin(request, 'error=oauth_not_configured');
  }

  const stateKey = supabaseAuthLoginStateKey(state);
  const storedRaw = await env.SESSION_CACHE.get(stateKey);
  if (!storedRaw) {
    const { handleOAuthApi } = await import('./oauth.js');
    const internal = new URL(request.url);
    internal.pathname = '/api/oauth/supabase/callback';
    return handleOAuthApi(new Request(internal.toString(), request), env, null);
  }

  if (!env.SUPABASE_OAUTH_CLIENT_ID || !env.SUPABASE_OAUTH_CLIENT_SECRET) {
    return redirectToAuthLogin(request, 'error=oauth_not_configured');
  }

  logSupabaseLoginDebug({
    phase: 'callback_received',
    provider: 'supabase_project_oauth',
    callback_path: url.pathname,
    redirect_uri_expected: redirectUri,
    client_id_tail: oauthClientIdTail(env.SUPABASE_OAUTH_CLIENT_ID),
    has_code: !!code,
    has_state: !!state,
  });

  await env.SESSION_CACHE.delete(stateKey);

  const stored = JSON.parse(storedRaw);
  const { code_verifier } = stored;
  const rawStoredNext = safeOauthNextPath(stored?.next);
  const nextAfterLogin = rawStoredNext ? sanitizeBrowserNextPath(rawStoredNext) : null;
  const storedRedirectUri = typeof stored?.redirect_uri === 'string' ? stored.redirect_uri.trim() : '';
  const tokenRedirectUri = storedRedirectUri || redirectUri;
  if (storedRedirectUri && storedRedirectUri !== redirectUri) {
    console.warn(
      '[supabase_oauth_login] redirect_uri mismatch between callback request and KV state; using stored value for token exchange',
    );
  }

  const basicAuth = btoa(
    `${env.SUPABASE_OAUTH_CLIENT_ID}:${env.SUPABASE_OAUTH_CLIENT_SECRET}`,
  );
  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: tokenRedirectUri,
      code_verifier,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error('[supabase_oauth_login] token exchange failed', tokenRes.status, errText?.slice?.(0, 200) || '');
    return redirectToAuthLogin(request, 'error=token_exchange_failed');
  }

  const { access_token, refresh_token, expires_in } = await tokenRes.json();

  const jwtPayload = parseSupabaseAccessTokenPayload(access_token);
  const supabaseUserId =
    jwtPayload && typeof jwtPayload.sub === 'string' && jwtPayload.sub.trim()
      ? jwtPayload.sub.trim()
      : null;
  if (!supabaseUserId) {
    console.error('[supabase_oauth] access token JWT missing sub claim');
    return redirectToAuthLogin(request, 'error=invalid_token');
  }

  let sbUser = null;
  const uiRes = await fetch(userinfoUrl, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (uiRes.ok) {
    sbUser = await uiRes.json();
  } else {
    const fallbackRes = await fetch(userFallbackUrl, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (fallbackRes.ok) {
      sbUser = await fallbackRes.json();
    }
  }

  const userinfoSub =
    sbUser && (sbUser.sub != null || sbUser.id != null)
      ? String(sbUser.sub ?? sbUser.id).trim()
      : '';
  if (userinfoSub && userinfoSub !== supabaseUserId) {
    console.error('[supabase_oauth] JWT sub vs userinfo subject mismatch', {
      jwt_sub_tail: supabaseUserId.slice(-8),
      userinfo_sub_tail: userinfoSub.slice(-8),
    });
    return redirectToAuthLogin(request, 'error=identity_mismatch');
  }

  const jwtEmail =
    jwtPayload && typeof jwtPayload.email === 'string' ? jwtPayload.email.trim() : '';
  const profileEmail =
    sbUser?.email != null ? String(sbUser.email).toLowerCase().trim() : '';
  const emailRaw = profileEmail || jwtEmail;
  if (!emailRaw) {
    console.error('[supabase_oauth] no email on userinfo or JWT');
    return redirectToAuthLogin(request, 'error=no_email');
  }
  const oauthEmail = emailRaw.toLowerCase().trim();
  const name =
    (sbUser && (sbUser.name || sbUser.user_metadata?.full_name)) ||
    oauthEmail.split('@')[0];

  const finalizedSb = await finalizeInboundOAuth(env, request, {
    provider: 'supabase_auth',
    email: oauthEmail,
    name,
    providerUid: supabaseUserId,
    supabaseUserId,
    source: 'supabase_auth',
    pageContext: url.pathname,
  });
  if (!finalizedSb.ok) {
    if (finalizedSb.error === 'session_failed') {
      logSupabaseLoginDebug({
        phase: 'session_failed',
        provider: 'supabase_project_oauth',
        callback_path: url.pathname,
        session_response_status: 500,
        cookie_name: AUTH_COOKIE_NAME,
        has_session_cookie: false,
      });
    } else {
      console.error('[supabase_oauth] finalizeInboundOAuth failed', supabaseUserId);
    }
    return redirectToAuthLogin(request, `error=${finalizedSb.error}`);
  }

  const { authUserId, sessionId, sessionToken, tenantId: finalizedTenantId } = finalizedSb;

  const authRow = await env.DB.prepare(
    `SELECT id, tenant_id, person_uuid, supabase_user_id FROM auth_users WHERE id = ? LIMIT 1`,
  )
    .bind(authUserId)
    .first();

  const expiresAt = Math.floor(Date.now() / 1000) + (expires_in || 3600);
  if (isVaultConfigured(env)) {
    try {
      await upsertOauthToken(
        env,
        {
          user_id: authUserId,
        tenant_id: authRow?.tenant_id || '',
        person_uuid: authRow?.person_uuid || '',
          provider: 'supabase_auth',
          access_token,
          refresh_token: refresh_token || null,
          expires_at: expiresAt,
          account_identifier: supabaseUserId,
          account_email: oauthEmail,
          account_display: name,
          scope: 'openid profile email',
        },
        { skipRegistry: true },
      );
      await logAuthEvent(env, {
        request,
        eventType: 'oauth_token_stored',
        userId: authUserId,
        tenantId: authRow?.tenant_id,
        provider: 'supabase_auth',
        metadata: { account_identifier_tail: supabaseUserId.slice(-8) },
      });
    } catch (e) {
      console.warn('[supabase_oauth] encrypted token store failed', e?.message ?? e);
    }
  } else {
    await env.DB.prepare(`
      INSERT OR REPLACE INTO user_oauth_tokens
        (user_id, provider, account_identifier, access_token, refresh_token, expires_at, scope)
      VALUES (?, 'supabase_auth', ?, ?, ?, ?, 'openid profile email')
    `).bind(authUserId, supabaseUserId, access_token, refresh_token || null, expiresAt).run();
  }

  console.log('[supabase_oauth] session created', {
    supabase_user_id: supabaseUserId,
    user_id: authUserId,
    email_domain: oauthEmail.includes('@') ? oauthEmail.split('@')[1] : '',
    tenant_id: authRow?.tenant_id ?? finalizedTenantId ?? null,
  });

  const originBase = resolvePublicOriginForOAuth(request, env);
  const destPath = nextAfterLogin || DASHBOARD_AFTER_LOGIN_PATH;
  logSupabaseLoginDebug({
    phase: 'session_created',
    provider: 'supabase_project_oauth',
    user_id: authUserId,
    cookie_name: AUTH_COOKIE_NAME,
    next_redirect: destPath,
    has_session_cookie: true,
    session_response_status: 200,
    callback_path: url.pathname,
    client_id_tail: oauthClientIdTail(env.SUPABASE_OAUTH_CLIENT_ID),
  });
  const redirectHeaders = new Headers({ Location: `${originBase}${destPath}` });
  appendBrowserLoginSessionCookies(redirectHeaders, sessionToken);
  appendLegacySessionCookieClears(redirectHeaders);

  return new Response(null, { status: 302, headers: redirectHeaders });
}

// ── Supabase OAuth Server — hosted consent UI (/api/auth/oauth/consent) ─────────
// Supabase redirects here with ?authorization_id= only (no client_id / PKCE params).
// Consent uses Auth API: GET/POST .../oauth/authorizations/:id(/consent) with a
// Supabase end-user JWT. IAM sessions are bridged via Admin API + HS256 mint.

function resolveSupabaseRestOrigin(env) {
  const raw = env?.SUPABASE_URL && String(env.SUPABASE_URL).trim();
  if (raw) return raw.replace(/\/$/, '');
  const ref =
    typeof env.SUPABASE_PROJECT_REF === 'string' ? env.SUPABASE_PROJECT_REF.trim() : '';
  if (ref) return `https://${ref}.supabase.co`;
  throw new Error('SUPABASE_URL or SUPABASE_PROJECT_REF required');
}

function supabaseJwtIssuer(env) {
  return `${resolveSupabaseRestOrigin(env)}/auth/v1`;
}

function jwtSecretForMint(env) {
  const a = typeof env.SUPABASE_JWT_SECRET === 'string' ? env.SUPABASE_JWT_SECRET.trim() : '';
  if (a) return a;
  const b = typeof env.JWT_SECRET === 'string' ? env.JWT_SECRET.trim() : '';
  return b || '';
}

function authorizationIdTail(id) {
  const s = String(id || '').trim();
  if (!s) return '(none)';
  return s.length <= 6 ? '(short)' : s.slice(-6);
}

function appUserIdTail(id) {
  const s = String(id || '').trim();
  if (!s) return null;
  return s.length <= 6 ? '(short)' : s.slice(-6);
}

function safeEmailDomain(email) {
  const e = String(email || '').trim().toLowerCase();
  const i = e.indexOf('@');
  if (i === -1) return null;
  return e.slice(i + 1) || null;
}

function safeRedirectLog(redirectUrl) {
  try {
    const u = new URL(redirectUrl);
    return { host: u.host, pathname: u.pathname };
  } catch {
    return { host: '(invalid)', pathname: '' };
  }
}

function escapeHtmlConsent(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function jsonToUint8(str) {
  return new TextEncoder().encode(str);
}

async function signHs256Jwt(secretUtf8, payloadObj) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerPart = base64url(jsonToUint8(JSON.stringify(header)));
  const payloadPart = base64url(jsonToUint8(JSON.stringify(payloadObj)));
  const signingInput = `${headerPart}.${payloadPart}`;
  const key = await crypto.subtle.importKey(
    'raw',
    jsonToUint8(secretUtf8),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, jsonToUint8(signingInput));
  const sigPart = base64url(new Uint8Array(sig));
  return `${signingInput}.${sigPart}`;
}

async function mintSupabaseUserAccessToken(env, supabaseUserId, email) {
  const secret = jwtSecretForMint(env);
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  const iss = supabaseJwtIssuer(env);
  const payload = {
    aud: 'authenticated',
    exp,
    iat: now,
    iss,
    sub: supabaseUserId,
    role: 'authenticated',
    email: String(email || '').trim(),
  };
  return signHs256Jwt(secret, payload);
}

async function verifySupabaseUserJwt(env, accessToken) {
  const origin = resolveSupabaseRestOrigin(env);
  const anon =
    typeof env.SUPABASE_ANON_KEY === 'string' && env.SUPABASE_ANON_KEY.trim()
      ? env.SUPABASE_ANON_KEY.trim()
      : '';
  const apikey =
    anon ||
    (typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' && env.SUPABASE_SERVICE_ROLE_KEY.trim()
      ? env.SUPABASE_SERVICE_ROLE_KEY.trim()
      : '');
  if (!apikey) return false;
  const res = await fetch(`${origin}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey,
    },
  });
  return res.ok;
}

async function adminFindSupabaseUserIdByEmail(env, email) {
  const sr =
    typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
  if (!sr || !email) return null;
  const origin = resolveSupabaseRestOrigin(env);
  const url = `${origin}/auth/v1/admin/users?email=eq.${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    headers: { apikey: sr, Authorization: `Bearer ${sr}` },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const users = Array.isArray(data?.users) ? data.users : [];
  const id = users[0]?.id;
  return typeof id === 'string' && id ? id : null;
}

async function adminCreateSupabaseAuthUser(env, email, displayName) {
  const sr =
    typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
  if (!sr || !email) return null;
  const origin = resolveSupabaseRestOrigin(env);
  const res = await fetch(`${origin}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: sr,
      Authorization: `Bearer ${sr}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      email_confirm: true,
      user_metadata: { full_name: displayName || '' },
    }),
  });
  if (!res.ok) {
    if (res.status === 422 || res.status === 409) {
      return adminFindSupabaseUserIdByEmail(env, email);
    }
    return null;
  }
  const row = await res.json().catch(() => ({}));
  const id = row?.id || row?.user?.id;
  return typeof id === 'string' && id ? id : null;
}

async function resolveSupabaseAuthSubjectForIamUser(env, iamUser) {
  const email = String(iamUser?.email || '').trim().toLowerCase();
  if (!email) return null;
  let sid = await adminFindSupabaseUserIdByEmail(env, email);
  if (!sid) {
    sid = await adminCreateSupabaseAuthUser(env, email, iamUser?.name || '');
  }
  return sid;
}

async function getBearerForConsent(env, iamUser) {
  const sid = await resolveSupabaseAuthSubjectForIamUser(env, iamUser);
  if (!sid) return { error: 'no_supabase_user', bearer: null };
  const email = String(iamUser?.email || '').trim();
  let bearer = await mintSupabaseUserAccessToken(env, sid, email);
  if (!bearer) return { error: 'jwt_secret_missing', bearer: null };
  const ok = await verifySupabaseUserJwt(env, bearer);
  if (!ok) return { error: 'jwt_mint_invalid', bearer: null };
  return { error: null, bearer };
}

function consentApikeyHeader(env) {
  const anon =
    typeof env.SUPABASE_ANON_KEY === 'string' && env.SUPABASE_ANON_KEY.trim()
      ? env.SUPABASE_ANON_KEY.trim()
      : '';
  if (anon) return anon;
  const sr =
    typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
  return sr || '';
}

async function fetchAuthorizationDetails(env, bearer, authorizationId) {
  const authBase = supabaseAuthV1Base(env);
  const apikey = consentApikeyHeader(env);
  if (!apikey) return { ok: false, status: 503, json: null };
  const res = await fetch(`${authBase}/oauth/authorizations/${encodeURIComponent(authorizationId)}`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      apikey,
    },
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

async function postConsentDecision(env, bearer, authorizationId, action) {
  const authBase = supabaseAuthV1Base(env);
  const apikey = consentApikeyHeader(env);
  if (!apikey) return { ok: false, status: 503, json: null };
  const res = await fetch(
    `${authBase}/oauth/authorizations/${encodeURIComponent(authorizationId)}/consent`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        apikey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action }),
    },
  );
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

function consentMissingRequestHtml() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Invalid OAuth request · InnerAnimalMedia</title>
<style>
:root { --bg:#0b1220; --card:#111827; --line:#1f2937; --text:#e5e7eb; --muted:#9ca3af; --accent:#22d3ee; --danger:#f87171; }
*{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:radial-gradient(1200px 600px at 10% -10%,#0e7490 0%,transparent 55%),var(--bg);color:var(--text);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
.card{max-width:440px;width:100%;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.45);}
.badge{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700;}
h1{font-size:22px;margin:12px 0 8px;line-height:1.25;}
p{color:var(--muted);font-size:15px;line-height:1.5;margin:0 0 16px;}
.btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 20px;border-radius:10px;font-weight:600;text-decoration:none;font-size:15px;border:none;cursor:pointer}
.btn-primary{background:var(--accent);color:#042f2e}
</style></head>
<body><div class="card"><div class="badge">InnerAnimalMedia</div>
<h1>Invalid OAuth request</h1>
<p>This authorization request is missing an <code style="color:var(--text)">authorization_id</code>. It cannot be completed.</p>
<a class="btn btn-primary" href="/dashboard/overview">Back to Dashboard</a>
</div></body></html>`;
}

function consentConfigErrorHtml(title, detail) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtmlConsent(title)}</title></head>
<body>
<p>${escapeHtmlConsent(title)}</p>
<p>${escapeHtmlConsent(detail)}</p>
<p><a href="/auth/login">Back to sign in</a></p>
</body></html>`;
}

function consentPageHtml(opts) {
  const {
    authorizationId,
    clientName,
    redirectUri,
    scopes,
    signedInEmail,
    errorMessage,
    workspaceLabel,
  } = opts;
  const safeNext = `/api/auth/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
  const switchHref = `/auth/login?next=${encodeURIComponent(safeNext)}`;
  const scopeList = String(scopes || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const scopeItems = scopeList.length
    ? scopeList.map((s) => `<li>${escapeHtmlConsent(s)}</li>`).join('')
    : '<li><em>Standard sign-in and profile</em></li>';
  const errBlock = errorMessage
    ? `<div role="alert" style="background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.35);color:#fecaca;padding:12px 14px;border-radius:10px;font-size:14px;margin-bottom:16px">${escapeHtmlConsent(errorMessage)}</div>`
    : '';
  const ws = workspaceLabel ? escapeHtmlConsent(workspaceLabel) : 'Your default workspace';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Authorize access · InnerAnimalMedia</title>
<style>
:root{--bg:#0b1220;--card:#0f172a;--line:#1e293b;--text:#f1f5f9;--muted:#94a3b8;--accent:#38bdf8;--accent2:#22c55e;--btn-no:#475569}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:radial-gradient(900px 500px at 80% -20%,rgba(56,189,248,.25),transparent 50%),var(--bg);color:var(--text);min-height:100vh;}
.shell{max-width:520px;margin:0 auto;padding:32px 20px 48px;}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.02em;font-size:20px;margin-bottom:28px}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px;box-shadow:0 28px 100px rgba(0,0,0,.5);}
.client{font-size:18px;font-weight:700;margin:0 0 6px;line-height:1.3}
.sub{color:var(--muted);font-size:15px;line-height:1.5;margin:0 0 20px}
.user{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:14px;background:#020617;border:1px solid var(--line);margin-bottom:20px}
.avatar{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--accent),#6366f1);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
.meta{font-size:14px}.meta strong{display:block;font-size:15px}
.section-title{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:700;margin:0 0 10px}
ul{margin:0;padding-left:20px;color:var(--muted);font-size:14px;line-height:1.6}
.note{font-size:13px;color:var(--muted);line-height:1.5;margin:18px 0 0;padding-top:16px;border-top:1px solid var(--line)}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
button,a.btn{flex:1;min-width:120px;padding:13px 16px;border-radius:12px;font-weight:700;font-size:15px;border:none;cursor:pointer;text-align:center;text-decoration:none;display:inline-block}
.btn-cancel{background:var(--btn-no);color:var(--text)}
.btn-ok{background:linear-gradient(135deg,var(--accent2),#16a34a);color:#052e16}
.footer-note{font-size:12px;color:var(--muted);margin-top:20px;line-height:1.5}
a.link{color:var(--accent);text-decoration:none;font-weight:600}
</style></head>
<body><div class="shell"><div class="logo">◆ InnerAnimalMedia</div>
<div class="card">${errBlock}
<p class="sub" style="margin-top:0"><strong class="client">${escapeHtmlConsent(clientName || 'Application')}</strong> wants to access your InnerAnimalMedia account.</p>
<div class="user"><div class="avatar">${escapeHtmlConsent((signedInEmail || '?').slice(0, 1).toUpperCase())}</div><div class="meta"><strong>${escapeHtmlConsent(signedInEmail || '')}</strong><span style="color:var(--muted)">Workspace: ${ws}</span></div></div>
<p class="section-title">Permissions</p>
<ul>${scopeItems}</ul>
<p class="note">This may include read access to resources tied to the selected workspace. You can revoke access later from your account security settings.</p>
<p class="footer-note">Only authorize access if you trust this application.</p>
<div class="actions">
<form method="post" action="/api/auth/oauth/consent/deny" style="flex:1;display:block">
  <input type="hidden" name="authorization_id" value="${escapeHtmlConsent(authorizationId)}"/>
  <button type="submit" class="btn-cancel" name="_action" value="deny" style="width:100%">Cancel</button>
</form>
<form method="post" action="/api/auth/oauth/consent/approve" style="flex:1;display:block">
  <input type="hidden" name="authorization_id" value="${escapeHtmlConsent(authorizationId)}"/>
  <button type="submit" class="btn-ok" name="_action" value="approve" style="width:100%">Authorize</button>
</form>
</div>
<p style="margin-top:16px;font-size:13px;color:var(--muted)">Not you? <a class="link" href="${switchHref}">Switch account</a></p>
<p style="font-size:12px;color:var(--muted);word-break:break-all">Redirect: ${escapeHtmlConsent(redirectUri || '')}</p>
</div></div></body></html>`;
}

async function parseConsentInput(request, url) {
  const pathAction = String(url.searchParams.get('_consent_action') || '')
    .toLowerCase()
    .trim();
  const pathActionNorm =
    pathAction === 'approve' || pathAction === 'deny' ? pathAction : '';

  if (request.method === 'GET') {
    return {
      authorizationId: url.searchParams.get('authorization_id')?.trim() || '',
      action: pathActionNorm,
    };
  }
  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    try {
      const j = await request.json();
      const a = String(j.action || '').toLowerCase();
      const fromBody = a === 'approve' || a === 'deny' ? a : '';
      return {
        authorizationId: String(j.authorization_id || '').trim(),
        action: fromBody || pathActionNorm,
      };
    } catch {
      return { authorizationId: '', action: pathActionNorm };
    }
  }
  try {
    const fd = await request.formData();
    const aid = String(fd.get('authorization_id') || '').trim();
    const raw = String(fd.get('_action') || '').toLowerCase();
    const action = raw === 'approve' || raw === 'deny' ? raw : pathActionNorm;
    return { authorizationId: aid, action };
  } catch {
    return { authorizationId: '', action: pathActionNorm };
  }
}

export async function handleOAuthConsentPage(request, env) {
  const url = new URL(request.url);

  let authorizationId = '';
  let postAction = '';
  try {
    const parsed = await parseConsentInput(request, url);
    authorizationId = parsed.authorizationId;
    postAction = parsed.action;
  } catch {
    authorizationId = '';
    postAction = '';
  }

  if (authorizationId.startsWith('oaa_')) {
    if (request.method === 'GET' && url.pathname === '/api/auth/oauth/consent') {
      const react = new URL('/oauth/mcp/consent', url.origin);
      react.searchParams.set('authorization_id', authorizationId);
      return Response.redirect(react.href, 302);
    }
    const { handleIamMcpOAuthConsentPage } = await import('./mcp-oauth-consent.js');
    return handleIamMcpOAuthConsentPage(request, env);
  }

  const iamUser = await getAuthUser(request, env);
  let workspaceLabel = '';
  if (iamUser?.id && env.DB) {
    try {
      const w = await env.DB.prepare(
        `SELECT w.name FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = ? ORDER BY wm.joined_at ASC LIMIT 1`,
      )
        .bind(iamUser.id)
        .first();
      workspaceLabel = String(w?.name || '').trim();
    } catch (_) {}
  }
  const authTail = authorizationIdTail(authorizationId);
  const domain = safeEmailDomain(iamUser?.email);
  const uidTail = iamUser?.id ? appUserIdTail(iamUser.id) : null;

  await logAuthEvent(env, {
    request,
    eventType: 'oauth_consent_received',
    userId: iamUser?.id,
    metadata: {
      method: request.method,
      authorization_id_tail: authTail,
      authenticated: !!iamUser,
      user_id_tail: uidTail,
      email_domain: domain,
    },
  });

  if (!authorizationId) {
    await logAuthEvent(env, { request, eventType: 'oauth_consent_missing_authorization_id', status: 'fail' });
    return new Response(consentMissingRequestHtml(), {
      status: 400,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  if (!iamUser) {
    await logAuthEvent(env, {
      request,
      eventType: 'oauth_consent_requires_login',
      metadata: { authorization_id_tail: authTail },
    });
    const q = new URLSearchParams();
    q.set('next', `/api/auth/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
    return redirectToAuthLogin(request, q.toString());
  }

  const bridge = await getBearerForConsent(env, iamUser);
  if (bridge.error === 'jwt_secret_missing') {
    await logAuthEvent(env, {
      request,
      eventType: 'oauth_consent_error',
      userId: iamUser.id,
      status: 'fail',
      metadata: { reason: 'jwt_secret_missing' },
    });
    return new Response(
      consentConfigErrorHtml(
        'Consent is not configured',
        'Missing JWT signing secret for Supabase Auth bridge (SUPABASE_JWT_SECRET).',
      ),
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
    );
  }
  if (bridge.error === 'no_supabase_user') {
    await logAuthEvent(env, {
      request,
      eventType: 'oauth_consent_error',
      userId: iamUser.id,
      status: 'fail',
      metadata: { reason: 'no_supabase_user' },
    });
    return new Response(
      consentConfigErrorHtml(
        'Could not prepare Supabase session',
        'Your account email could not be matched to Supabase Auth (check SUPABASE_SERVICE_ROLE_KEY).',
      ),
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
    );
  }
  if (bridge.error === 'jwt_mint_invalid') {
    await logAuthEvent(env, {
      request,
      eventType: 'oauth_consent_error',
      userId: iamUser.id,
      status: 'fail',
      metadata: { reason: 'jwt_mint_invalid' },
    });
    return new Response(
      consentConfigErrorHtml(
        'Consent bridge rejected',
        'Signed token was not accepted by Supabase Auth. Confirm JWT settings match this project (signing algorithm / SUPABASE_JWT_SECRET).',
      ),
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
    );
  }

  const bearer = bridge.bearer;

  if (request.method === 'POST') {
    const action = postAction;
    if (!action) {
      return new Response(consentMissingRequestHtml(), {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    const dec = await postConsentDecision(env, bearer, authorizationId, action);
    const redir = dec.json?.redirect_url;
    const safeLog = redir ? safeRedirectLog(redir) : { host: '', pathname: '' };

    await logAuthEvent(env, {
      request,
      eventType: 'oauth_consent_submit',
      userId: iamUser.id,
      status: dec.ok ? 'ok' : 'fail',
      metadata: {
        decision: action,
        next_redirect_host: safeLog.host,
        next_redirect_path: safeLog.pathname,
        authorization_id_tail: authTail,
      },
    });

    if (dec.ok && redir) {
      await logAuthEvent(env, {
        request,
        eventType: action === 'approve' ? 'oauth_consent_approved' : 'oauth_consent_denied',
        userId: iamUser.id,
        metadata: { authorization_id_tail: authTail },
      });
      return Response.redirect(redir, 302);
    }

    await logAuthEvent(env, {
      request,
      eventType: 'oauth_consent_error',
      userId: iamUser.id,
      status: 'fail',
      metadata: { phase: 'post_consent', authorization_id_tail: authTail },
    });

    const msg =
      dec.json?.msg ||
      dec.json?.error_description ||
      dec.json?.error ||
      `Consent request failed (${dec.status}).`;
    const detail = await fetchAuthorizationDetails(env, bearer, authorizationId);
    const j = detail.json || {};
    const clientName = j.client?.name || j.client?.Client?.name;
    const redirectUri = j.redirect_uri || '';
    const scopes = j.scope || '';
    return new Response(
      consentPageHtml({
        authorizationId,
        clientName: clientName || 'OAuth client',
        redirectUri: redirectUri || '',
        scopes,
        signedInEmail: iamUser.email || '',
        workspaceLabel,
        errorMessage: typeof msg === 'string' ? msg : String(msg),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      },
    );
  }

  const detail = await fetchAuthorizationDetails(env, bearer, authorizationId);

  if (detail.json?.redirect_url) {
    const redir = detail.json.redirect_url;
    const safeLog = safeRedirectLog(redir);
    await logAuthEvent(env, {
      request,
      eventType: 'oauth_consent_auto_redirect',
      userId: iamUser.id,
      metadata: {
        authorization_id_tail: authTail,
        next_redirect_host: safeLog.host,
        next_redirect_path: safeLog.pathname,
      },
    });
    return Response.redirect(redir, 302);
  }

  const loaded = detail.ok && !!detail.json?.authorization_id;
  const clientName = detail.json?.client?.name || '';
  const scopes = detail.json?.scope || '';
  const redirectUri = detail.json?.redirect_uri || '';

  await logAuthEvent(env, {
    request,
    eventType: 'oauth_consent_details',
    userId: iamUser.id,
    metadata: {
      authorization_id_tail: authTail,
      consent_details_loaded: loaded,
      client_name: clientName || null,
      scopes: scopes || null,
      email_domain: domain,
    },
  });

  if (!detail.ok || !loaded) {
    const errMsg =
      detail.json?.msg ||
      detail.json?.error_description ||
      detail.json?.error ||
      `Could not load authorization (${detail.status}).`;
    return new Response(
      consentPageHtml({
        authorizationId,
        clientName: '',
        redirectUri: '',
        scopes: '',
        signedInEmail: iamUser.email || '',
        workspaceLabel,
        errorMessage: typeof errMsg === 'string' ? errMsg : String(errMsg),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      },
    );
  }

  await logAuthEvent(env, {
    request,
    eventType: 'oauth_consent_viewed',
    userId: iamUser.id,
    metadata: { authorization_id_tail: authTail },
  });

  return new Response(
    consentPageHtml({
      authorizationId,
      clientName,
      redirectUri,
      scopes,
      signedInEmail: iamUser.email || '',
      workspaceLabel,
      errorMessage: '',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    },
  );
}

/** Stable API-layer re-export; implementation belongs to the core identity plane. */
export { resolveCanonicalUserId } from '../../backend/identity/users/index.js';

/** True when value is an auth_users.id prefix (does not hit D1). */
export function isAuthUserId(userId) {
  return userId != null && String(userId).trim().startsWith('au_');
}
