/**
 * Identity OAuth consent UI — customer apps ("Sign in with Inner Animal Media").
 * Reuses the MCP consent shell (same HTML/CSS pattern as mcp-oauth-consent.js) but
 * scopes are OIDC (openid profile email) and approve/deny delegates to
 * backend/identity/identity-oauth-provider.js (oauth_identity_tokens path).
 */
import { getAuthUser } from '../core/auth.js';
import { logAuthEvent } from '../../backend/identity/auth-events.js';
import { mcpOAuthNow } from '../../shared/oauth-crypto.js';
import { identityConsentDecision } from '../../backend/identity/identity-oauth-provider.js';
import {
  issueMcpConsentCsrf,
  verifyMcpConsentCsrf,
  consumeMcpConsentCsrf,
  MCP_CONSENT_CSRF_COOKIE_NAME,
} from './mcp-oauth-consent-csrf.js';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scopeLabel(scope) {
  const map = {
    openid: 'Verify your identity (OpenID Connect)',
    profile: 'Read your name and basic profile',
    email: 'Read your email address',
  };
  return map[scope] || scope;
}

function parseIdentityAuthorizationMetadata(metadataJson) {
  try {
    return JSON.parse(metadataJson || '{}');
  } catch {
    return {};
  }
}

export function isIdentityAuthorizationRow(row) {
  const meta = parseIdentityAuthorizationMetadata(row?.metadata_json);
  return meta.path === 'identity';
}

async function loadIdentityAuthorization(env, authorizationId, userId) {
  const row = await env.DB.prepare(
    `SELECT a.*, c.display_name AS client_display_name, c.logo_url AS client_logo_url,
            c.name AS client_name, c.homepage_url AS client_homepage_url
       FROM oauth_authorizations a
       LEFT JOIN oauth_clients c ON c.client_id = a.client_id
      WHERE a.id = ?
      LIMIT 1`,
  )
    .bind(authorizationId)
    .first();
  if (!row) return { ok: false, error: 'not_found' };
  if (!isIdentityAuthorizationRow(row)) return { ok: false, error: 'not_identity_authorization' };
  if (userId && String(row.user_id) !== String(userId)) return { ok: false, error: 'forbidden' };
  if (row.status !== 'pending') return { ok: false, error: 'not_pending', row };
  if (Number(row.expires_at || 0) <= mcpOAuthNow()) {
    await env.DB.prepare(
      `UPDATE oauth_authorizations SET status = 'expired', updated_at = unixepoch() WHERE id = ?`,
    )
      .bind(authorizationId)
      .run()
      .catch(() => {});
    return { ok: false, error: 'expired', row };
  }
  return { ok: true, row };
}

