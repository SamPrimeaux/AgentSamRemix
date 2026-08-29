import { userIdIsIamTunnelOwner } from '../../identity/workspace/grants.js';
import { resolveInteractivePtyShell } from './unix-identity.js';
import { resolveTerminalExecIdentity, buildExecTransportHeaders } from './privileged-targets.js';
import { resolveConnectionAuthToken } from './connection-auth.js';
import { resolveTerminalCwd } from './pty-workspace-paths.js';
import { resolveTerminalExecutionPlan } from './execution-plan.js';
import { tryContainerPtyConnect } from '../sandbox/my-container.js';
import {
  assertTerminalBinding,
  buildTerminalBinding,
  hostKindForTerminalLane,
} from './terminal-binding.js';
import {
  applyOwnedPtyQueryParams,
  applyRestoredPtySelection,
  assertPtyAttemptCurrent,
  bumpPtyConnectGeneration,
  createPtyDialAbort,
  isPtyBackendCurrent,
  normalizeWebSocketUrl,
  requireHostPtyCwd,
  requireSelectedTerminalConnection,
} from './pty-connection-safety.js';

export { normalizeWebSocketUrl } from './pty-connection-safety.js';

export async function persistPtySessionContext(session) {
  try {
    await session.ctx.storage.put('pty_session_ctx', {
      workspaceId: String(session.workspaceId || '').trim(),
      userId: String(session.ptSessionUserId || '').trim(),
      tenantId: String(session.ptSessionTenantId || '').trim(),
      personUuid: String(session.ptPersonUuid || '').trim(),
      targetType: String(session.requestedTargetType || session.selectedTargetType || '').trim(),
      connectionId: String(session.requestedConnectionId || '').trim(),
      shell: String(session.terminalShellOverride || '').trim(),
      updatedAt: Date.now(),
    });
  } catch {}
}

export async function restorePtySessionContext(session, opts = {}) {
  const storage = session?.ctx?.storage;
  if (!storage) return;
  try {
    const ctx = await storage.get('pty_session_ctx');
    if (!ctx || typeof ctx !== 'object') return;
    if (!String(session.workspaceId || '').trim() && ctx.workspaceId) session.workspaceId = String(ctx.workspaceId).trim();
    if (!String(session.ptSessionUserId || '').trim() && ctx.userId) session.ptSessionUserId = String(ctx.userId).trim();
    if (!String(session.ptSessionTenantId || '').trim() && ctx.tenantId) session.ptSessionTenantId = String(ctx.tenantId).trim();
    if (!String(session.ptPersonUuid || '').trim() && ctx.personUuid) session.ptPersonUuid = String(ctx.personUuid).trim();
    applyRestoredPtySelection(session, ctx, {
      explicitTarget: opts.explicitTarget || session.requestedTargetType || '',
    });
    if (ctx.shell && !String(session.terminalShellOverride || '').trim()) {
      session.terminalShellOverride = String(ctx.shell).trim();
    }
  } catch {}
}

function markBackendPtyConnected(session, targetType, connectionId) {
  session.ptyConnectedTargetType = String(targetType || '').trim() || null;
  session.ptyConnectedConnectionId = String(connectionId || '').trim() || null;
}

function clearBackendPtyMarkers(session, pty) {
  if (session.ptyWs === pty) {
    session.ptyWs = null;
    session.ptyConnectedTargetType = null;
    session.ptyConnectedConnectionId = null;
  }
}

/**
 * Bind the Worker-minted `terminal_sessions.id` onto the backend PTY URL.
 * Assist looks up that id. Missing it is fatal for attach (not silently empty).
 *
 * @param {string} url
 * @param {{ sessionId?: string | null, sessionToken?: string | null }} [opts]
 */
export function appendPtyBackendSessionParams(url, opts = {}) {
  const raw = String(url || '');
  const sid = opts.sessionId != null ? String(opts.sessionId).trim() : '';
  if (!sid) return raw;
  return applyOwnedPtyQueryParams(raw, {
    session_id: sid,
    session_token: opts.sessionToken != null ? String(opts.sessionToken).trim() : '',
  });
}

