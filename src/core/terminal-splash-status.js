/**
 * GET /api/terminal/splash-status — workspace-scoped splash UI payload.
 * Dock selection is SSOT: never invent a preferred lane from readiness.
 */
import { pingTunnelHealth } from '../../backend/http/agentsam/routes/git-status-runtime.js';
import { buildTerminalConfigStatus } from './terminal-config-status.js';
import { userCanRunPtyFromPolicy } from '../../backend/http/agentsam/routes/pty-policy.js';
import { getPtyTunnelStatus } from './pty-tunnel-provisioner.js';
import { resolvePtyTenantIdForUser } from '../../backend/agentsam/terminal/pty-workspace-paths.js';

function truncate(s, max = 20) {
  const t = String(s || '').trim();
  if (!t) return '';
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function laneTone(ok, pending = false) {
  if (pending) return 'loading';
  if (ok === true) return 'ok';
  if (ok === false) return 'warn';
  return 'muted';
}

/** @param {unknown} raw */
export function normalizeSplashTargetType(raw) {
  const t = String(raw || '').trim();
  if (t === 'user_hosted_tunnel' || t === 'local') return 'user_hosted_tunnel';
  if (t === 'platform_vm' || t === 'remote' || t === 'cloud') return 'platform_vm';
  if (t === 'sandbox') return 'sandbox';
  return null;
}

/** Splash UI lane key for a selected target_type — null when unset. */
function splashLaneKeyFromTargetType(targetType) {
  if (targetType === 'user_hosted_tunnel') return 'local';
  if (targetType === 'platform_vm') return 'cloud';
  if (targetType === 'sandbox') return 'sandbox';
  return null;
}

/**
 * Runtime chip for the dock-selected lane only. No readiness ranking.
 * @param {any} targets
 * @param {'user_hosted_tunnel'|'platform_vm'|'sandbox'|null} selectedTargetType
 */
function resolveRuntimeForSelectedLane(targets, selectedTargetType) {
  if (!targets?.can_run_pty) {
    return { label: 'Runtime', value: 'disabled', tone: 'warn', selected: null };
  }
  if (!selectedTargetType) {
    return { label: 'Runtime', value: 'select lane', tone: 'muted', selected: null };
  }
  if (selectedTargetType === 'user_hosted_tunnel') {
    const ready = targets.local?.ready === true;
    const configured = targets.local?.configured === true;
    return {
      label: 'Runtime',
      value: ready ? 'Local · ready' : configured ? 'Local · setup' : 'Local · offline',
      tone: ready ? 'ok' : 'warn',
      selected: 'local',
    };
  }
  if (selectedTargetType === 'platform_vm') {
    const ready = targets.cloud?.ready === true;
    const configured = targets.cloud?.configured === true;
    return {
      label: 'Runtime',
      value: ready ? 'VM · ready' : configured ? 'VM · setup' : 'VM · offline',
      tone: ready ? 'ok' : 'warn',
      selected: 'cloud',
    };
  }
  const ready = targets.sandbox?.ready === true;
  const configured = targets.sandbox?.configured === true;
  return {
    label: 'Runtime',
    value: ready ? 'Container · ready' : configured ? 'Container · setup' : 'Container · offline',
    tone: ready ? 'ok' : 'warn',
    selected: 'sandbox',
  };
}

/**
 * @param {any} env
 * @param {{ id: string }} authUser
 * @param {string} workspaceId
 */
export async function buildTerminalLaneTargets(env, authUser, workspaceId, deps = {}) {
  const wid = String(workspaceId || '').trim();
  const canPty = await userCanRunPtyFromPolicy(env, authUser.id, wid);
  if (!canPty) {
    return {
      can_run_pty: false,
      workspace_id: wid,
      error: 'terminal_not_enabled',
      local: { target_type: 'user_hosted_tunnel', ready: false, configured: false },
      cloud: { target_type: 'platform_vm', ready: false, configured: false },
      sandbox: { target_type: 'sandbox', ready: false, configured: false },
    };
  }

  const twCfg = { workspaceId: wid };
  const [localCfg, cloudCfg, sandboxCfg] = await Promise.all([
    buildTerminalConfigStatus(env, authUser, twCfg, { target_type: 'user_hosted_tunnel' }, deps),
    buildTerminalConfigStatus(env, authUser, twCfg, { target_type: 'platform_vm' }, deps),
    buildTerminalConfigStatus(env, authUser, twCfg, { target_type: 'sandbox' }, deps),
  ]);

  // Cost law: splash is passive — never wake MY_CONTAINER on every dashboard load.
  const containerReady = sandboxCfg.terminal_configured === true;

  const localRow = await deps.getUserHostedTunnelConnection?.(env.DB, authUser.id, wid) || null;
  const localShell = localRow?.shell != null ? String(localRow.shell).trim() : null;
  const localWs = localRow?.ws_url != null ? String(localRow.ws_url).trim() : '';
  const localActive = Number(localRow?.is_active) === 1 && !!localWs;

  return {
    can_run_pty: true,
    workspace_id: wid,
    local: {
      target_type: 'user_hosted_tunnel',
      ready: localCfg.terminal_configured === true || localActive,
      configured: localActive || localCfg.terminal_configured === true,
      connection_id: localCfg.selected_connection_id ?? null,
      shell: localShell,
      error_code: localCfg.error_code ?? null,
      cwd: localCfg.cwd ?? null,
    },
    cloud: {
      target_type: 'platform_vm',
      ready: cloudCfg.terminal_configured === true || !!env.PTY_SERVICE,
      configured: cloudCfg.terminal_configured === true,
      connection_id: cloudCfg.selected_connection_id ?? null,
      error_code: cloudCfg.error_code ?? null,
      cwd: cloudCfg.cwd ?? null,
      pty_service_bound: cloudCfg.pty_service_bound === true,
    },
    sandbox: {
      target_type: 'sandbox',
      ready: containerReady || sandboxCfg.terminal_configured === true,
      configured: containerReady || sandboxCfg.terminal_configured === true,
      connection_id: sandboxCfg.selected_connection_id ?? null,
      ws_url_present: sandboxCfg.selected_connection_ws_url_present === true,
      container_ready: containerReady,
      error_code: sandboxCfg.error_code ?? null,
      cwd: sandboxCfg.cwd ?? null,
    },
  };
}

/**
 * @param {any} env
 * @param {{ id: string, tenant_id?: string|null }} authUser
 * @param {string} workspaceId
 * @param {{
 *   authWorkspaceId?: string|null,
 *   targetType?: string|null,
 *   execLane?: string|null,
 * }} [opts]
 */
export async function buildTerminalSplashStatus(env, authUser, workspaceId, opts = {}, deps = {}) {
  const wid = String(workspaceId || '').trim();
  const authWorkspaceId = opts.authWorkspaceId != null ? String(opts.authWorkspaceId).trim() : wid;
  const selectedTargetType =
    normalizeSplashTargetType(opts.targetType) ||
    normalizeSplashTargetType(opts.execLane);

  const [targets, workspaceRow, tunnelPty, tunnelPlatform, recentTerminalErrors] = await Promise.all([
    buildTerminalLaneTargets(env, authUser, wid, deps),
    env?.DB
      ? env.DB.prepare(
          `SELECT w.id, w.name, w.handle AS slug, w.github_repo
             FROM workspaces w
            WHERE w.id = ?
            LIMIT 1`,
        )
          .bind(wid)
          .first()
          .catch(() => null)
      : Promise.resolve(null),
    (async () => {
      const tid = await resolvePtyTenantIdForUser(env, authUser, authUser.id);
      return getPtyTunnelStatus(env, {
        userId: authUser.id,
        tenantId: tid || '',
        workspaceId: wid,
      }, deps).catch(() => null);
    })(),
    pingTunnelHealth(env).catch(() => ({ healthy: false, status: 'disconnected' })),
    // Live signal — never iam_system_health (stale, no writers).
    wid && env?.DB
      ? env.DB.prepare(
          `SELECT COUNT(*) AS c
             FROM agentsam_error_log
            WHERE workspace_id = ?
              AND COALESCE(resolved, 0) = 0
              AND created_at > unixepoch() - 7200
              AND (
                lower(COALESCE(source, '')) LIKE '%terminal%'
                OR lower(COALESCE(source, '')) LIKE '%exec%'
                OR lower(COALESCE(error_type, '')) LIKE '%terminal%'
                OR lower(COALESCE(error_type, '')) LIKE '%exec%'
                OR lower(COALESCE(error_message, '')) LIKE '%terminal error%'
                OR lower(COALESCE(error_code, '')) LIKE '%vpc%'
                OR lower(COALESCE(error_code, '')) LIKE '%pty%'
              )`,
        )
          .bind(wid)
          .first()
          .then((r) => Number(r?.c) || 0)
          .catch(() => 0)
      : Promise.resolve(0),
  ]);

  const wsName =
    workspaceRow?.name != null ? String(workspaceRow.name).trim() : truncate(wid, 14);
  const wsSlug = workspaceRow?.slug != null ? String(workspaceRow.slug).trim() : '';
  const githubRepo =
    workspaceRow?.github_repo != null ? String(workspaceRow.github_repo).trim() : '';

  const runtime = resolveRuntimeForSelectedLane(targets, selectedTargetType);
  const selectedLane = splashLaneKeyFromTargetType(selectedTargetType);

  let cwd = null;
  let cdCommand = null;
  if (wid && selectedTargetType) {
    try {
      const cfg = await buildTerminalConfigStatus(env, authUser, { workspaceId: wid }, {
        target_type: selectedTargetType,
      }, deps);
      cwd = cfg?.cwd != null ? String(cfg.cwd).trim() : null;
      if (cwd) cdCommand = `cd ${JSON.stringify(cwd)}`;
    } catch {
      /* optional */
    }
  }

  const tunnelConnected =
    tunnelPty?.connection_active === true ||
    tunnelPlatform?.healthy === true ||
    tunnelPlatform?.status === 'connected';

  const tunnelValue = tunnelConnected
    ? 'connected'
    : tunnelPty?.hostname || tunnelPty?.tunnel_name
      ? 'idle'
      : 'offline';

  const controlPlane = !!env.AGENT_SESSION;
  const openTerminalErrs = Number(recentTerminalErrors) || 0;
  const agentValue = !controlPlane
    ? 'offline'
    : openTerminalErrs > 0
      ? 'degraded'
      : 'online';

  const isActiveContext = !!wid && authWorkspaceId === wid;

  return {
    ok: true,
    fetched_at: Date.now(),
    workspace_id: wid,
    workspace: {
      id: wid,
      name: wsName || null,
      slug: wsSlug || null,
      github_repo: githubRepo || null,
      is_active_context: isActiveContext,
      cwd,
      cd_command: cdCommand,
    },
    targets,
    /** @deprecated use selected_lane — never invents a preference */
    preferred_lane: null,
    selected_lane: selectedLane,
    selected_target_type: selectedTargetType,
    lanes: {
      workspace: {
        label: 'Workspace',
        name: wsName || null,
        value: wsName
          ? isActiveContext
            ? `${truncate(wsName, 16)} · active`
            : `${truncate(wsName, 16)} · switch`
          : 'select workspace',
        tone: wsName ? (isActiveContext ? 'ok' : 'warn') : 'muted',
        cwd: cwd || null,
      },
      runtime: {
        label: runtime.label,
        value: runtime.value,
        tone: runtime.tone,
      },
      tunnel: {
        label: 'Tunnel',
        value: tunnelValue,
        tone: laneTone(tunnelConnected),
        connection_active: tunnelPty?.connection_active === true,
        hostname: tunnelPty?.hostname ?? null,
      },
      agent: {
        label: 'Agent',
        value: agentValue,
        tone: agentValue === 'online' ? 'ok' : agentValue === 'degraded' ? 'warn' : 'muted',
        control_plane_bound: controlPlane,
        open_terminal_errors_2h: openTerminalErrs,
      },
    },
  };
}