function identityConsentHtml(opts) {
  const {
    authorizationId,
    clientName,
    clientLogoUrl,
    redirectUri,
    scopes,
    signedInEmail,
    errorMessage,
    consentCsrf,
  } = opts;
  const scopeItems = (scopes || [])
    .map((s) => `<li>${escapeHtml(scopeLabel(s))}</li>`)
    .join('');
  const errBlock = errorMessage
    ? `<div role="alert" style="background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.35);color:#fecaca;padding:12px 14px;border-radius:10px;font-size:14px;margin-bottom:16px">${escapeHtml(errorMessage)}</div>`
    : '';
  const logoBlock = clientLogoUrl
    ? `<img src="${escapeHtml(clientLogoUrl)}" alt="" width="40" height="40" style="border-radius:10px;object-fit:cover"/>`
    : `<div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#38bdf8,#22c55e);display:flex;align-items:center;justify-content:center;font-weight:800">◆</div>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Sign in with Inner Animal Media</title>
<style>
:root{--bg:#0b1220;--card:#0f172a;--line:#1e293b;--text:#f1f5f9;--muted:#94a3b8;--accent:#38bdf8;--accent2:#22c55e;--btn-no:#475569}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:radial-gradient(900px 500px at 80% -20%,rgba(56,189,248,.25),transparent 50%),var(--bg);color:var(--text);min-height:100vh;}
.shell{max-width:520px;margin:0 auto;padding:32px 20px 48px;}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.02em;font-size:20px;margin-bottom:28px}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px;box-shadow:0 28px 100px rgba(0,0,0,.5);}
.client-row{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.client{font-size:18px;font-weight:700;margin:0;line-height:1.3}
.sub{color:var(--muted);font-size:15px;line-height:1.5;margin:0 0 20px}
.user{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:14px;background:#020617;border:1px solid var(--line);margin-bottom:20px}
.section-title{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:700;margin:0 0 10px}
ul{margin:0;padding-left:20px;color:var(--muted);font-size:14px;line-height:1.6}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
button{flex:1;min-width:120px;padding:13px 16px;border-radius:12px;font-weight:700;font-size:15px;border:none;cursor:pointer}
.btn-cancel{background:var(--btn-no);color:var(--text)}
.btn-ok{background:linear-gradient(135deg,var(--accent2),#16a34a);color:#052e16}
</style></head>
<body><div class="shell"><div class="logo">◆ Inner Animal Media</div>
<div class="card">${errBlock}
<div class="client-row">${logoBlock}<div><p class="client">${escapeHtml(clientName || 'Application')}</p><p class="sub" style="margin:0">wants to sign you in with your Inner Animal Media account</p></div></div>
<div class="user"><strong>${escapeHtml(signedInEmail || '')}</strong></div>
<p class="section-title">This app will be able to</p>
<ul>${scopeItems || '<li>Verify your identity</li>'}</ul>
<form method="post" action="/api/oauth/identity/consent">
  <input type="hidden" name="authorization_id" value="${escapeHtml(authorizationId)}"/>
  <input type="hidden" name="consent_csrf" value="${escapeHtml(consentCsrf || '')}"/>
  <div class="actions">
    <button type="submit" name="_action" value="deny" class="btn-cancel" formnovalidate>Decline</button>
    <button type="submit" name="_action" value="approve" class="btn-ok">Continue</button>
  </div>
</form>
<p style="font-size:12px;color:var(--muted);word-break:break-all;margin-top:16px">Redirect: ${escapeHtml(redirectUri || '')}</p>
</div></div></body></html>`;
}

async function parseConsentBody(request, url) {
  if (request.method === 'GET') {
    return {
      authorizationId: url.searchParams.get('authorization_id')?.trim() || '',
      action: '',
      consentCsrf: '',
    };
  }
  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    const j = await request.json().catch(() => ({}));
    const a = String(j.decision || j.action || '').toLowerCase();
    return {
      authorizationId: String(j.authorization_id || '').trim(),
      action: a === 'approve' || a === 'deny' ? a : '',
      consentCsrf: String(j.consent_csrf || j.consentCsrf || '').trim(),
    };
  }
  const fd = await request.formData().catch(() => null);
  if (fd) {
    const raw = String(fd.get('_action') || fd.get('decision') || '').toLowerCase();
    return {
      authorizationId: String(fd.get('authorization_id') || '').trim(),
      action: raw === 'approve' || raw === 'deny' ? raw : '',
      consentCsrf: String(fd.get('consent_csrf') || '').trim(),
    };
  }
  return { authorizationId: '', action: '', consentCsrf: '' };
}