async function withPtyBackendSession(session, url, conn) {
  const sid = await session.getOrCreateTerminalSessionId();
  if (!String(sid || '').trim()) {
    const err = new Error('terminal_session_id_required');
    err.code = 'terminal_session_id_required';
    throw err;
  }
  const minted =
    String(conn?.auth_mode || '').trim() === 'token_mint' && session.ptSessionMintedToken
      ? String(session.ptSessionMintedToken).trim()
      : '';
  return appendPtyBackendSessionParams(url, { sessionId: sid, sessionToken: minted });
}

function closeBackendPtyQuietly(session) {
  const pty = session.ptyWs;
  if (!pty) {
    session.ptyConnectedTargetType = null;
    session.ptyConnectedConnectionId = null;
    return;
  }
  try {
    pty.close(1000, 'lane_switch');
  } catch {
    /* ignore */
  }
  clearBackendPtyMarkers(session, pty);
}

/**
 * Reuse an open backend PTY only when lane + connection still match the request.
 * Otherwise tear down and redial — otherwise Local→VM keeps Sams-iMac under a VM label.
 */
export function shouldReuseOpenPty(session, desiredTargetType, desiredConnectionId = '') {
  const pty = session.ptyWs;
  if (!pty || pty.readyState !== 1) return false;
  const desiredTt = String(desiredTargetType || '').trim();
  const connectedTt = String(session.ptyConnectedTargetType || '').trim();
  if (!desiredTt || !connectedTt || desiredTt !== connectedTt) return false;
  const desiredConn = String(desiredConnectionId || '').trim();
  const connectedConn = String(session.ptyConnectedConnectionId || '').trim();
  if (desiredConn && connectedConn && desiredConn !== connectedConn) return false;
  return true;
}

export async function ensurePtyConnected(session, opts = {}) {
  if (opts?.workspaceId) {
    const w = String(opts.workspaceId).trim();
    if (w) session.workspaceId = w;
  }
  if (opts?.userId) {
    const u = String(opts.userId).trim();
    if (u) session.ptSessionUserId = u;
  }
  const explicitTarget = opts?.targetType != null ? String(opts.targetType).trim() : '';
  if (explicitTarget) {
    session.requestedTargetType = explicitTarget;
    session.selectedTargetType = explicitTarget;
  }
  await restorePtySessionContext(session, { explicitTarget });
  // Re-assert explicit request after restore (storage must not win over this attach).
  if (explicitTarget) {
    session.requestedTargetType = explicitTarget;
    session.selectedTargetType = explicitTarget;
  }

  const desiredTt = String(
    session.requestedTargetType || session.selectedTargetType || '',
  ).trim();
  const desiredConn = String(
    session.requestedConnectionId || session.selectedTerminalConnection?.id || '',
  ).trim();

  if (shouldReuseOpenPty(session, desiredTt, desiredConn)) return;

  if (session.ptyWs) closeBackendPtyQuietly(session);

  const pendingSameRequest =
    session.ptyConnectPromise &&
    String(session.ptyConnectTargetType || '').trim() === desiredTt &&
    String(session.ptyConnectConnectionId || '').trim() === desiredConn;
  if (pendingSameRequest) return session.ptyConnectPromise;

  // Distinct dial: bump generation (aborts the previous dial) then start connect.
  bumpPtyConnectGeneration(session);
  session.ptyConnectTargetType = desiredTt || null;
  session.ptyConnectConnectionId = desiredConn || null;

  const promise = session.connectPty().finally(() => {
    if (session.ptyConnectPromise === promise) {
      session.ptyConnectPromise = null;
      session.ptyConnectTargetType = null;
      session.ptyConnectConnectionId = null;
    }
  });
  session.ptyConnectPromise = promise;
  return promise;
}

/** Hibernation tag on in-app terminal *frontend* sockets (browser/phone). Not a lane or Cloudflare Tunnel name. Backend PTY is session.ptyWs. */
const TERMINAL_WS_TAG = 'terminal';

function toFetchWebSocketUrl(wsUrl) {
  const u = String(wsUrl || '').trim();
  if (u.startsWith('wss://')) return 'https://' + u.slice(6);
  if (u.startsWith('ws://')) return 'http://' + u.slice(5);
  return u;
}

