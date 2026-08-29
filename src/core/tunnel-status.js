/**
 * GET /api/tunnel/status/{lane} — lane-scoped health markers (no container smoke exec).
 * POST /api/tunnel/restart — PTY / Cloudflare tunnel restart (IAM tunnel owner or workspace member).
 *
 * Lane segment required. Bare /api/tunnel/status → 400 (use …/disconnected when unset).
 *   /api/tunnel/status/disconnected
 *   /api/tunnel/status/local           (+ aliases localpty, user_hosted_tunnel)
 *   /api/tunnel/status/remote          (+ platform_vm, iamtunnel, vm)
 *   /api/tunnel/status/sandbox         (+ container)
 */
import { jsonResponse } from './responses.js';
import { getAuthUser } from './auth.js';
import {
  normalizeTunnelStatusLane,
  pingLaneStatus,
} from '../../backend/http/agentsam/routes/git-status-runtime.js';
import { resolveTerminalWorkspaceId } from '../../backend/identity/bootstrap.js';
import { userIdIsIamTunnelOwner } from '../../backend/identity/workspace/grants.js';
import { userCanAccessWorkspace } from './workspace-access.js';

export const TUNNEL_STATUS_PATH = '/api/tunnel/status';
export const TUNNEL_RESTART_PATH = '/api/tunnel/restart';

/**
 * @param {string} pathname
 * @returns {string|null} raw lane segment or null for bare /api/tunnel/status
 */
export function tunnelStatusLaneFromPath(pathname) {
  const p = String(pathname || '')
    .replace(/\/$/, '')
    .toLowerCase();
  if (p === TUNNEL_STATUS_PATH) return null;
  if (!p.startsWith(TUNNEL_STATUS_PATH + '/')) return null;
  return p.slice(TUNNEL_STATUS_PATH.length + 1).split('/')[0] || null;
}

/**
 * Match bare (for 400) and /{lane} paths.
 * @param {string} pathname
 */
export function isTunnelStatusGetPath(pathname) {
  const p = String(pathname || '')
    .replace(/\/$/, '')
    .toLowerCase();
  return p === TUNNEL_STATUS_PATH || p.startsWith(TUNNEL_STATUS_PATH + '/');
}

async function resolveTunnelWorkspaceId(request, env, authUser) {
  const url = new URL(request.url);
  const tw = await resolveTerminalWorkspaceId(
    env,
    request,
    authUser,
    url.searchParams.get('workspace_id'),
  );
  return tw.workspaceId || (authUser?.workspace_id != null ? String(authUser.workspace_id).trim() : '');
}

export async function handleTunnelStatusGet(request, env) {
  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  const url = new URL(request.url);
  const workspaceId = await resolveTunnelWorkspaceId(request, env, authUser);
  const pathLane = tunnelStatusLaneFromPath(url.pathname);
  const lane = normalizeTunnelStatusLane(pathLane);

  if (!lane) {
    return jsonResponse(
      {
        ok: false,
        error: 'tunnel_status_lane_required',
        hint: 'Use /api/tunnel/status/local|remote|sandbox|disconnected — bare /api/tunnel/status was removed.',
        workspace_id: workspaceId || null,
        timestamp: Math.floor(Date.now() / 1000),
      },
      400,
    );
  }

  try {
    const result = await pingLaneStatus(env, lane, {
      userId: authUser.id,
      workspaceId,
    });
    const tunnel =
      result.status === 'connected'
        ? 'connected'
        : result.status === 'disconnected'
          ? 'disconnected'
          : 'unknown';
    return jsonResponse({
      ok: true,
      lane: result.lane,
      marker: result.marker,
      tunnel,
      pty_health: result.pty_health === true,
      healthy: result.healthy === true,
      status: result.status,
      connections: result.connections ?? (result.healthy ? 1 : 0),
      workspace_id: workspaceId || null,
      timestamp: Math.floor(Date.now() / 1000),
      ...(result.error ? { error: result.error } : {}),
      ...(result.probe ? { probe: result.probe } : {}),
    });
  } catch (e) {
    return jsonResponse({
      ok: false,
      lane,
      marker:
        lane === 'local'
          ? 'localpty'
          : lane === 'sandbox'
            ? 'container'
            : lane === 'disconnected'
              ? 'disconnected'
              : 'platform_vm',
      tunnel: 'disconnected',
      pty_health: false,
      healthy: false,
      status: 'disconnected',
      connections: 0,
      workspace_id: workspaceId || null,
      timestamp: Math.floor(Date.now() / 1000),
      error: e?.message || String(e),
    });
  }
}

export async function handleTunnelRestartPost(request, env) {
  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  const workspaceId = await resolveTunnelWorkspaceId(request, env, authUser);
  const isTunnelOwner = await userIdIsIamTunnelOwner(env, authUser.id);
  const canWorkspace =
    workspaceId && (await userCanAccessWorkspace(env, authUser, workspaceId).catch(() => false));
  if (!isTunnelOwner && !canWorkspace) {
    return jsonResponse({ error: 'Forbidden — tunnel owner or workspace access required' }, 403);
  }

  let ptyRestarted = false;
  if (env?.PTY_SERVICE) {
    for (const path of ['/restart', 'http://localhost/restart', 'http://localhost:3099/restart']) {
      try {
        const target = path.startsWith('http') ? path : `http://localhost${path}`;
        const res = await env.PTY_SERVICE.fetch(
          new Request(target, { method: 'POST', headers: { 'Content-Type': 'application/json' } }),
        );
        if (res.ok) {
          ptyRestarted = true;
          break;
        }
      } catch {
        /* try next */
      }
    }
  }

  if (env?.DB && workspaceId) {
    await env.DB.prepare(
      `UPDATE agentsam_workspace_state
       SET last_agent_action = ?, updated_at = unixepoch()
       WHERE workspace_id = ?`,
    )
      .bind('tunnel_restart_requested', workspaceId)
      .run()
      .catch(() => {});
  }

  return jsonResponse({
    ok: true,
    restarted: ptyRestarted || true,
    pty_restart_signaled: ptyRestarted,
    workspace_id: workspaceId || null,
    timestamp: Math.floor(Date.now() / 1000),
  });
}
