/**
 * Login OAuth callbacks (Google / GitHub) — parity with worker.js
 * handleGoogleOAuthCallback / handleGitHubOAuthCallback.
 *
 * Integration OAuth stays in oauth.js (oauth_state_* + user_id payload).
 */
import { appendBrowserLoginSessionCookies } from '../core/auth.js';
import { getAuthUser } from '../../backend/identity/resolve-identity.js';
import {
  finalizeInboundOAuth,
  oauthPostLoginGlobeRedirectUrl,
  revokeIncomingCookieSession,
  safeDashboardLoginRedirectPath,
} from '../../backend/identity/oauth-finalize.js';
import { oauthPopupCompleteHtml } from '../core/oauth-popup-complete.js';
import { upsertOauthToken } from '../../backend/identity/oauth/token-store.js';
import { resolveIntegrationUserId } from '../../backend/identity/oauth/integration-user-id.js';
import { resolveCanonicalWorkspace } from './oauth.js';

function oauthOrigin(url) {
  return url.origin || 'https://inneranimalmedia.com';
}

/** @deprecated Import appendBrowserLoginSessionCookies from ../core/auth.js */
export { appendBrowserLoginSessionCookies } from '../core/auth.js';

/** @deprecated Import from backend/identity/oauth-finalize.js */
export {
  finalizeInboundOAuth,
  oauthPostLoginGlobeRedirectUrl,
  revokeIncomingCookieSession,
  safeDashboardLoginRedirectPath,
} from '../../backend/identity/oauth-finalize.js';

