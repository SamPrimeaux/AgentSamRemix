/**
 * Agent Sam SDK API — CLI auth + server-side scaffold (external developers never touch IAM repos).
 *
 * POST /api/sdk/auth/start
 * GET  /api/sdk/auth/authorize
 * POST /api/sdk/auth/exchange
 * GET  /api/sdk/context
 * POST /api/sdk/scaffold  (NDJSON stream)
 * POST /api/sdk/terminal/register-local
 * POST /api/sdk/terminal/tunnel/provision
 */
import { jsonResponse } from '../core/responses.js';
import { getAuthUser } from '../core/auth.js';
import { runSdkScaffold, listCfAccountsForSdk } from '../core/sdk-scaffold.js';
import { resolveSdkByokStatus } from '../core/sdk-byok.js';
import { resolveEffectiveWorkspaceId } from '../../backend/identity/bootstrap.js';
import { resolvePtyTenantIdForUser } from '../../backend/agentsam/terminal/pty-workspace-paths.js';
import { getIntegrationOAuthRow } from '../../backend/identity/oauth/user-token.js';
import { resolveIntegrationUserId } from '../../backend/identity/oauth/integration-user-id.js';
import { userCanRunPtyFromPolicy } from '../../backend/http/agentsam/routes/pty-policy.js';
import * as terminalConnections from '../../backend/agentsam/terminal/connections.js';

const SDK_STATE_TTL_SEC = 600;
const SDK_CODE_TTL_SEC = 300;
const SDK_BEARER_TTL_SEC = 7 * 24 * 3600;

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function coreOrigin(request, env) {
  const fromEnv = trim(env?.IAM_PUBLIC_ORIGIN || env?.WORKER_PUBLIC_URL);
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  try {
    return new URL(request.url).origin;
  } catch {
    return 'https://inneranimalmedia.com';
  }
}

