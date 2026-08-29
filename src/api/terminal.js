/**
 * IAM Terminal API
 *
 * POST /api/terminal/assist          — AI assist for terminal context (Agent Sam / agentsam_model_catalog)
 * GET  /api/terminal/models          — PTY-auth model list for /agents slash command
 * POST /api/terminal/session/register — register new PTY session
 * POST /api/terminal/session/verify — PTY backend: SHA256(token) vs terminal_sessions.auth_token_hash
 */
import { jsonResponse }      from '../core/responses.js';
import { getAuthUser } from '../core/auth.js';
import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import {
  resolveEffectiveWorkspaceId,
  resolveActiveBootstrap,
  resolveTerminalWorkspaceId,
  WORKSPACE_CONTEXT_MISSING,
} from '../../backend/identity/bootstrap.js';
import {
  resolvePtyTenantIdForUser,
  resolveTerminalCwd,
  loadWorkspaceRootFromSettings,
} from '../../backend/agentsam/terminal/pty-workspace-paths.js';
import { dispatchComplete } from '../../backend/agentsam/runtime/provider-dispatch.js';
import { resolveModelForTask, normalizeCanonicalTaskType } from '../core/resolveModel.js';
import {
  extractDispatchUsage,
  finalizeTerminalAssistAgentRun,
  logTerminalAssistError,
  mintTerminalAssistAgentRunId,
  startTerminalAssistAgentRun,
} from '../core/terminal-assist-telemetry.js';
import {
  computeTerminalSessionAuthTokenHash,
  sha256HexUtf8,
  mintSessionToken,
} from '../../backend/agentsam/terminal/session-auth.js';
import * as terminalConnections from '../../backend/agentsam/terminal/connections.js';
import {
  closeTerminalSessionRecord,
  getTerminalInputHistory,
} from '../core/terminal-session-ops.js';
import {
  userCanRunPtyFromPolicy,
  loadAuthUserRowForPty,
  ptyBackendBearerValid,
} from '../../backend/http/agentsam/routes/pty-policy.js';
import { buildTerminalConfigStatus } from '../core/terminal-config-status.js';
import {
  buildTerminalLaneTargets,
  buildTerminalSplashStatus,
} from '../core/terminal-splash-status.js';
import {
  generateUserPtyAuthToken,
  getUserPtyAuthTokenStatus,
  revokeUserPtyAuthToken,
  CF_CREDENTIALS_HELP,
} from '../../backend/credentials/user-secrets.js';
import {
  provisionPtyTunnel,
  deprovisionPtyTunnel,
  getPtyTunnelStatus,
  tryAutoActivateUserHostedTunnel,
} from '../core/pty-tunnel-provisioner.js';
import { resolveTerminalAssistIdentity } from '../core/terminal-assist-identity.js';
import { resolveWorkspaceCloudflareCredentials } from '../core/workspace-cloudflare-credentials.js';
import { resolvePtySessionCloudflareEnv } from '../core/pty-session-cloudflare-env.js';
import { resolveConnectionAuthToken } from '../../backend/agentsam/terminal/connection-auth.js';
import { requireTerminalTargetType, sandboxLifecycleFromInput } from '../../backend/agentsam/terminal/execution-lane.js';

export const TERMINAL_CONNECTION_DEPS = Object.freeze({ ...terminalConnections, resolveConnectionAuthToken, requireTerminalConnectionTargetType: requireTerminalTargetType, sandboxLifecycleFromInput });

