/**
 * IAM-native MCP OAuth consent (D1 oauth_authorizations + oauth_clients).
 * Supabase OAuth Server consent stays in auth.js handleOAuthConsentPage.
 */
import { getAuthUser, jsonResponse } from '../core/auth.js';
import { logAuthEvent } from '../../backend/identity/auth-events.js';
import {
  mcpOAuthNow,
  mcpOAuthSha256Hex,
  mcpOAuthRandomToken,
  mcpOAuthJsonError,
  mcpOAuthLoadClient,
  mcpOAuthParseScopeList,
  mcpOAuthScopeAllowed,
  MCP_OAUTH_CODE_TTL_SECONDS,
  resolveMcpConnectingApp,
  loadMcpOAuthConsentToolManifest,
  MCP_CANONICAL_CLIENT_ID,
} from './mcp-oauth-shared.js';
import {
  issueMcpConsentCsrf,
  verifyMcpConsentCsrf,
  consumeMcpConsentCsrf,
  MCP_CONSENT_CSRF_COOKIE_NAME,
} from './mcp-oauth-consent-csrf.js';

export function isIamMcpAuthorizationId(id) {
  return String(id || '').trim().startsWith('oaa_');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scopeLabel(scope) {
  const map = {
    'iam:profile': 'Read your profile and account identity',
    'iam:workspaces': 'Read workspace membership and metadata',
    'iam:agent': 'Use Agent Sam capabilities in the selected workspace',
    'mcp:tools': 'Invoke approved MCP tools',
    'mcp:userinfo': 'Read OAuth userinfo for connected clients',
  };
  return map[scope] || scope;
}

async function listUserWorkspaces(env, userId) {
  if (!env.DB || !userId) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT w.id, w.name, w.handle, w.domain
         FROM workspace_members wm
         JOIN workspaces w ON w.id = wm.workspace_id
        WHERE wm.user_id = ?
          AND COALESCE(wm.is_active, 1) = 1
        ORDER BY COALESCE(wm.joined_at, wm.created_at) ASC`,
    )
      .bind(userId)
      .all();
    return (results || []).map((r) => ({
      id: String(r.id),
      name: String(r.name || r.id),
      subtitle: r.handle ? String(r.handle) : r.domain ? String(r.domain) : undefined,
    }));
  } catch {
    return [];
  }
}

async function loadAuthorization(env, authorizationId, userId) {
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

function iamMcpConsentHtml(opts) {
  const {
    authorizationId,
    clientName,
    redirectUri,
    connectingApp,
    scopes,
    signedInEmail,
    errorMessage,
  } = opts;
  const app = connectingApp || resolveMcpConnectingApp(redirectUri);
  const scopeItems = (scopes || [])
    .map((s) => `<li>${escapeHtml(scopeLabel(s))}</li>`)
    .join('');
  const errBlock = errorMessage
    ? `<div role="alert" style="background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.35);color:#fecaca;padding:12px 14px;border-radius:10px;font-size:14px;margin-bottom:16px">${escapeHtml(errorMessage)}</div>`
    : '';
  const safeNext = `/api/auth/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Authorize MCP access · Inner Animal Media</title>
<style>
:root{--bg:#0b1220;--card:#0f172a;--line:#1e293b;--text:#f1f5f9;--muted:#94a3b8;--accent:#38bdf8;--accent2:#22c55e;--btn-no:#475569}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:radial-gradient(900px 500px at 80% -20%,rgba(56,189,248,.25),transparent 50%),var(--bg);color:var(--text);min-height:100vh;}
.shell{max-width:520px;margin:0 auto;padding:32px 20px 48px;}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.02em;font-size:20px;margin-bottom:28px}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px;box-shadow:0 28px 100px rgba(0,0,0,.5);}
.client{font-size:18px;font-weight:700;margin:0 0 6px;line-height:1.3}
.sub{color:var(--muted);font-size:15px;line-height:1.5;margin:0 0 20px}
.user{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:14px;background:#020617;border:1px solid var(--line);margin-bottom:20px}
.section-title{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:700;margin:0 0 10px}
ul{margin:0;padding-left:20px;color:var(--muted);font-size:14px;line-height:1.6}
label{display:block;font-size:13px;color:var(--muted);margin-bottom:8px}
select{width:100%;padding:12px;border-radius:12px;border:1px solid var(--line);background:#020617;color:var(--text);font-size:15px;margin-bottom:20px}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
button{flex:1;min-width:120px;padding:13px 16px;border-radius:12px;font-weight:700;font-size:15px;border:none;cursor:pointer}
.btn-cancel{background:var(--btn-no);color:var(--text)}
.btn-ok{background:linear-gradient(135deg,var(--accent2),#16a34a);color:#052e16}
</style></head>
<body><div class="shell"><div class="logo">◆ Inner Animal Media</div>
<div class="card">${errBlock}
<p class="sub" style="margin-top:0;padding:10px 12px;border-radius:10px;border-left:4px solid ${escapeHtml(app.accent)};background:rgba(255,255,255,.04)"><strong>Connecting from ${escapeHtml(app.label)}</strong><br/>${escapeHtml(app.tagline)}</p>
<p class="sub"><strong class="client">${escapeHtml(clientName || 'MCP client')}</strong> is requesting API access to your workspace via MCP OAuth.</p>
<div class="user"><strong>${escapeHtml(signedInEmail || '')}</strong></div>
<p class="section-title">Permissions</p>
<ul>${scopeItems || '<li>Standard MCP access</li>'}</ul>
<form method="post" action="/api/auth/oauth/consent/approve">
  <input type="hidden" name="authorization_id" value="${escapeHtml(authorizationId)}"/>
  <div class="actions">
    <button type="submit" formaction="/api/auth/oauth/consent/deny" class="btn-cancel" formnovalidate>Decline</button>
    <button type="submit" class="btn-ok">Authorize</button>
  </div>
</form>
<p style="margin-top:16px;font-size:13px;color:var(--muted)"><a href="${escapeHtml(safeNext)}" style="color:var(--accent)">Refresh</a></p>
<p style="font-size:12px;color:var(--muted);word-break:break-all">Redirect: ${escapeHtml(redirectUri || '')}</p>
</div></div></body></html>`;
}

async function parseConsentBody(request, url) {
  const pathAction = String(url.searchParams.get('_consent_action') || '').toLowerCase();
  if (request.method === 'GET') {
    return {
      authorizationId: url.searchParams.get('authorization_id')?.trim() || '',
      action: pathAction === 'approve' || pathAction === 'deny' ? pathAction : '',
    };
  }
  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    const j = await request.json().catch(() => ({}));
    const a = String(j.action || '').toLowerCase();
    return {
      authorizationId: String(j.authorization_id || '').trim(),
      action: a === 'approve' || a === 'deny' ? a : pathAction,
      consentCsrf: String(j.consent_csrf || j.consentCsrf || '').trim(),
      toolPreferences:
        j.tool_preferences && typeof j.tool_preferences === 'object' ? j.tool_preferences : null,
      reviewToolsExpanded: Boolean(j.review_tools_expanded),
    };
  }
  const fd = await request.formData().catch(() => null);
  if (fd) {
    const raw = String(fd.get('_action') || '').toLowerCase();
    return {
      authorizationId: String(fd.get('authorization_id') || '').trim(),
      action: raw === 'approve' || raw === 'deny' ? raw : pathAction,
      consentCsrf: String(fd.get('consent_csrf') || '').trim(),
    };
  }
  return { authorizationId: '', action: pathAction, consentCsrf: '' };
}

/**
 * Reject consent POST when CSRF cookie/body/KV binding fails (no redirect).
 */
async function rejectMcpConsentCsrf(request, env, iamUser, authorizationId, csrfError) {
  await logAuthEvent(env, {
    request,
    eventType: 'iam_mcp_oauth_consent_csrf_rejected',
    userId: iamUser?.id,
    status: 'fail',
    metadata: {
      authorization_id: authorizationId,
      error: csrfError,
      cookie_name: MCP_CONSENT_CSRF_COOKIE_NAME,
    },
  });
  return mcpOAuthJsonError('csrf_invalid', 403, { reason: csrfError });
}

/** CSRF check runs in handleIamMcpOAuthConsentPage before approve/deny (see POST block). */
export { MCP_CONSENT_CSRF_COOKIE_NAME as MCP_CONSENT_CSRF_COOKIE } from './mcp-oauth-consent-csrf.js';

export async function handleIamMcpOAuthConsentApi(request, env) {
  const url = new URL(request.url);
  const authorizationId = url.searchParams.get('authorization_id')?.trim() || '';
  if (!isIamMcpAuthorizationId(authorizationId)) {
    return mcpOAuthJsonError('invalid_authorization_id', 400);
  }
  const iamUser = await getAuthUser(request, env);
  if (!iamUser) return mcpOAuthJsonError('unauthorized', 401);

  const loaded = await loadAuthorization(env, authorizationId, iamUser.id);
  if (!loaded.ok) {
    const code =
      loaded.error === 'forbidden' ? 403 : loaded.error === 'expired' ? 410 : 404;
    return mcpOAuthJsonError(loaded.error, code);
  }

  const row = loaded.row;
  const scopes = mcpOAuthParseScopeList(row.scope);
  const client = await mcpOAuthLoadClient(env, row.client_id);
  const toolManifest = await loadMcpOAuthConsentToolManifest(env, {
    userId: iamUser.id,
    workspaceId: String(row.workspace_id || '').trim(),
    tenantId: String(row.tenant_id || iamUser.tenant_id || '').trim(),
    clientId: row.client_id,
    clientDisplayName: client?.display_name || client?.name || row.client_display_name || row.client_id,
    grantedScopes: scopes,
  });

  const csrf = await issueMcpConsentCsrf(env, {
    authorizationId,
    userId: iamUser.id,
  });

  const res = jsonResponse({
    authorization_id: row.id,
    status: row.status,
    consent_csrf: csrf.token,
    client: {
      client_id: row.client_id,
      display_name: client?.display_name || client?.name || row.client_display_name || row.client_id,
      name: client?.display_name || client?.name || row.client_display_name || row.client_id,
      logo_url: client?.logo_url || row.client_logo_url || null,
      homepage_url: client?.homepage_url || null,
      domain: client?.homepage_url || null,
      type_label: 'MCP OAuth client',
    },
    scopes,
    scope_labels: scopes.map(scopeLabel),
    allowed_tools: toolManifest.tools,
    tool_groups: toolManifest.tool_groups || [],
    safe_default_preferences: toolManifest.safe_default_preferences || {},
    tool_summary: toolManifest.summary,
    services: toolManifest.services || { name: client?.display_name || client?.name || row.client_id, permissions: [] },
    require_allowlist_for_mcp: toolManifest.require_allowlist_for_mcp ? 1 : 0,
    redirect_uri: row.redirect_uri,
    connecting_app: resolveMcpConnectingApp(row.redirect_uri),
    expires_at: row.expires_at,
    signed_in_email: iamUser.email || null,
  });
  res.headers.append('Set-Cookie', csrf.setCookie);
  return res;
}

export async function approveIamMcpAuthorization(env, authorizationId, iamUser, _workspaceId, options = {}) {
  const loaded = await loadAuthorization(env, authorizationId, iamUser.id);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const row = loaded.row;

  const resolvedWorkspaceId = String(row.workspace_id || '').trim();
  const workspaces = await listUserWorkspaces(env, iamUser.id);
  const allowedWs =
    resolvedWorkspaceId &&
    workspaces.some((w) => w.id === resolvedWorkspaceId);
  if (!resolvedWorkspaceId || !allowedWs) return { ok: false, error: 'invalid_workspace' };
  const workspaceIdFinal = resolvedWorkspaceId;

  // Host grant is user+client_key. Workspace is still validated above for the token.
  {
    const {
      resolveExternalClientKeyFromRedirect,
      assertUserMayUseExternalClient,
      recordExternalClientAllowlistOnConsent,
    } = await import('../core/mcp-oauth-external-clients.js');
    const externalClientKey = await resolveExternalClientKeyFromRedirect(
      env,
      row.redirect_uri,
      MCP_CANONICAL_CLIENT_ID,
    );
    const extAllow = await assertUserMayUseExternalClient(env, {
      userId: iamUser.id,
      workspaceId: workspaceIdFinal,
      externalClientKey,
      oauthClientId: row.client_id,
      requireGrant: false,
    });
    if (!extAllow.ok) {
      return { ok: false, error: extAllow.code || 'external_client_not_allowed' };
    }
    if (externalClientKey) {
      await recordExternalClientAllowlistOnConsent(env, {
        userId: iamUser.id,
        workspaceId: workspaceIdFinal,
        tenantId: String(row.tenant_id || iamUser.tenant_id || '').trim() || null,
        externalClientKey,
      });
    }
  }

  const scopes = mcpOAuthParseScopeList(row.scope);
  if (scopes.includes('mcp:tools')) {
    try {
      const toolManifest = await loadMcpOAuthConsentToolManifest(env, {
        userId: iamUser.id,
        workspaceId: workspaceIdFinal,
        tenantId: String(row.tenant_id || iamUser.tenant_id || '').trim(),
        clientId: row.client_id,
        clientDisplayName: row.client_display_name || row.client_id,
        grantedScopes: scopes,
      });
      const { persistMcpAllowlistFromGroupPreferences, buildSafeDefaultMcpGroupPreferences } =
        await import('../../backend/agentsam/tools/mcp-preferences.js');
      const groups = toolManifest.tool_groups?.length
        ? toolManifest.tool_groups
        : (await import('../../backend/agentsam/tools/mcp-preferences.js')).groupMcpToolsForPreferences(
            toolManifest.tools || [],
          );
      const prefsIn =
        options.tool_preferences && typeof options.tool_preferences === 'object'
          ? options.tool_preferences
          : buildSafeDefaultMcpGroupPreferences(groups, { hasAgentScope: scopes.includes('iam:agent') });
      await persistMcpAllowlistFromGroupPreferences(env, {
        userId: iamUser.id,
        workspaceId: workspaceIdFinal,
        tenantId: String(row.tenant_id || iamUser.tenant_id || '').trim(),
        clientId: row.client_id,
        catalogTools: toolManifest.tools || [],
        groupPreferences: prefsIn,
      });
    } catch (e) {
      return { ok: false, error: 'allowlist_persist_failed', detail: String(e?.message || e) };
    }
  }

  const codePlain = mcpOAuthRandomToken('mcp_code', 24);
  const codeHash = await mcpOAuthSha256Hex(codePlain);
  const now = mcpOAuthNow();
  const expiresAt = now + MCP_OAUTH_CODE_TTL_SECONDS;

  await env.DB.prepare(
    `INSERT INTO oauth_authorization_codes
       (code, user_id, tenant_id, client_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at, used, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, unixepoch())`,
  )
    .bind(
      codeHash,
      iamUser.id,
      row.tenant_id,
      row.client_id,
      row.redirect_uri,
      row.code_challenge,
      row.code_challenge_method || 'S256',
      row.scope,
      expiresAt,
    )
    .run();

  await env.DB.prepare(
    `UPDATE oauth_authorizations
        SET status = 'approved',
            approved_at = unixepoch(),
            workspace_id = ?,
            authorization_code_hash = ?,
            updated_at = unixepoch()
      WHERE id = ?`,
  )
    .bind(workspaceIdFinal, codeHash, authorizationId)
    .run();

  await env.DB.prepare(
    `UPDATE oauth_clients
        SET total_authorizations = total_authorizations + 1,
            last_used_at = unixepoch(),
            updated_at = unixepoch()
      WHERE client_id = ?`,
  )
    .bind(row.client_id)
    .run()
    .catch(() => {});

  const dest = new URL(row.redirect_uri);
  dest.searchParams.set('code', codePlain);
  dest.searchParams.set('state', row.state);

  return { ok: true, redirect_url: dest.href, client_id: row.client_id };
}

export async function denyIamMcpAuthorization(env, authorizationId, iamUser) {
  const loaded = await loadAuthorization(env, authorizationId, iamUser.id);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const row = loaded.row;

  await env.DB.prepare(
    `UPDATE oauth_authorizations
        SET status = 'denied', denied_at = unixepoch(), updated_at = unixepoch()
      WHERE id = ?`,
  )
    .bind(authorizationId)
    .run();

  const dest = new URL(row.redirect_uri);
  dest.searchParams.set('error', 'access_denied');
  dest.searchParams.set('state', row.state);
  return { ok: true, redirect_url: dest.href };
}

export async function handleIamMcpOAuthConsentPage(request, env) {
  const url = new URL(request.url);
  const { authorizationId, action, consentCsrf, toolPreferences } =
    await parseConsentBody(request, url);

  if (!isIamMcpAuthorizationId(authorizationId)) {
    return new Response('Invalid IAM MCP authorization id', { status: 400 });
  }

  const iamUser = await getAuthUser(request, env);
  if (!iamUser) {
    const q = new URLSearchParams();
    q.set('next', `/oauth/mcp/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
    return Response.redirect(`${url.origin}/auth/login?${q.toString()}`, 302);
  }

  const isApiConsentPath = url.pathname === '/api/oauth/mcp/consent';
  const wantsJson =
    String(request.headers.get('Accept') || '').includes('application/json') ||
    String(request.headers.get('Content-Type') || '').includes('application/json');
  const acceptJson = wantsJson || (request.method === 'POST' && isApiConsentPath);

  if (request.method === 'GET' && !wantsJson && isApiConsentPath) {
    const u = new URL('/oauth/mcp/consent', url.origin);
    u.searchParams.set('authorization_id', authorizationId);
    return Response.redirect(u.toString(), 302);
  }

  if (request.method === 'GET' && acceptJson && isApiConsentPath) {
    return handleIamMcpOAuthConsentApi(request, env);
  }

  if (request.method === 'POST' && action) {
    const csrfCheck = await verifyMcpConsentCsrf(request, env, {
      authorizationId,
      userId: iamUser.id,
      bodyToken: consentCsrf,
    });
    if (!csrfCheck.ok) {
      return rejectMcpConsentCsrf(request, env, iamUser, authorizationId, csrfCheck.error);
    }

    await logAuthEvent(env, {
      request,
      eventType: 'iam_mcp_oauth_consent_submit',
      userId: iamUser.id,
      metadata: { authorization_id: authorizationId, decision: action },
    });

    if (action === 'deny') {
      const denied = await denyIamMcpAuthorization(env, authorizationId, iamUser);
      if (!denied.ok) {
        return mcpOAuthJsonError(denied.error, 400);
      }
      await logAuthEvent(env, {
        request,
        eventType: 'iam_mcp_oauth_consent_denied',
        userId: iamUser.id,
      });
      await consumeMcpConsentCsrf(env, authorizationId);
      if (acceptJson) {
        return jsonResponse({ redirect_url: denied.redirect_url });
      }
      return Response.redirect(denied.redirect_url, 302);
    }

    const approved = await approveIamMcpAuthorization(env, authorizationId, iamUser, null, {
      tool_preferences: toolPreferences || undefined,
    });
    if (!approved.ok) {
      if (acceptJson) return mcpOAuthJsonError(approved.error, 400);
      const loaded = await loadAuthorization(env, authorizationId, iamUser.id);
      return new Response(
        iamMcpConsentHtml({
          authorizationId,
          clientName: loaded.row?.client_display_name || loaded.row?.client_id,
          redirectUri: loaded.row?.redirect_uri,
          connectingApp: resolveMcpConnectingApp(loaded.row?.redirect_uri),
          scopes: mcpOAuthParseScopeList(loaded.row?.scope),
          signedInEmail: iamUser.email,
          errorMessage: approved.error,
        }),
        { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
      );
    }

    await logAuthEvent(env, {
      request,
      eventType: 'iam_mcp_oauth_consent_approved',
      userId: iamUser.id,
      metadata: { client_id: approved.client_id },
    });

    await consumeMcpConsentCsrf(env, authorizationId);

    if (acceptJson) {
      return jsonResponse({ redirect_url: approved.redirect_url });
    }
    return Response.redirect(approved.redirect_url, 302);
  }

  const loaded = await loadAuthorization(env, authorizationId, iamUser.id);
  if (!loaded.ok) {
    const msg =
      loaded.error === 'expired'
        ? 'This authorization request has expired. Start again from your MCP client.'
        : 'Authorization request not found.';
    return new Response(
      iamMcpConsentHtml({
        authorizationId,
        clientName: 'MCP client',
        redirectUri: '',
        scopes: [],
        signedInEmail: iamUser.email,
        errorMessage: msg,
      }),
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
    );
  }

  await logAuthEvent(env, {
    request,
    eventType: 'iam_mcp_oauth_consent_viewed',
    userId: iamUser.id,
    metadata: { authorization_id: authorizationId },
  });

  return new Response(
    iamMcpConsentHtml({
      authorizationId,
      clientName: loaded.row.client_display_name || loaded.row.client_name || loaded.row.client_id,
      redirectUri: loaded.row.redirect_uri,
      connectingApp: resolveMcpConnectingApp(loaded.row.redirect_uri),
      scopes: mcpOAuthParseScopeList(loaded.row.scope),
      signedInEmail: iamUser.email,
      errorMessage: '',
    }),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}