function messageToString(input) {
  if (typeof input === 'string') return input;
  if (input instanceof ArrayBuffer) return new TextDecoder().decode(input);
  if (input instanceof Uint8Array) return new TextDecoder().decode(input);
  if (input == null) return '';
  return String(input);
}

function websocketUpgradeHeaders(execHeaders) {
  return {
    Upgrade: 'websocket',
    Connection: 'Upgrade',
    'Sec-WebSocket-Key': btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))),
    'Sec-WebSocket-Version': '13',
    ...execHeaders,
  };
}

export async function connectPty(session) {
    const attemptGeneration = Number(session.ptyConnectGeneration || 0);
    if (!session.ptyConnectAbort) session.ptyConnectAbort = new AbortController();
    await session.restorePtySessionContext();
    const wid = String(session.workspaceId || "").trim();
    if (!wid) throw new Error("PTY workspace_id missing");
    const uid = String(session.ptSessionUserId || "").trim();
    if (!uid) throw new Error("PTY user_id missing");
    let tid = await session.resolvePtyTenantForSession(uid);
    tid = tid != null ? String(tid).trim() : "";
    if (!tid) throw new Error("PTY tenant_id missing");
    session.ptSessionTenantId = tid;
    await session.persistPtySessionContext();
    assertPtyAttemptCurrent(session, attemptGeneration);

    const requestedTt = String(session.requestedTargetType || session.selectedTargetType || '').trim();
    let conn = null;
    if (!session.env?.DB) {
      if (requestedTt !== 'sandbox') {
        const err = new Error('connection_missing');
        err.code = 'connection_missing';
        throw err;
      }
    } else {
      const sel = await session.selectTerminalConnection({
        userId: uid,
        workspaceId: wid,
        tenantId: tid,
        connectionId: session.requestedConnectionId || null,
        targetType: session.requestedTargetType || null,
        healthAware: true,
      });
      conn = requireSelectedTerminalConnection(sel, {
        targetType: session.requestedTargetType || sel?.connection?.target_type || requestedTt,
      });
      session.selectedTerminalConnection = conn;
    }
    assertPtyAttemptCurrent(session, attemptGeneration);

    const plan = await resolveTerminalExecutionPlan(session, {
      protocol: 'pty',
      connection: conn,
      targetType: session.requestedTargetType || session.selectedTargetType || conn?.target_type || null,
      targetId: session.requestedConnectionId || conn?.id || null,
      userId: uid,
      workspaceId: wid,
      tenantId: tid,
    });
    const targetType = String(plan.target_type || '').trim();
    if (!targetType) throw new Error('target_type_required');
    if (targetType === "ssh_target") throw new Error("ssh_target_not_enabled");
    if (plan.forbidden) throw new Error('operator_lane_forbidden');
    assertPtyAttemptCurrent(session, attemptGeneration);

    session.selectedTargetType = targetType;
    await session.applyPtyWorkingDir(tid, uid, conn);

    let resolvedWsUrl = null;
    if (conn?.ws_url?.trim()) resolvedWsUrl = conn.ws_url.trim();
    const token =
      (await resolveConnectionAuthToken(session.env, conn, uid, wid)) ||
      String(session.env?.PTY_AUTH_TOKEN || session.env?.TERMINAL_SECRET || "").trim();

    const isTunnelOwner = await userIdIsIamTunnelOwner(session.env, uid);
    const requestedShell =
      String(session.terminalShellOverride || conn?.shell || "/bin/bash").trim() || "/bin/bash";
    const shellOpt = resolveInteractivePtyShell({
      isTunnelOwner,
      targetLane: plan.target_lane,
      targetType,
      requestedShell,
    });
    const cwdResult = await resolveTerminalCwd(session.env, {
      connection: conn,
      tenantId: tid,
      userId: uid,
      workspaceId: wid,
    });
    const cwdOpt = requireHostPtyCwd(cwdResult, plan.target_lane) || '';
    const execIdentity = await resolveTerminalExecIdentity(session.env?.DB, conn, null, {
      env: session.env,
      userId: uid,
      workspaceId: wid,
    });
    const execHeaders = buildExecTransportHeaders({
      ...execIdentity,
      userId: uid,
    });
    assertPtyAttemptCurrent(session, attemptGeneration);

    /**
     * Attach backend PTY once; refuse Connected on binding mismatch.
     * Commit socket current *before* broadcasting, after accept().
     * Stale generation closes the socket and does not mutate session/UI.
     * @param {WebSocket} pty
     * @param {{ host_kind: string, transport: string, cwd?: string|null, target_id?: string|null }} connectedMeta
     */
    const attachBackendPty = (pty, connectedMeta) => {
      if (Number(session.ptyConnectGeneration || 0) !== attemptGeneration) {
        try {
          pty.close(1000, 'stale_connect');
        } catch (_) {}
        return false;
      }

      const binding = buildTerminalBinding(plan, {
        host_kind: connectedMeta.host_kind,
        transport: connectedMeta.transport,
        cwd: connectedMeta.cwd || cwdOpt || plan.cwd,
        target_id: connectedMeta.target_id || conn?.id || plan.target_id,
      });
      assertTerminalBinding(
        {
          lane: plan.target_lane,
          target_type: targetType,
          host_kind: hostKindForTerminalLane(plan.target_lane, targetType),
        },
        binding,
      );

      const prevWs = session.ptyWs;
      const prevBinding = session.terminalBinding;
      const prevPlan = session.currentTerminalExecutionPlan;
      try {
        pty.accept();
        session.ptyWs = pty;
        session.terminalBinding = binding;
        session.currentTerminalExecutionPlan = { ...plan, ...binding, cwd: binding.cwd };
        markBackendPtyConnected(session, targetType, binding.target_id);
      } catch (e) {
        if (session.ptyWs === pty) {
          session.ptyWs = prevWs;
          session.terminalBinding = prevBinding;
          session.currentTerminalExecutionPlan = prevPlan;
          session.ptyConnectedTargetType = null;
          session.ptyConnectedConnectionId = null;
        }
        throw e;
      }

      const onBackendEvent = (kind, fn) => {
        if (!isPtyBackendCurrent(session, pty, attemptGeneration)) return;
        fn();
      };

      pty.addEventListener('message', (evt) => {
        onBackendEvent('message', () => {
          try {
            const t = messageToString(evt.data);
            if (t) session.recordPtyOutputChunk(t);
          } catch (_) {}
          for (const ws of session.ctx.getWebSockets(TERMINAL_WS_TAG)) {
            try {
              ws.send(evt.data);
            } catch (_) {}
          }
        });
      });
      pty.addEventListener('close', () => {
        onBackendEvent('close', () => {
          try {
            session.flushPtyOutputBuffer();
          } catch (_) {}
          for (const ws of session.ctx.getWebSockets(TERMINAL_WS_TAG)) {
            try {
              session.sendStateToWebSocket(ws, 'disconnected');
            } catch (_) {}
          }
          clearBackendPtyMarkers(session, pty);
          if (session.ptyWs == null) session.terminalBinding = null;
        });
      });
      pty.addEventListener('error', () => {
        onBackendEvent('error', () => {
          for (const ws of session.ctx.getWebSockets(TERMINAL_WS_TAG)) {
            try {
              session.sendStateToWebSocket(ws, 'backend_unavailable', 'PTY connection error');
            } catch (_) {}
          }
          clearBackendPtyMarkers(session, pty);
          if (session.ptyWs == null) session.terminalBinding = null;
        });
      });
      session.broadcastState('connected', null, { binding });
      return true;
    };

    const dial = createPtyDialAbort(session);
    try {
      // Sandbox → MY_CONTAINER /v1/pty only (never GCP ws_url).
      if (plan.target_lane === 'sandbox') {
        let sandboxCwd = '/tmp';
        try {
          const { resolveSandboxContainerCwd } = await import('../sandbox/r2-fuse-env.js');
          sandboxCwd = await resolveSandboxContainerCwd(session.env, {
            workspaceId: wid,
            zoneSlug: 'specialist',
          });
        } catch (_) {
          sandboxCwd = '/tmp';
        }
        assertPtyAttemptCurrent(session, attemptGeneration);
        const containerPty = await tryContainerPtyConnect(session.env, {
          cwd: sandboxCwd,
          shell: shellOpt,
        });
        if (!containerPty.ok || !containerPty.webSocket) {
          throw new Error(containerPty.error || 'sandbox_interactive_pty_unavailable');
        }
        attachBackendPty(containerPty.webSocket, {
          host_kind: 'cf_container',
          transport: 'container_ws',
          cwd: containerPty.cwd || sandboxCwd,
          target_id: `container:${resolveContainerPoolLabel(session.env)}`,
        });
        return;
      }

      // VM → PTY_SERVICE VPC only when bound (no opportunistic public hop).
      if (plan.target_lane === 'remote' && session.env?.PTY_SERVICE) {
        const vpcUrl = new URL('http://localhost:3099/terminal');
        const vpcHref = applyOwnedPtyQueryParams(vpcUrl.toString(), {
          tenant_id: tid,
          user_id: uid,
          workspace_id: wid,
          shell: shellOpt,
          cwd: cwdOpt || '',
        });
        const vpcWithSession = await withPtyBackendSession(session, vpcHref, conn);
        assertPtyAttemptCurrent(session, attemptGeneration);
        let resp;
        try {
          resp = await session.env.PTY_SERVICE.fetch(
            new Request(vpcWithSession, {
              headers: websocketUpgradeHeaders(execHeaders),
              signal: dial.signal,
            }),
          );
        } catch (e) {
          if (e?.name === 'AbortError' || e?.code === 'pty_dial_timeout' || String(e?.message || '').includes('pty_dial_timeout')) {
            throw Object.assign(new Error('pty_dial_timeout'), { code: 'pty_dial_timeout' });
          }
          throw new Error(e?.message || 'vpc_pty_unavailable');
        }
        if (resp.status !== 101 || !resp.webSocket) {
          throw new Error(`vpc_pty_unavailable_${resp.status}`);
        }
        attachBackendPty(resp.webSocket, {
          host_kind: hostKindForTerminalLane('remote', targetType),
          transport: 'vpc',
          cwd: cwdOpt,
          target_id: conn?.id || plan.target_id,
        });
        return;
      }

      // Public WebSocket fallthrough — two different tunnels, never cross-substituted.
      // local  → user-hosted tunnel (darwin / localpty). URL from that connection row only.
      // remote → Linux VM public/tunnel URL, only when PTY_SERVICE (VPC) is unbound above.
      if (plan.target_lane !== 'local' && plan.target_lane !== 'remote') {
        throw new Error('unsupported_target_lane');
      }

      const isLocalLane = plan.target_lane === 'local';
      const rawUrl = isLocalLane
        ? resolvedWsUrl
        : String(
            session.workspaceSettings?.terminal_ws_url ||
              resolvedWsUrl ||
              session.env?.TERMINAL_WS_URL ||
              '',
          ).trim();
      if (!rawUrl || !token) {
        throw new Error(
          isLocalLane
            ? 'user_hosted_tunnel_unreachable'
            : 'PTY backend is not configured — set PTY_SERVICE (vpc_services) or TERMINAL_WS_URL + PTY_AUTH_TOKEN',
        );
      }
      const wsUrl = applyOwnedPtyQueryParams(normalizeWebSocketUrl(rawUrl), {
        token,
        tenant_id: tid,
        user_id: uid,
        workspace_id: wid,
        shell: shellOpt,
        cwd: cwdOpt || '',
      });
      const wsUrlWithSession = await withPtyBackendSession(session, wsUrl, conn);
      assertPtyAttemptCurrent(session, attemptGeneration);
      const wsResp = await fetch(toFetchWebSocketUrl(wsUrlWithSession), {
        headers: websocketUpgradeHeaders(execHeaders),
        signal: dial.signal,
      });
      if (wsResp.status !== 101 || !wsResp.webSocket) {
        throw new Error(`websocket_attach_failed: PTY connect failed (${wsResp.status})`);
      }
      attachBackendPty(wsResp.webSocket, {
        host_kind: hostKindForTerminalLane(plan.target_lane, targetType),
        transport: isLocalLane ? 'cloudflare_tunnel' : 'public_tunnel',
        cwd: cwdOpt,
        target_id: conn?.id || plan.target_id,
      });
    } finally {
      dial.dispose();
    }
  }

function resolveContainerPoolLabel(env) {
  try {
    const fromEnv = String(env?.CONTAINER_POOL_ID || '').trim();
    return fromEnv || 'inneranimalmedia';
  } catch (_) {
    return 'inneranimalmedia';
  }
}
