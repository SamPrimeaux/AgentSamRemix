/**
 * Build /api/agent/terminal/config-status payload (safe diagnostics only).
 */
import { userCanRunPtyFromPolicy } from '../../backend/http/agentsam/routes/pty-policy.js';
import { resolvePtyTenantIdForUser } from '../../backend/agentsam/terminal/pty-workspace-paths.js';
import { USER_PTY_TOKEN_SENTINEL } from '../../backend/credentials/user-secrets.js';

function connectionDbBridgeOk(env, conn, resolvedToken = null) {
  if (!conn) return false;
  const wsPart = String(conn.ws_url || '').trim();
  const tok = (() => {
    const pre = resolvedToken != null ? String(resolvedToken).trim() : '';
    if (pre) return pre;
    const secretName = String(conn.auth_token_secret_name || '').trim();
    if (secretName === USER_PTY_TOKEN_SENTINEL) return '';
    return secretName && env[secretName] != null ? String(env[secretName]).trim() : '';
  })();
  return !!(wsPart && tok) || String(conn.auth_mode || '').trim() === 'token_mint';
}

/**
 * Build /api/agent/terminal/config-status payload (safe diagnostics only).
 * target_type is required — never invents platform_vm / lane auto.
 */
export async function buildTerminalConfigStatus(env, authUser, twCfg, query = {}, deps = {}) {
  const baseDisabled = {
    terminal_enabled: false,
    terminal_configured: false,
    control_plane_available: false,
    direct_wss_available: false,
    error_code: null,
  };

  if (!authUser?.id) {
    return { ...baseDisabled, error_code: 'auth_missing' };
  }
  if (!twCfg?.workspaceId) {
    return { ...baseDisabled, error_code: twCfg?.error === 'Forbidden' ? 'policy_denied' : 'workspace_missing' };
  }

  const userId = String(authUser.id).trim();
  const workspaceId = String(twCfg.workspaceId).trim();
  const canPty = await userCanRunPtyFromPolicy(env, userId, workspaceId);
  if (!canPty) {
    return { ...baseDisabled, error_code: 'policy_denied' };
  }

  let tenantId = await resolvePtyTenantIdForUser(env, authUser, userId);
  tenantId = tenantId != null ? String(tenantId).trim() : '';
  if (!tenantId) {
    return { ...baseDisabled, terminal_enabled: false, error_code: 'tenant_missing' };
  }

  const targetTypeRaw = String(query.target_type || query.targetType || '').trim();
  if (!targetTypeRaw || targetTypeRaw === 'auto') {
    return {
      ...baseDisabled,
      terminal_enabled: true,
      user_id: userId,
      workspace_id: workspaceId,
      tenant_id: tenantId,
      can_run_pty: true,
      error_code: targetTypeRaw === 'auto' ? 'target_type_invalid' : 'target_type_required',
    };
  }
  let targetType;
  try {
    targetType = deps.requireTerminalConnectionTargetType(targetTypeRaw);
  } catch (e) {
    return {
      ...baseDisabled,
      terminal_enabled: true,
      user_id: userId,
      workspace_id: workspaceId,
      tenant_id: tenantId,
      can_run_pty: true,
      error_code: e?.code || 'unsupported_target_type',
    };
  }
  const validTargetTypes = deps.VALID_TARGET_TYPES || [];
  if (!validTargetTypes.includes(targetType)) {
    return {
      ...baseDisabled,
      terminal_enabled: true,
      user_id: userId,
      workspace_id: workspaceId,
      tenant_id: tenantId,
      can_run_pty: true,
      error_code: 'unsupported_target_type',
    };
  }

  const connectionId = (query.connection_id || query.connectionId || '').trim() || null;
  const sandboxLifecycle = deps.sandboxLifecycleFromInput({
    target_type: targetTypeRaw,
    lifecycle: query.lifecycle,
    ephemeral: query.ephemeral,
  });
  if (targetType === 'sandbox' && sandboxLifecycle === 'ephemeral') {
    const containerBound = !!env?.MY_CONTAINER || !!env?.MOVIEMODE_RENDER;
    return {
      terminal_enabled: true,
      terminal_configured: containerBound,
      control_plane_available: !!env.AGENT_SESSION,
      direct_wss_available: false,
      user_id: userId,
      workspace_id: workspaceId,
      tenant_id: tenantId,
      can_run_pty: true,
      selected_target_type: 'sandbox',
      selected_target_lane: 'sandbox',
      selected_transport: 'sandbox_ephemeral',
      lifecycle: 'ephemeral',
      error_code: containerBound ? null : 'container_unbound',
    };
  }
  // LOCAL: do not fail-closed on worker→localpty health probes. Tunnel chip and
  // /health can be green from the browser while CF→localpty probes flake; D1
  // ws_url presence is enough for config-status. Live WS still proves the lane.
  const sel = await deps.getSelectedTerminalConnection?.(env.DB, {
    userId,
    workspaceId,
    tenantId,
    connectionId,
    targetType,
    healthAware: targetType !== 'user_hosted_tunnel',
  });

  if (sel.error === 'connection_forbidden') {
    return {
      terminal_enabled: true,
      terminal_configured: false,
      control_plane_available: !!env.AGENT_SESSION,
      direct_wss_available: false,
      user_id: userId,
      workspace_id: workspaceId,
      tenant_id: tenantId,
      can_run_pty: true,
      selected_target_type: targetType,
      error_code: 'connection_forbidden',
    };
  }

  if (sel.error === 'unsupported_target_type') {
    return {
      terminal_enabled: true,
      terminal_configured: false,
      control_plane_available: !!env.AGENT_SESSION,
      direct_wss_available: false,
      user_id: userId,
      workspace_id: workspaceId,
      tenant_id: tenantId,
      can_run_pty: true,
      error_code: 'unsupported_target_type',
    };
  }

  const conn = sel.connection;
  let errorCode = sel.error;
  const effectiveTargetType = targetType || String(conn?.target_type || '').trim();
  if (!effectiveTargetType) {
    return {
      ...baseDisabled,
      terminal_enabled: true,
      user_id: userId,
      workspace_id: workspaceId,
      tenant_id: tenantId,
      can_run_pty: true,
      error_code: 'target_type_required',
    };
  }

  if (effectiveTargetType === 'ssh_target') errorCode = errorCode || 'ssh_target_not_enabled';

  const vpcPty = !!env.PTY_SERVICE;
  const httpsUrl = (env.TERMINAL_WS_URL || '').trim();
  const secret = (env.TERMINAL_SECRET || env.PTY_AUTH_TOKEN || '').trim();
  const resolvedConnToken = await deps.resolveConnectionAuthToken?.(env, conn, userId, workspaceId);
  const dbBridgeOk = connectionDbBridgeOk(env, conn, resolvedConnToken);
  const wsUrlPresent = !!(conn?.ws_url && String(conn.ws_url).trim());

  let routeWillUsePtyService = false;
  let routeWillUseConnectionWsUrl = false;

  if (effectiveTargetType === 'platform_vm') {
    routeWillUsePtyService = vpcPty;
    routeWillUseConnectionWsUrl = !vpcPty && wsUrlPresent;
    if (!vpcPty && !httpsUrl && !secret && !dbBridgeOk && !wsUrlPresent) {
      errorCode = errorCode || 'pty_backend_unconfigured';
    }
  } else if (effectiveTargetType === 'user_hosted_tunnel' || effectiveTargetType === 'sandbox') {
    routeWillUsePtyService = false;
    routeWillUseConnectionWsUrl = wsUrlPresent;
    if (!wsUrlPresent) {
      errorCode =
        errorCode ||
        (effectiveTargetType === 'sandbox' ? 'sandbox_unreachable' : 'connection_missing');
    }
  }

  const { resolveTerminalCwd } = await import('../../backend/agentsam/terminal/pty-workspace-paths.js');
  const cwdResult = await resolveTerminalCwd(env, {
    connection: conn,
    tenantId,
    userId,
    workspaceId,
  });

  const terminalConfigured =
    effectiveTargetType === 'ssh_target'
      ? false
      : effectiveTargetType === 'sandbox'
        ? // Cost law: config-status is passive — never wake MY_CONTAINER here.
          // Live probe only on sandbox dock smoke / wrangler-guide whoami paths.
          !!(wsUrlPresent && (!!secret || dbBridgeOk))
        : effectiveTargetType === 'platform_vm'
          ? !!(vpcPty || (httpsUrl && secret) || dbBridgeOk || wsUrlPresent)
          : wsUrlPresent;

  return {
    terminal_enabled: true,
    terminal_configured: terminalConfigured,
    control_plane_available: !!env.AGENT_SESSION,
    direct_wss_available: false,
    user_id: userId,
    workspace_id: workspaceId,
    tenant_id: tenantId,
    can_run_pty: true,
    selected_target_type: conn?.target_type ?? targetType,
    selected_connection_id: conn?.id ?? null,
    exec_lane: sel.lane ?? null,
    exec_resolution: sel.resolution ?? null,
    selected_connection_platform: conn?.platform ?? null,
    selected_connection_shell: conn?.shell ?? null,
    selected_connection_auth_mode: conn?.auth_mode ?? null,
    selected_connection_ws_url_present: wsUrlPresent,
    route_will_use_pty_service: routeWillUsePtyService,
    route_will_use_connection_ws_url: routeWillUseConnectionWsUrl,
    self_service_enabled: Number(conn?.self_service_enabled) === 1,
    cwd: cwdResult.cwd,
    cwd_strategy: cwdResult.strategy,
    db_bridge_ok: dbBridgeOk,
    pty_service_bound: vpcPty,
    terminal_ws_url_configured: !!httpsUrl,
    error_code: errorCode,
  };
}