async function kvGetJson(env, key) {
  const cache = env?.SESSION_CACHE;
  if (!cache) return null;
  try {
    const raw = await cache.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function kvPutJson(env, key, value, ttlSec) {
  const cache = env?.SESSION_CACHE;
  if (!cache) return false;
  await cache.put(key, JSON.stringify(value), { expirationTtl: ttlSec });
  return true;
}

async function kvDelete(env, key) {
  const cache = env?.SESSION_CACHE;
  if (!cache) return;
  await cache.delete(key).catch(() => {});
}

function randomToken(prefix, bytes = 24) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  const hex = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

async function resolveSdkBearer(env, request) {
  const authHdr = request.headers.get('Authorization') || '';
  const bearer = authHdr.startsWith('Bearer ') ? authHdr.slice(7).trim() : authHdr.trim();
  if (!bearer || !bearer.startsWith('sdk_')) return null;
  const row = await kvGetJson(env, `sdk_bearer:${bearer}`);
  if (!row?.user_id) return null;
  return row;
}

async function handleAuthStart(request, env) {
  let body = {};
  try {
    body = await request.json();
  } catch (_) {}
  const redirectUri = trim(body?.redirect_uri);
  const state = trim(body?.state) || randomToken('state', 16);
  if (!redirectUri) {
    return jsonResponse({ error: 'redirect_uri required' }, 400);
  }
  try {
    const u = new URL(redirectUri);
    if (u.protocol !== 'http:' || !u.hostname.match(/^(127\.0\.0\.1|localhost)$/)) {
      return jsonResponse({ error: 'redirect_uri must be http://127.0.0.1 or http://localhost' }, 400);
    }
  } catch {
    return jsonResponse({ error: 'invalid redirect_uri' }, 400);
  }

  await kvPutJson(
    env,
    `sdk_auth_state:${state}`,
    { redirect_uri: redirectUri, created_at: Date.now() },
    SDK_STATE_TTL_SEC,
  );

  const origin = coreOrigin(request, env);
  const authUrl = `${origin}/api/sdk/auth/authorize?state=${encodeURIComponent(state)}`;

  return jsonResponse({ ok: true, state, auth_url: authUrl });
}

async function handleAuthAuthorize(request, url, env) {
  const state = trim(url.searchParams.get('state'));
  if (!state) {
    return new Response('Missing state', { status: 400, headers: { 'Content-Type': 'text/plain' } });
  }
  const pending = await kvGetJson(env, `sdk_auth_state:${state}`);
  if (!pending?.redirect_uri) {
    return new Response('Invalid or expired state', { status: 400, headers: { 'Content-Type': 'text/plain' } });
  }

  const authUser = await getAuthUser(request, env);
  const origin = coreOrigin(request, env);
  if (!authUser) {
    const next = `${origin}/api/sdk/auth/authorize?state=${encodeURIComponent(state)}`;
    return Response.redirect(`${origin}/auth/login?next=${encodeURIComponent(next)}`, 302);
  }

  const userId = await resolveIntegrationUserId(env, authUser);
  const cfRow = userId ? await getIntegrationOAuthRow(env, userId, 'cloudflare', '') : null;
  if (!cfRow?.access_token) {
    const returnTo = `${origin}/api/sdk/auth/authorize?state=${encodeURIComponent(state)}`;
    return Response.redirect(
      `${origin}/api/oauth/cloudflare/start?return_to=${encodeURIComponent(returnTo)}`,
      302,
    );
  }

  const code = randomToken('code', 20);
  const wsRes = await resolveEffectiveWorkspaceId(env, request, authUser, {});
  const tenantId = await resolvePtyTenantIdForUser(env, authUser, authUser.id);

  await kvPutJson(
    env,
    `sdk_auth_code:${code}`,
    {
      user_id: String(authUser.id),
      email: authUser.email ?? null,
      person_uuid: authUser.person_uuid ?? null,
      tenant_id: tenantId ?? null,
      workspace_id: wsRes.workspaceId ?? null,
      state,
    },
    SDK_CODE_TTL_SEC,
  );

  const redirect = new URL(pending.redirect_uri);
  redirect.searchParams.set('code', code);
  redirect.searchParams.set('state', state);
  await kvDelete(env, `sdk_auth_state:${state}`);

  return new Response(
    `<!DOCTYPE html><html><body style="font-family:system-ui;background:#001a22;color:#2dd4bf;padding:2rem">
<h1>Agent Sam</h1><p>Authenticated. Returning to CLI…</p>
<script>location.replace(${JSON.stringify(redirect.toString())})</script>
<p><a href="${redirect.toString()}">Continue</a></p></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

async function handleAuthExchange(request, env) {
  let body = {};
  try {
    body = await request.json();
  } catch (_) {}
  const code = trim(body?.code);
  const state = trim(body?.state);
  if (!code || !state) return jsonResponse({ error: 'code and state required' }, 400);

  const row = await kvGetJson(env, `sdk_auth_code:${code}`);
  if (!row || row.state !== state) {
    return jsonResponse({ error: 'invalid_or_expired_code' }, 401);
  }
  await kvDelete(env, `sdk_auth_code:${code}`);

  const token = randomToken('sdk', 32);
  await kvPutJson(
    env,
    `sdk_bearer:${token}`,
    {
      user_id: row.user_id,
      email: row.email,
      person_uuid: row.person_uuid,
      tenant_id: row.tenant_id,
      workspace_id: row.workspace_id,
    },
    SDK_BEARER_TTL_SEC,
  );

  return jsonResponse({
    ok: true,
    access_token: token,
    token_type: 'Bearer',
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    tenant_id: row.tenant_id,
  });
}

async function authUserFromSdkBearer(env, request) {
  const session = await resolveSdkBearer(env, request);
  if (!session?.user_id) return null;
  const wid = session.workspace_id != null ? String(session.workspace_id).trim() : '';
  return {
    id: String(session.user_id),
    email: session.email ?? null,
    person_uuid: session.person_uuid ?? null,
    tenant_id: session.tenant_id ?? null,
    workspace_id: wid || null,
    active_workspace_id: wid || null,
  };
}

async function handleSdkContext(request, env) {
  const authUser = await authUserFromSdkBearer(env, request);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  const cf = await listCfAccountsForSdk(env, authUser);
  const tenantId = authUser.tenant_id ? String(authUser.tenant_id) : '';
  const byok =
    tenantId && authUser.id
      ? await resolveSdkByokStatus(env, authUser.id, tenantId)
      : { openai: { configured: false }, anthropic: { configured: false }, google: { configured: false } };

  return jsonResponse({
    ok: true,
    user_id: authUser.id,
    workspace_id: authUser.workspace_id,
    tenant_id: authUser.tenant_id,
    cloudflare: cf,
    byok,
  });
}

async function handleSdkKeysPost(request, env, ctx) {
  const authUser = await authUserFromSdkBearer(env, request);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!authUser.workspace_id) {
    return jsonResponse({ error: 'workspace_context_missing' }, 400);
  }

  let body = {};
  try {
    body = await request.json();
  } catch (_) {}

  const provider = trim(body?.provider).toLowerCase();
  const apiKey = trim(body?.api_key || body?.secret_value);
  if (!provider || !apiKey) {
    return jsonResponse({ error: 'provider and api_key required' }, 400);
  }
  if (!['openai', 'anthropic', 'google', 'google_ai'].includes(provider)) {
    return jsonResponse({ error: 'unsupported_provider', allowed: ['openai', 'anthropic', 'google'] }, 400);
  }

  const { handleSettingsKeysApi } = await import('./settings-api-keys.js');
  const fwdUrl = new URL('https://inneranimalmedia.com/api/settings/keys');
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.set('X-Iam-Workspace-Id', authUser.workspace_id);

  const fwdReq = new Request(fwdUrl.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      provider: provider === 'google' ? 'google' : provider,
      api_key: apiKey,
      label: trim(body?.label) || `${provider} (Agent Sam SDK init)`,
      validate: body?.validate !== false,
      category: 'provider',
    }),
  });

  const res = await handleSettingsKeysApi(
    fwdReq,
    env,
    ctx,
    authUser,
    fwdUrl,
    '/api/settings/keys',
    'POST',
  );
  return res || jsonResponse({ error: 'keys_save_failed' }, 500);
}

async function handleSdkScaffold(request, env) {
  const authUser = await authUserFromSdkBearer(env, request);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body = {};
  try {
    body = await request.json();
  } catch (_) {}

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  const emit = async (event) => {
    await writer.write(enc.encode(`${JSON.stringify(event)}\n`));
  };

  const run = async () => {
    try {
      await emit({ type: 'start', message: 'Agent Sam is provisioning your Cloudflare project…' });
      await runSdkScaffold(env, authUser, request, body, emit, { ...terminalConnections, canRunPty: userCanRunPtyFromPolicy });
    } catch (e) {
      await emit({ type: 'error', error: e?.message || String(e) });
    } finally {
      await writer.close();
    }
  };

  void run();

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

/**
 * Register a user-hosted local PTY tunnel URL for the SDK caller.
 * POST /api/sdk/terminal/register-local  { ws_url, platform?, shell? }
 */
async function handleSdkRegisterLocal(request, env) {
  const authUser = await authUserFromSdkBearer(env, request);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  const workspaceId = trim(authUser.workspace_id);
  if (!workspaceId) return jsonResponse({ error: 'workspace_context_missing' }, 400);

  let body = {};
  try {
    body = await request.json();
  } catch (_) {}

  if (!(await userCanRunPtyFromPolicy(env, authUser.id, workspaceId))) return jsonResponse({ error: 'terminal_not_enabled' }, 403);
  const tenantId = await resolvePtyTenantIdForUser(env, authUser, authUser.id);
  if (!tenantId) return jsonResponse({ error: 'tenant_missing' }, 403);
  const provisioned = await terminalConnections.provisionUserHostedTunnelConnection(env.DB, { userId: authUser.id, workspaceId, tenantId, platform: body?.platform, shell: body?.shell });
  if (!provisioned.ok) {
    return jsonResponse(
      { error: provisioned.error, detail: provisioned.detail ?? null },
      provisioned.status || 500,
    );
  }

  const activated = await terminalConnections.activateUserHostedTunnelConnection(env.DB, { userId: authUser.id, workspaceId, connectionId: provisioned.connection?.id, wsUrl: body?.ws_url });
  if (!activated.ok) {
    return jsonResponse({ error: activated.error }, activated.status || 500);
  }

  return jsonResponse({
    ok: true,
    connection: activated.connection,
    provisioned: provisioned.created === true,
  });
}

/**
 * Named CF tunnel provision (BYOK) for SDK CLI.
 * POST /api/sdk/terminal/tunnel/provision
 */
async function handleSdkTunnelProvision(request, env) {
  const authUser = await authUserFromSdkBearer(env, request);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  const workspaceId = trim(authUser.workspace_id);
  if (!workspaceId) return jsonResponse({ error: 'workspace_context_missing' }, 400);

  let body = {};
  try {
    body = await request.json();
  } catch (_) {}

  const tunnelName = trim(body?.tunnel_name);
  const hostname = trim(body?.hostname);
  const zoneId = trim(body?.zone_id);
  if (!tunnelName || !hostname || !zoneId) {
    return jsonResponse({ error: 'tunnel_name, hostname, and zone_id required' }, 400);
  }

  const tenantId = await resolvePtyTenantIdForUser(env, authUser, authUser.id);
  if (!tenantId) return jsonResponse({ error: 'tenant_missing' }, 403);

  const { resolveWorkspaceCloudflareCredentials } = await import(
    '../core/workspace-cloudflare-credentials.js'
  );
  const creds = await resolveWorkspaceCloudflareCredentials(
    env,
    authUser.id,
    tenantId,
    workspaceId,
  );
  if (!creds.ok || !creds.token) {
    return jsonResponse(
      {
        error: 'cloudflare_credentials_required',
        message: 'Connect Cloudflare OAuth in the IAM dashboard (or set a CF API token) first.',
      },
      400,
    );
  }

  const { provisionPtyTunnel } = await import('../core/pty-tunnel-provisioner.js');
  const result = await provisionPtyTunnel(env, {
    userId: authUser.id,
    tenantId,
    workspaceId,
    tunnelName,
    hostname,
    zoneId,
    port: body?.port ?? 3099,
    platform: body?.platform,
    shell: body?.shell,
  }, { getUserHostedTunnelConnectionById: terminalConnections.getUserHostedTunnelConnectionById, setDefaultUserHostedTunnelConnection: terminalConnections.setDefaultUserHostedTunnelConnection });
  if (!result.ok) {
    return jsonResponse(
      { error: result.error, step_failed: result.step_failed ?? null },
      500,
    );
  }
  return jsonResponse({
    ok: true,
    tunnel_id: result.tunnel_id,
    hostname: result.hostname,
    ws_url: result.ws_url,
    connection_id: result.connection_id,
    run_token: result.run_token,
  });
}

export async function handleSdkApi(request, url, env, ctx) {
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (path === '/api/sdk/auth/start' && method === 'POST') {
    return handleAuthStart(request, env);
  }
  if (path === '/api/sdk/auth/authorize' && method === 'GET') {
    return handleAuthAuthorize(request, url, env);
  }
  if (path === '/api/sdk/auth/exchange' && method === 'POST') {
    return handleAuthExchange(request, env);
  }
  if (path === '/api/sdk/context' && method === 'GET') {
    return handleSdkContext(request, env);
  }
  if (path === '/api/sdk/keys' && method === 'POST') {
    return handleSdkKeysPost(request, env, ctx);
  }
  if (path === '/api/sdk/scaffold' && method === 'POST') {
    return handleSdkScaffold(request, env);
  }
  if (path === '/api/sdk/terminal/register-local' && method === 'POST') {
    return handleSdkRegisterLocal(request, env);
  }
  if (path === '/api/sdk/terminal/tunnel/provision' && method === 'POST') {
    return handleSdkTunnelProvision(request, env);
  }

  return jsonResponse({ error: 'Not found', path }, 404);
}