// ── Token validation ───────────────────────────────────────────────────────────
export async function handleTerminalApi(request, url, env, ctx) {
  const path   = url.pathname;
  const method = request.method.toUpperCase();

  // POST /api/terminal/session/verify — PTY backend validates bearer vs D1 terminal_sessions (token_mint)
  if (path === '/api/terminal/session/verify' && method === 'POST') {
    const authHdr = request.headers.get('Authorization') || '';
    const bearer = authHdr.startsWith('Bearer ') ? authHdr.slice(7).trim() : authHdr.trim();
    const validBridge = verifyBridgeKey(request, env);

    let body = {};
    try {
      body = await request.json();
    } catch (_) {}
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const sessionId = typeof body?.session_id === 'string' ? body.session_id.trim() : '';
    if (!token || !sessionId) return jsonResponse({ valid: false, error: 'token and session_id required' }, 400);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

    try {
      const row = await env.DB.prepare(
        `SELECT auth_token_hash, user_id, workspace_id, tenant_id
         FROM terminal_sessions WHERE id = ? LIMIT 1`,
      )
        .bind(sessionId)
        .first();
      const stored = row?.auth_token_hash != null ? String(row.auth_token_hash).trim() : '';
      if (!stored) return jsonResponse({ valid: false, error: 'invalid session' }, 401);
      const digest = await sha256HexUtf8(token);
      if (digest !== stored) return jsonResponse({ valid: false, error: 'invalid token' }, 401);

      const sessionUserId = row?.user_id != null ? String(row.user_id).trim() : '';
      const sessionWorkspaceId = row?.workspace_id != null ? String(row.workspace_id).trim() : '';
      const sessionTenantId = row?.tenant_id != null ? String(row.tenant_id).trim() : '';
      const validBackend =
        validBridge ||
        (bearer &&
          (await ptyBackendBearerValid(env, bearer, sessionUserId, sessionWorkspaceId)));
      if (!validBackend) return jsonResponse({ valid: false, error: 'unauthorized' }, 401);

      const cf = await resolvePtySessionCloudflareEnv(env, {
        userId: sessionUserId,
        tenantId: sessionTenantId,
        workspaceId: sessionWorkspaceId,
      });

      return jsonResponse({
        valid: true,
        session_id: sessionId,
        ok: true,
        user_id: sessionUserId || null,
        workspace_id: sessionWorkspaceId || null,
        tenant_id: sessionTenantId || null,
        cloudflare_api_token: cf.cloudflare_api_token,
        cloudflare_account_id: cf.cloudflare_account_id,
        cloudflare_configured: cf.ok === true,
        cloudflare_error: cf.ok ? null : cf.error,
      });
    } catch (e) {
      return jsonResponse({ valid: false, error: 'verify failed', detail: e?.message || String(e) }, 500);
    }
  }

  // POST /api/terminal/session/register
  if (path === '/api/terminal/session/register' && method === 'POST') {
    const auth  = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim();
    const validBridge = verifyBridgeKey(request, env);

    let body = {};
    try { body = await request.json(); } catch (_) {}

    const regUserIdHint = String(body?.user_id || '').trim();
    const regWsHint = String(body?.workspace_id || '').trim();
    const validToken =
      validBridge ||
      (token && (await ptyBackendBearerValid(env, token, regUserIdHint, regWsHint)));
    if (!validToken) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    const { session_id, tunnel_url, cols, rows, shell, cwd } = body;
    if (!session_id || !tunnel_url) return jsonResponse({ error: 'session_id and tunnel_url required' }, 400);

    const now = Math.floor(Date.now() / 1000);
    let authUser = await getAuthUser(request, env);
    if (!authUser && regUserIdHint && env.DB) {
      const row = await loadAuthUserRowForPty(env.DB, regUserIdHint);
      if (row?.id) {
        authUser = {
          id: String(row.id),
          email: row.email ?? null,
          person_uuid: row.person_uuid ?? null,
          tenant_id: row.tenant_id ?? row.active_tenant_id ?? null,
        };
      }
    }
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    let regWorkspaceId = regWsHint;
    if (regWorkspaceId) {
      const { userHasWorkspaceMembership } = await import('../../backend/identity/workspace/provisioning.js');
      const memberOk = await userHasWorkspaceMembership(env, String(authUser.id).trim(), regWorkspaceId);
      if (!memberOk) {
        return jsonResponse({ error: 'Forbidden', code: 'workspace_forbidden' }, 403);
      }
    } else {
      const wsRes = await resolveEffectiveWorkspaceId(env, request, authUser, {});
      if (wsRes.error || !wsRes.workspaceId) {
        return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
      }
      regWorkspaceId = wsRes.workspaceId;
    }
    const regUid = String(authUser.id || '').trim();
    let regTid = await resolvePtyTenantIdForUser(env, authUser, regUid);
    if (!regTid) return jsonResponse({ error: 'Tenant not resolved for terminal session' }, 403);

    const cwdResolved = await resolveTerminalCwd(env, {
      connection: null,
      tenantId: regTid,
      userId: regUid,
      workspaceId: regWorkspaceId,
    });
    const workingDir = cwdResolved.cwd || (await loadWorkspaceRootFromSettings(env, regWorkspaceId)) || '';

    const bootstrap = await resolveActiveBootstrap(env, {
      userId: regUid,
      personUuid: authUser.person_uuid || null,
      tenantId: regTid,
      workspaceId: regWorkspaceId,
    });
    if (!bootstrap) return jsonResponse({ error: 'Terminal not permitted' }, 403);

    let capabilities = {};
    let executionModes = [];
    try { capabilities = JSON.parse(bootstrap.capabilities_json || '{}'); } catch (_) { capabilities = {}; }
    try { executionModes = JSON.parse(bootstrap.allowed_execution_modes_json || '[]'); } catch (_) { executionModes = []; }
    const canPty = capabilities.can_run_pty === true || capabilities.terminal === true;
    if (!canPty) return jsonResponse({ error: 'Terminal not permitted' }, 403);
    if (!Array.isArray(executionModes) || !executionModes.includes('pty')) {
      return jsonResponse({ error: 'Terminal execution mode not permitted' }, 403);
    }

    // If PTY sends a session_token (token_mint flow), store its SHA-256
    // Otherwise fall back to legacy pepper+sessionId hash
    const authTokenHash = body.session_token
      ? await sha256HexUtf8(String(body.session_token))
      : await computeTerminalSessionAuthTokenHash(env, session_id);

    try {
      await env.DB?.prepare(
      `INSERT INTO terminal_sessions
       (id, tenant_id, user_id, workspace_id, person_uuid, tunnel_url, cols, rows, shell, cwd, status, auth_token_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status=excluded.status, updated_at=excluded.updated_at,
         tunnel_url=excluded.tunnel_url,
         workspace_id=excluded.workspace_id,
         person_uuid=excluded.person_uuid,
         auth_token_hash=COALESCE(excluded.auth_token_hash, auth_token_hash)`
    ).bind(
      session_id,
      regTid,
      regUid,
      regWorkspaceId,
      authUser.person_uuid || null,
      tunnel_url || '',
      cols || 220,
      rows || 50,
      shell || '/bin/bash',
      cwd || workingDir,
      authTokenHash,
      now,
      now,
    )
     .run();
    } catch (e) {
      const detail = e?.message != null ? String(e.message) : 'session_register_failed';
      console.error('[terminal/session/register] insert failed', detail);
      return jsonResponse({ error: 'session_register_failed', detail }, 500);
    }

    const autoActivate = await tryAutoActivateUserHostedTunnel(
      env,
      tunnel_url,
      regUid,
      regWorkspaceId,
    );

    return jsonResponse({
      ok: true,
      session_id,
      connection_activated: autoActivate.activated === true,
      connection_id: autoActivate.connection_id ?? null,
    });
  }

  // GET /api/terminal/history — recent user input (filtered; not injected into live PTY)
  if (path === '/api/terminal/history' && method === 'GET') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const commands = await getTerminalInputHistory(env, authUser.id, 200);
    return jsonResponse({ commands, count: commands.length });
  }

  // GET /api/terminal/splash-status — workspace-scoped splash lanes (single round-trip)
  if (path === '/api/terminal/splash-status' && method === 'GET') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tw = await resolveTerminalWorkspaceId(env, request, authUser, url.searchParams.get('workspace_id'));
    if (!tw.workspaceId) {
      return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
    }
    const authWs = await resolveEffectiveWorkspaceId(env, request, authUser, {});
    const payload = await buildTerminalSplashStatus(env, authUser, tw.workspaceId, {
      authWorkspaceId: authWs.workspaceId ?? tw.workspaceId,
      targetType: url.searchParams.get('target_type'),
      execLane: url.searchParams.get('exec_lane'),
    }, TERMINAL_CONNECTION_DEPS);
    return jsonResponse(payload);
  }

  // GET /api/terminal/connections/targets — local + cloud lane readiness for splash UI
  if (path === '/api/terminal/connections/targets' && method === 'GET') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tw = await resolveTerminalWorkspaceId(env, request, authUser, url.searchParams.get('workspace_id'));
    if (!tw.workspaceId) {
      return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
    }
    const targets = await buildTerminalLaneTargets(env, authUser, tw.workspaceId, TERMINAL_CONNECTION_DEPS);
    return jsonResponse(targets);
  }

  // GET /api/terminal/connections/local — user_hosted_tunnel row for current user/workspace
  if (path === '/api/terminal/connections/local' && method === 'GET') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tw = await resolveTerminalWorkspaceId(env, request, authUser, url.searchParams.get('workspace_id'));
    if (!tw.workspaceId) {
      return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
    }
    if (!(await userCanRunPtyFromPolicy(env, authUser.id, tw.workspaceId))) return jsonResponse({ error: 'terminal_not_enabled' }, 403);
    const row = await terminalConnections.getUserHostedTunnelConnection(env.DB, authUser.id, tw.workspaceId);
    if (!row) {
      return jsonResponse({ connection: null, has_local: false });
    }
    const wsUrl = row.ws_url != null ? String(row.ws_url).trim() : '';
    return jsonResponse({
      has_local: true,
      connection: {
        id: String(row.id),
        platform: row.platform ?? null,
        shell: row.shell ?? null,
        is_active: Number(row.is_active) === 1,
        ws_url_present: !!wsUrl,
      },
    });
  }

  // GET /api/terminal/connections/hosted — list user_hosted_tunnel rows (multi-machine)
  if (path === '/api/terminal/connections/hosted' && method === 'GET') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tw = await resolveTerminalWorkspaceId(env, request, authUser, url.searchParams.get('workspace_id'));
    if (!tw.workspaceId) {
      return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
    }
    if (!(await userCanRunPtyFromPolicy(env, authUser.id, tw.workspaceId))) return jsonResponse({ error: 'terminal_not_enabled' }, 403);
    const rows = await terminalConnections.listUserHostedTunnelConnections(env.DB, authUser.id, tw.workspaceId);
    return jsonResponse({
      ok: true,
      connections: rows.map((r) => terminalConnections.formatHostedTunnelConnectionRow(r)).filter(Boolean),
    });
  }

  // POST /api/terminal/connections/hosted — create a new hosted tunnel row
  if (path === '/api/terminal/connections/hosted' && method === 'POST') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tw = await resolveTerminalWorkspaceId(env, request, authUser, null);
    if (!tw.workspaceId) {
      return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
    }
    if (!(await userCanRunPtyFromPolicy(env, authUser.id, tw.workspaceId))) return jsonResponse({ error: 'terminal_not_enabled' }, 403);
    const tenantId = await resolvePtyTenantIdForUser(env, authUser, authUser.id);
    if (!tenantId) return jsonResponse({ error: 'tenant_missing' }, 403);
    const body = await request.json().catch(() => ({}));
    const result = await terminalConnections.createUserHostedTunnelConnection(env.DB, { userId: authUser.id, workspaceId: tw.workspaceId, tenantId, name: body?.name, platform: body?.platform, shell: body?.shell });
    if (!result.ok) {
      return jsonResponse({ error: result.error, detail: result.detail ?? null }, result.status || 500);
    }
    return jsonResponse({ ok: true, created: true, connection: result.connection });
  }

  // POST /api/terminal/connections/hosted/default — pin default local lane connection
  if (path === '/api/terminal/connections/hosted/default' && method === 'POST') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tw = await resolveTerminalWorkspaceId(env, request, authUser, null);
    if (!tw.workspaceId) {
      return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
    }
    const body = await request.json().catch(() => ({}));
    const connectionId = String(body?.connection_id || '').trim();
    if (!connectionId) return jsonResponse({ error: 'connection_id required' }, 400);
    const result = await terminalConnections.setDefaultUserHostedTunnelConnection(
      env.DB,
      authUser.id,
      tw.workspaceId,
      connectionId,
    );
    if (!result.ok) return jsonResponse({ error: result.error }, result.status || 400);
    return jsonResponse({ ok: true, connection_id: result.connection_id });
  }

  // POST /api/terminal/connections/provision — create inactive user_hosted_tunnel row
  if (path === '/api/terminal/connections/provision' && method === 'POST') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tw = await resolveTerminalWorkspaceId(env, request, authUser, null);
    if (!tw.workspaceId) {
      return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
    }
    if (!(await userCanRunPtyFromPolicy(env, authUser.id, tw.workspaceId))) return jsonResponse({ error: 'terminal_not_enabled' }, 403);
    const tenantId = await resolvePtyTenantIdForUser(env, authUser, authUser.id);
    if (!tenantId) return jsonResponse({ error: 'tenant_missing' }, 403);
    const body = await request.json().catch(() => ({}));
    const targetType = String(body?.target_type || 'user_hosted_tunnel').trim();
    if (targetType !== 'user_hosted_tunnel') {
      return jsonResponse({ error: 'unsupported_target_type' }, 400);
    }
    const result = await terminalConnections.provisionUserHostedTunnelConnection(env.DB, { userId: authUser.id, workspaceId: tw.workspaceId, tenantId, platform: body?.platform, shell: body?.shell, forceNew: body?.force_new === true });
    if (!result.ok) {
      return jsonResponse({ error: result.error, detail: result.detail ?? null }, result.status || 500);
    }
    return jsonResponse({ ok: true, created: result.created === true, connection: result.connection });
  }

  // POST /api/terminal/token/generate — one-time PTY bridge token (encrypted in user_secrets)
  if (path === '/api/terminal/token/generate' && method === 'POST') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tw = await resolveTerminalWorkspaceId(env, request, authUser, null);
    if (!tw.workspaceId) {
      return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
    }
    if (!(await userCanRunPtyFromPolicy(env, authUser.id, tw.workspaceId))) return jsonResponse({ error: 'terminal_not_enabled' }, 403);
    const body = await request.json().catch(() => ({}));
    const result = await generateUserPtyAuthToken(env, authUser, tw.workspaceId, request, {
      rotate: body?.rotate === true,
    }, TERMINAL_CONNECTION_DEPS);
    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.status || 500);
    }
    return jsonResponse({
      ok: true,
      token: result.token,
      last4: result.last4,
      connection_id: result.connection_id,
      instructions: result.instructions,
    });
  }

  // GET /api/terminal/token/status
  if (path === '/api/terminal/token/status' && method === 'GET') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tw = await resolveTerminalWorkspaceId(env, request, authUser, url.searchParams.get('workspace_id'));
    if (!tw.workspaceId) {
      return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
    }
    if (!(await userCanRunPtyFromPolicy(env, authUser.id, tw.workspaceId))) return jsonResponse({ error: 'terminal_not_enabled' }, 403);
    const status = await getUserPtyAuthTokenStatus(env, authUser.id, tw.workspaceId, TERMINAL_CONNECTION_DEPS);
    return jsonResponse(status);
  }

  // DELETE /api/terminal/token
  if (path === '/api/terminal/token' && method === 'DELETE') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tw = await resolveTerminalWorkspaceId(env, request, authUser, null);
    if (!tw.workspaceId) {
      return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
    }
    if (!(await userCanRunPtyFromPolicy(env, authUser.id, tw.workspaceId))) return jsonResponse({ error: 'terminal_not_enabled' }, 403);
    const result = await revokeUserPtyAuthToken(env, authUser, tw.workspaceId, request, TERMINAL_CONNECTION_DEPS);
    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.status || 500);
    }
    return jsonResponse({ ok: true, revoked: result.revoked === true });
  }

  // POST /api/terminal/tunnel/provision — BYOK Cloudflare tunnel + DNS
  if (path === '/api/terminal/tunnel/provision' && method === 'POST') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tw = await resolveTerminalWorkspaceId(env, request, authUser, null);
    if (!tw.workspaceId) {
      return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
    }
    if (!(await userCanRunPtyFromPolicy(env, authUser.id, tw.workspaceId))) return jsonResponse({ error: 'terminal_not_enabled' }, 403);
    const body = await request.json().catch(() => ({}));
    const tunnelName = String(body?.tunnel_name || '').trim();
    const hostname = String(body?.hostname || '').trim();
    const zoneId = String(body?.zone_id || '').trim();
    const connectionId = String(body?.connection_id || '').trim();
    if (!tunnelName || !hostname || !zoneId) {
      return jsonResponse({ error: 'tunnel_name, hostname, and zone_id required' }, 400);
    }

    const tenantId = await resolvePtyTenantIdForUser(env, authUser, authUser.id);
    if (!tenantId) return jsonResponse({ error: 'tenant_missing' }, 403);

    const creds = await resolveWorkspaceCloudflareCredentials(
      env,
      authUser.id,
      tenantId,
      tw.workspaceId,
    );
    if (!creds.ok || !creds.token) {
      return jsonResponse(CF_CREDENTIALS_HELP, 400);
    }

    const result = await provisionPtyTunnel(env, {
      userId: authUser.id,
      tenantId,
      workspaceId: tw.workspaceId,
      tunnelName,
      hostname,
      zoneId,
      port: body?.port,
      platform: body?.platform,
      shell: body?.shell,
      connectionId,
      connectionName: body?.connection_name || tunnelName,
    }, TERMINAL_CONNECTION_DEPS);
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
      next_steps: [
        'Install cloudflared on your machine',
        'Run: cloudflared tunnel run --token <run_token>',
        'Set PTY_AUTH_TOKEN via POST /api/terminal/token/generate, then run node server.js in ExecOS',
        'Connection auto-activates when the tunnel registers a session',
      ],
    });
  }

  // GET /api/terminal/tunnel/status
  if (path === '/api/terminal/tunnel/status' && method === 'GET') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tw = await resolveTerminalWorkspaceId(env, request, authUser, url.searchParams.get('workspace_id'));
    if (!tw.workspaceId) {
      return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
    }
    const tenantId = await resolvePtyTenantIdForUser(env, authUser, authUser.id);
    const status = await getPtyTunnelStatus(env, {
      userId: authUser.id,
      tenantId: tenantId || '',
      workspaceId: tw.workspaceId,
      connectionId: url.searchParams.get('connection_id'),
    }, TERMINAL_CONNECTION_DEPS);
    return jsonResponse(status);
  }

  // DELETE /api/terminal/tunnel
  if (path === '/api/terminal/tunnel' && method === 'DELETE') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tw = await resolveTerminalWorkspaceId(env, request, authUser, null);
    if (!tw.workspaceId) {
      return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
    }
    const tenantId = await resolvePtyTenantIdForUser(env, authUser, authUser.id);
    if (!tenantId) return jsonResponse({ error: 'tenant_missing' }, 403);
    const body = await request.json().catch(() => ({}));
    const result = await deprovisionPtyTunnel(env, {
      userId: authUser.id,
      tenantId,
      workspaceId: tw.workspaceId,
      connectionId: body?.connection_id,
    });
    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.status || 500);
    }
    return jsonResponse({
      ok: true,
      tunnel_id: result.tunnel_id,
      dns_record_deleted: result.dns_record_deleted === true,
    });
  }

  // POST /api/terminal/connections/activate — set ws_url and is_active=1
  if (path === '/api/terminal/connections/activate' && method === 'POST') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const tw = await resolveTerminalWorkspaceId(env, request, authUser, null);
    if (!tw.workspaceId) {
      return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: 'WORKSPACE_CONTEXT_MISSING' }, 400);
    }
    if (!(await userCanRunPtyFromPolicy(env, authUser.id, tw.workspaceId))) return jsonResponse({ error: 'terminal_not_enabled' }, 403);
    const body = await request.json().catch(() => ({}));
    const result = await terminalConnections.activateUserHostedTunnelConnection(env.DB, { userId: authUser.id, workspaceId: tw.workspaceId, connectionId: body?.connection_id, wsUrl: body?.ws_url });
    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.status || 500);
    }
    return jsonResponse({ ok: true, connection: result.connection });
  }

  // POST /api/terminal/session/close — mark D1 session closed (inactivity / client disconnect)
  if (path === '/api/terminal/session/close' && method === 'POST') {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const sessionId = String(body?.session_id || '').trim();
    if (!sessionId) return jsonResponse({ error: 'session_id required' }, 400);
    await closeTerminalSessionRecord(env, sessionId, authUser.id);
    return jsonResponse({ ok: true });
  }

  // GET /api/terminal/models — PTY server /agents slash (no browser cookie)
  if (path === '/api/terminal/models' && method === 'GET') {
    const auth = request.headers.get('Authorization') || request.headers.get('x-pty-auth') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim();
    if (!token || token !== (env.PTY_AUTH_TOKEN || '')) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }
    const sessionId = String(url.searchParams.get('session_id') || '').trim();
    if (!sessionId || !env.DB) {
      return jsonResponse({ error: 'session_id required' }, 400);
    }
    const sess = await env.DB.prepare(
      'SELECT workspace_id, tenant_id FROM terminal_sessions WHERE id = ? LIMIT 1',
    )
      .bind(sessionId)
      .first();
    const tenantId = sess?.tenant_id != null ? String(sess.tenant_id).trim() : '';
    if (!tenantId) {
      return jsonResponse({ error: 'session_not_found' }, 404);
    }
    const { results } = await env.DB.prepare(
      `SELECT model_key,
              display_name AS name,
              provider,
              api_platform,
              tier AS size_class,
              0 AS sort_order
       FROM agentsam_model_catalog
       WHERE COALESCE(is_active, 1) = 1
         AND COALESCE(show_in_picker, 0) = 1
         AND model_key IS NOT NULL
       ORDER BY provider ASC, display_name ASC`,
    ).all();
    return jsonResponse({ models: results || [] });
  }

  // POST /api/terminal/assist
  if (path === '/api/terminal/assist' && method === 'POST') {
    const auth  = request.headers.get('Authorization') || request.headers.get('x-pty-auth') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim();

    let body = {};
    try { body = await request.json(); } catch (_) {}

    const { mode, context, command, output, exit_code, model_key: modelKeyOverride } = body;
    const identityHints = resolveTerminalAssistIdentity(null, body);
    if (!(await ptyBackendBearerValid(env, token, identityHints.userId, identityHints.workspaceId))) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    // Strip ANSI escape codes from terminal output
    const cleanOutput = (output || '')
      .replace(/\x1b\[[0-9;]*[mGKHF]/g, '')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && l.length < 300)
      .slice(-15)
      .join('\n');

    // Build prompt based on mode
    const prompts = {
      error: `A shell command produced an error. Explain what went wrong and suggest a fix in 3-5 lines.
Command: ${command || 'unknown'}
Exit code: ${exit_code ?? 1}
Output:
${cleanOutput}`,

      fix: `Suggest a fix for this failed command in 2-3 lines. Be specific.
Command: ${command || 'unknown'}
Output:
${cleanOutput}`,

      explain: `Explain this briefly in plain English (3-5 lines max):
${context || cleanOutput}`,

      ask: `Answer this concisely (under 10 lines). Plain text, no markdown headers:
${context || ''}
${cleanOutput ? `\nTerminal context:\n${cleanOutput}` : ''}`,

      agent: `You are Agent Sam. The user needs help with:
${context || command || ''}
${cleanOutput ? `\nRecent terminal output:\n${cleanOutput}` : ''}
Complete this task or provide a specific actionable response.`,
    };

    const userPrompt = prompts[mode] || prompts.ask;
    const assistMode = mode != null ? String(mode) : 'ask';
    const runStartedAt = Date.now();

    let sess = null;
    if (identityHints.sessionId && env.DB) {
      sess = await env.DB.prepare(
        'SELECT workspace_id, tenant_id, user_id FROM terminal_sessions WHERE id = ? LIMIT 1',
      )
        .bind(identityHints.sessionId)
        .first();
    }
    const { sessionId, workspaceId, tenantId, userId } = resolveTerminalAssistIdentity(sess, body);
    if (!workspaceId) {
      console.warn('[terminal_assist] session_not_found', {
        session_id: sessionId || null,
        has_d1_row: !!sess,
      });
      return jsonResponse({ error: 'session_not_found', detail: 'terminal session is not bound to a workspace' }, 404);
    }

    let modelKey = '';
    const override = String(modelKeyOverride || '').trim();
    if (override) {
      const allowed = await env.DB.prepare(
        `SELECT model_key FROM agentsam_model_catalog
         WHERE model_key = ? AND COALESCE(is_active, 1) = 1
         LIMIT 1`,
      )
        .bind(override)
        .first();
      if (allowed?.model_key) {
        modelKey = String(allowed.model_key);
      } else {
        logTerminalAssistError(env, ctx, {
          workspaceId,
          tenantId,
          sessionId: sessionId || null,
          errorCode: 'model_not_allowed',
          errorMessage: `model_not_allowed: ${override}`,
          mode: assistMode,
          command: command ?? null,
        });
        return jsonResponse({ error: 'model_not_allowed', model_key: override }, 400);
      }
    } else {
      try {
        const resolved = await resolveModelForTask(env, {
          task_type: normalizeCanonicalTaskType('terminal_execution'),
          mode: 'agent',
          workspace_id: workspaceId,
        });
        modelKey = String(resolved?.model_key || '').trim();
      } catch (e) {
        const detail = e?.message != null ? String(e.message) : 'model_resolve_failed';
        logTerminalAssistError(env, ctx, {
          workspaceId,
          tenantId,
          sessionId: sessionId || null,
          errorCode: 'model_resolve_failed',
          errorMessage: detail,
          mode: assistMode,
          command: command ?? null,
        });
        return jsonResponse({ error: 'model_resolve_failed', detail }, 500);
      }
      if (!modelKey) {
        logTerminalAssistError(env, ctx, {
          workspaceId,
          tenantId,
          sessionId: sessionId || null,
          errorCode: 'model_resolve_empty',
          errorMessage: 'model_resolve_empty',
          mode: assistMode,
          command: command ?? null,
        });
        return jsonResponse({ error: 'model_resolve_empty' }, 500);
      }
    }

    const agentRunId =
      userId && workspaceId ? mintTerminalAssistAgentRunId(env, ctx, { userId, workspaceId }) : null;
    if (agentRunId) {
      startTerminalAssistAgentRun(env, ctx, {
        agentRunId,
        userId,
        tenantId,
        workspaceId,
        sessionId: sessionId || null,
        modelKey,
        mode: assistMode,
      });
    }

    const systemPrompt = `You are a developer assistant embedded in the IAM terminal.
Be concise. Plain text only. No markdown headers. Dashes not bullet asterisks.
Max 10 lines unless more detail is essential.`;

    try {
      // Blocking JSON — ExecOS handleAssist expects { text }, not SSE.
      const result = await dispatchComplete(env, {
        modelKey,
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        userId: userId || undefined,
        options: {
          reasoningEffort: assistMode === 'agent' ? 'medium' : 'none',
          verbosity: 'low',
        },
      });

      const text =
        result?.content?.[0]?.text ||
        result?.choices?.[0]?.message?.content ||
        result?.text ||
        result?.output_text ||
        (typeof result === 'string' ? result : JSON.stringify(result));

      const usage = extractDispatchUsage(result);
      if (agentRunId) {
        await finalizeTerminalAssistAgentRun(env, ctx, {
          agentRunId,
          userId,
          tenantId,
          workspaceId,
          sessionId: sessionId || null,
          modelKey,
          mode: assistMode,
          command: command ?? null,
          success: true,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          durationMs: Date.now() - runStartedAt,
        });
      }

      return jsonResponse({
        text: String(text).slice(0, 1200),
        ...(agentRunId ? { agent_run_id: agentRunId } : {}),
      });
    } catch (e) {
      const detail = e?.message != null ? String(e.message) : 'assist failed';
      console.warn('[terminal_assist] failed', {
        session_id: sessionId || null,
        workspace_id: workspaceId,
        detail: detail.slice(0, 300),
      });
      if (agentRunId) {
        await finalizeTerminalAssistAgentRun(env, ctx, {
          agentRunId,
          userId,
          tenantId,
          workspaceId,
          sessionId: sessionId || null,
          modelKey,
          mode: assistMode,
          command: command ?? null,
          success: false,
          errorMessage: detail,
          durationMs: Date.now() - runStartedAt,
        });
      } else if (tenantId) {
        logTerminalAssistError(env, ctx, {
          workspaceId,
          tenantId,
          sessionId: sessionId || null,
          errorCode: 'terminal_assist_failed',
          errorMessage: detail,
          mode: assistMode,
          command: command ?? null,
        });
      }
      return jsonResponse({ error: 'assist failed', detail }, 500);
    }
  }

  return jsonResponse({ error: 'not found' }, 404);
}