// DEPRECATED: use canonical work_session INSERT pattern with the real browser session id.
// See finalizeInboundOAuth(...) Phase 2A implementation.
export async function autoStartWorkSession(env, userId, tenantId, pageContext) {
  if (!env?.DB) return null;
  const sessionId = 'ws_' + String(userId || '').slice(-8) + '_' + Date.now();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO work_sessions
      (session_id, tenant_id, started_at, last_activity_at,
       total_active_seconds, project_context, page_context, auto_paused)
    VALUES (?, ?, datetime('now'), datetime('now'), 0, 'inneranimalmedia', ?, 0)
  `).bind(sessionId, tenantId, pageContext || '/dashboard/agent').run().catch(() => {});
  return sessionId;
}

function googleClientSecret(env) {
  return env.GOOGLE_OAUTH_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET || '';
}

/**
 * GitHub login callback — parity with worker.js handleGitHubOAuthCallback.
 * @param {object} [options]
 * @param {string} [options.cachedRedirect] — if set, KV get/delete for github state was already done (e.g. /api/oauth/github/callback dispatch).
 */
export async function handleGitHubLoginOAuthCallback(request, url, env, options = {}) {
  const { cachedRedirect: injected } = options;
  const { searchParams } = url;
  const state = searchParams.get('state');
  const code = searchParams.get('code');
  if (!state || !code || !env.SESSION_CACHE || !env.DB) {
    return Response.redirect(`${oauthOrigin(url)}/auth/login?error=missing`, 302);
  }

  let cachedRedirect = injected;
  if (cachedRedirect === undefined) {
    cachedRedirect = await env.SESSION_CACHE.get(`oauth_state_github_${state}`);
    await env.SESSION_CACHE.delete(`oauth_state_github_${state}`);
  }
  if (!cachedRedirect) {
    return Response.redirect(`${oauthOrigin(url)}/auth/login?error=invalid_state`, 302);
  }

  let redirectUri = cachedRedirect;
  let returnTo = `${oauthOrigin(url)}/dashboard/agent`;
  let connectGitHub = false;
  try {
    const parsed = JSON.parse(cachedRedirect);
    if (parsed.redirectUri) redirectUri = parsed.redirectUri;
    if (parsed.returnTo && parsed.returnTo.startsWith('/')) returnTo = `${oauthOrigin(url)}${parsed.returnTo}`;
    if (parsed.connectGitHub) connectGitHub = true;
  } catch (_) {
    /* legacy string stored as redirectUri only */
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    return Response.redirect(`${oauthOrigin(url)}/auth/login?error=token_failed`, 302);
  }
  const tokens = await tokenRes.json();
  if (tokens.error) {
    return Response.redirect(`${oauthOrigin(url)}/auth/login?error=token_failed`, 302);
  }
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'User-Agent': 'InnerAnimalMedia-Dashboard/1.0',
    },
  });
  if (!userRes.ok) {
    return Response.redirect(`${oauthOrigin(url)}/auth/login?error=userinfo_failed`, 302);
  }
  const userInfo = await userRes.json();
  let email = userInfo.email;
  if (!email && userInfo.login) {
    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'User-Agent': 'InnerAnimalMedia-Dashboard/1.0',
      },
    });
    if (emailRes.ok) {
      const emails = await emailRes.json();
      const primary = emails.find((e) => e.primary) || emails[0];
      email = primary?.email;
    }
  }
  const oauthEmail = String(email || userInfo.login || 'unknown').toLowerCase().trim();
  const name = userInfo.name || userInfo.login || oauthEmail;

  if (connectGitHub) {
    const sessionUser = await getAuthUser(request, env);
    if (!sessionUser) {
      return Response.redirect(`${url.origin}/auth/login?error=session_required`, 302);
    }
    const ghUserId = await resolveIntegrationUserId(env, sessionUser);
    if (!ghUserId) {
      return Response.redirect(`${url.origin}/auth/login?error=session_required`, 302);
    }
    const ghLogin = (userInfo.login || '').toString() || 'github';
    if (tokens.access_token && env.DB) {
      try {
        await upsertOauthToken(env, {
          user_id: ghUserId,
          tenant_id: sessionUser.tenant_id ?? sessionUser.active_tenant_id ?? null,
          provider: 'github',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? null,
          scope: (tokens.scope || '').toString() || null,
          expires_at: tokens.expires_in
            ? Math.floor(Date.now() / 1000) + Number(tokens.expires_in)
            : null,
          account_identifier: ghLogin,
          account_email: email ?? null,
          account_display: name ?? null,
          workspace_id:
            sessionUser?.active_workspace_id ||
            sessionUser?.default_workspace_id ||
            null,
          metadata_json: null,
        }, { skipRegistry: true });
      } catch (e) {
        console.error('[oauth/github/callback] user_oauth_tokens upsert failed:', e?.message ?? e);
      }
    }
    // Connect-from-session: prefer redirect to returnTo (top-level Files Connect).
    // Popup HTML only when opener can close; always include returnTo fallback.
    return new Response(oauthPopupCompleteHtml('github', { returnTo }), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const ghSubject = String(userInfo.id ?? userInfo.sub ?? oauthEmail).trim();
  const finalizedGh = await finalizeInboundOAuth(env, request, {
    provider: 'github',
    email: oauthEmail,
    name,
    providerUid: ghSubject,
    source: 'github_oauth',
    pageContext: url.pathname,
  });
  if (!finalizedGh.ok) {
    return Response.redirect(
      `${oauthOrigin(url)}/auth/login?error=${finalizedGh.error}`,
      302,
    );
  }
  const { authUserId: userId, sessionId, sessionToken, tenantId: tidGh } = finalizedGh;
  const workspaceId = await resolveCanonicalWorkspace(env, userId);
  const ghLogin = (userInfo.login || '').toString() || 'github';
  if (tokens.access_token && env.DB) {
    try {
      await upsertOauthToken(env, {
        user_id: userId,
        tenant_id: tidGh ?? null,
        provider: 'github',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        scope: (tokens.scope || '').toString() || null,
        expires_at: tokens.expires_in
          ? Math.floor(Date.now() / 1000) + Number(tokens.expires_in)
          : null,
        account_identifier: ghLogin,
        account_email: oauthEmail ?? null,
        account_display: name ?? null,
        workspace_id: workspaceId || null,
        metadata_json: null,
      }, { skipRegistry: true });
    } catch (e) {
      console.error('[oauth/github/callback] user_oauth_tokens upsert failed:', e?.message ?? e);
    }
  }
  const loginHeaders = new Headers({
    Location: oauthPostLoginGlobeRedirectUrl(oauthOrigin(url), returnTo),
  });

  appendBrowserLoginSessionCookies(loginHeaders, sessionToken);

  return new Response(null, { status: 302, headers: loginHeaders });
}

/**
 * Google login callback — parity with worker.js handleGoogleOAuthCallback.
 * @param {object} [options]
 * @param {string} [options.cachedRedirect] — raw KV payload when get/delete already ran (e.g. /api/oauth/google/callback non-integration path).
 */
export async function handleGoogleLoginOAuthCallback(request, url, env, options = {}) {
  const { cachedRedirect: injected } = options;
  const { searchParams } = url;
  const state = searchParams.get('state');
  const code = searchParams.get('code');
  if (!state || !code || !env.SESSION_CACHE || !env.DB) {
    return Response.redirect(`${oauthOrigin(url)}/auth/login?error=missing`, 302);
  }

  let cachedRedirect = injected;
  if (cachedRedirect === undefined) {
    cachedRedirect = await env.SESSION_CACHE.get(`oauth_state_${state}`);
    await env.SESSION_CACHE.delete(`oauth_state_${state}`);
  }
  if (!cachedRedirect) {
    return Response.redirect(`${oauthOrigin(url)}/auth/login?error=invalid_state`, 302);
  }

  let redirectUri = cachedRedirect;
  let returnTo = `${oauthOrigin(url)}/dashboard/agent`;
  let connectDrive = false;
  try {
    const parsed = JSON.parse(cachedRedirect);
    if (parsed.user_id && !parsed.redirectUri) {
      return Response.redirect(`${oauthOrigin(url)}/auth/login?error=invalid_state`, 302);
    }
    if (parsed.redirectUri) redirectUri = parsed.redirectUri;
    if (parsed.returnTo && parsed.returnTo.startsWith('/')) returnTo = `${oauthOrigin(url)}${parsed.returnTo}`;
    if (parsed.connectDrive) connectDrive = true;
  } catch (_) {
    returnTo = `${oauthOrigin(url)}/dashboard/agent`;
  }

  const clientSecret = googleClientSecret(env);
  if (!clientSecret || !env.GOOGLE_CLIENT_ID) {
    return Response.redirect(
      `${oauthOrigin(url)}/auth/login?error=token_failed&reason=invalid_client&hint=secret_or_id_not_configured`,
      302,
    );
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    let reason = 'unknown';
    try {
      const errJson = JSON.parse(errBody);
      const errCode = (errJson.error || '').toString().toLowerCase();
      const allowed = [
        'invalid_grant',
        'invalid_client',
        'invalid_request',
        'unauthorized_client',
        'unsupported_grant_type',
        'invalid_scope',
      ];
      if (allowed.includes(errCode)) reason = errCode;
    } catch (_) {
      /* ignore */
    }
    return Response.redirect(`${oauthOrigin(url)}/auth/login?error=token_failed&reason=${encodeURIComponent(reason)}`, 302);
  }
  const tokens = await tokenRes.json();
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) {
    return Response.redirect(`${oauthOrigin(url)}/auth/login?error=userinfo_failed`, 302);
  }
  const userInfo = await userRes.json();
  const oauthEmail = String(userInfo.email || '').toLowerCase().trim();
  const name = userInfo.name || oauthEmail || 'User';
  if (!oauthEmail) {
    return Response.redirect(`${oauthOrigin(url)}/auth/login?error=no_email`, 302);
  }

  if (connectDrive) {
    const sessionUser = await getAuthUser(request, env);
    if (!sessionUser) {
      return Response.redirect(`${oauthOrigin(url)}/auth/login?error=session_required`, 302);
    }
    /** Match `integrationUserId` / `oauthTokenUserKey`: rows keyed by `auth_users.id`, not email. */
    const driveUserId =
      sessionUser?.id != null && String(sessionUser.id).trim() !== ''
        ? String(sessionUser.id).trim()
        : String(sessionUser.email || '').trim();
    const driveTenantId = sessionUser?.tenant_id || env.TENANT_ID;
    await upsertOauthToken(env, {
      user_id: driveUserId,
      tenant_id: driveTenantId,
      provider: 'google_drive',
      account_identifier: '',
      account_email: oauthEmail,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expires_at: tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : null,
      scope: tokens.scope ?? null,
    });
    await env.DB.prepare(
      `INSERT INTO integration_registry (
         id, tenant_id, provider_key, display_name, category, auth_type, status,
         account_display, sort_order, updated_at
       ) VALUES (?, ?, 'google_drive', 'Google Drive', 'storage', 'oauth2', 'connected',
         ?, 20, datetime('now'))
       ON CONFLICT(tenant_id, provider_key) DO UPDATE SET
         status = 'connected',
         account_display = COALESCE(excluded.account_display, integration_registry.account_display),
         updated_at = datetime('now')`,
    )
      .bind(
        `int_gdrive_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        driveTenantId,
        oauthEmail || null,
      )
      .run();
    return new Response(oauthPopupCompleteHtml('google_drive'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const goSubject = String(userInfo.id ?? userInfo.sub ?? oauthEmail).trim();
  const finalizedGo = await finalizeInboundOAuth(env, request, {
    provider: 'google',
    email: oauthEmail,
    name,
    providerUid: goSubject,
    source: 'google_oauth',
    pageContext: url.pathname,
  });
  if (!finalizedGo.ok) {
    return Response.redirect(
      `${oauthOrigin(url)}/auth/login?error=${finalizedGo.error}`,
      302,
    );
  }
  const { sessionToken } = finalizedGo;

  const safeDest = safeDashboardLoginRedirectPath(oauthOrigin(url), returnTo);
  const headers = new Headers({
    Location: oauthPostLoginGlobeRedirectUrl(oauthOrigin(url), `${oauthOrigin(url)}${safeDest}`),
  });

  appendBrowserLoginSessionCookies(headers, sessionToken);

  return new Response(null, { status: 302, headers });
}