export async function handleIdentityOAuthConsentPage(request, env) {
  const url = new URL(request.url);
  const { authorizationId, action, consentCsrf } = await parseConsentBody(request, url);

  if (!authorizationId || !authorizationId.startsWith('oaa_')) {
    return new Response('Invalid authorization id', { status: 400 });
  }

  const iamUser = await getAuthUser(request, env);
  if (!iamUser) {
    const q = new URLSearchParams();
    q.set('next', `/api/oauth/identity/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
    return Response.redirect(`${url.origin}/auth/login?${q.toString()}`, 302);
  }

  const wantsJson =
    String(request.headers.get('Accept') || '').includes('application/json') ||
    String(request.headers.get('Content-Type') || '').includes('application/json');

  if (request.method === 'POST' && action) {
    const csrfCheck = await verifyMcpConsentCsrf(request, env, {
      authorizationId,
      userId: iamUser.id,
      bodyToken: consentCsrf,
    });
    if (!csrfCheck.ok) {
      await logAuthEvent(env, {
        request,
        eventType: 'iam_identity_oauth_consent_csrf_rejected',
        userId: iamUser.id,
        status: 'fail',
        metadata: { authorization_id: authorizationId, error: csrfCheck.error },
      });
      return new Response('CSRF validation failed', { status: 403 });
    }

    const decisionReq = new Request(url.origin + '/api/oauth/identity/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authorization_id: authorizationId,
        decision: action,
      }),
    });
    const result = await identityConsentDecision(decisionReq, env, iamUser);
    const data = await result.json().catch(() => ({}));

    await logAuthEvent(env, {
      request,
      eventType: action === 'approve' ? 'iam_identity_oauth_consent_approved' : 'iam_identity_oauth_consent_denied',
      userId: iamUser.id,
      metadata: { authorization_id: authorizationId, ok: data?.ok },
    });

    await consumeMcpConsentCsrf(env, authorizationId);

    if (!data?.ok || !data?.redirect) {
      const loaded = await loadIdentityAuthorization(env, authorizationId, iamUser.id);
      const html = identityConsentHtml({
        authorizationId,
        clientName: loaded.row?.client_display_name || loaded.row?.client_id,
        clientLogoUrl: loaded.row?.client_logo_url,
        redirectUri: loaded.row?.redirect_uri,
        scopes: String(loaded.row?.scope || '').split(/\s+/).filter(Boolean),
        signedInEmail: iamUser.email,
        errorMessage: data?.error || 'consent_failed',
        consentCsrf: '',
      });
      return new Response(html, {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    if (wantsJson) {
      return Response.json({ ok: true, redirect: data.redirect });
    }
    return Response.redirect(data.redirect, 302);
  }

  const loaded = await loadIdentityAuthorization(env, authorizationId, iamUser.id);
  if (!loaded.ok) {
    const msg =
      loaded.error === 'not_identity_authorization'
        ? 'This authorization is not for Sign in with Inner Animal Media.'
        : loaded.error === 'expired'
          ? 'This sign-in request has expired. Start again from the application.'
          : 'Authorization request not found.';
    return new Response(
      identityConsentHtml({
        authorizationId,
        clientName: 'Application',
        redirectUri: '',
        scopes: [],
        signedInEmail: iamUser.email,
        errorMessage: msg,
        consentCsrf: '',
      }),
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
    );
  }

  const csrf = await issueMcpConsentCsrf(env, {
    authorizationId,
    userId: iamUser.id,
  });

  await logAuthEvent(env, {
    request,
    eventType: 'iam_identity_oauth_consent_viewed',
    userId: iamUser.id,
    metadata: { authorization_id: authorizationId },
  });

  const html = identityConsentHtml({
    authorizationId,
    clientName: loaded.row.client_display_name || loaded.row.client_name || loaded.row.client_id,
    clientLogoUrl: loaded.row.client_logo_url,
    redirectUri: loaded.row.redirect_uri,
    scopes: String(loaded.row.scope || '').split(/\s+/).filter(Boolean),
    signedInEmail: iamUser.email,
    errorMessage: '',
    consentCsrf: csrf.token,
  });

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': csrf.setCookie,
    },
  });
}

export { MCP_CONSENT_CSRF_COOKIE_NAME as IDENTITY_CONSENT_CSRF_COOKIE } from './mcp-oauth-consent-csrf.js';
