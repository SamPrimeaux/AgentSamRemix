import { resolveTerminalCwd } from './pty-workspace-paths.js';
import { resolveTerminalExecRoutingFromDb } from './routing-policy.js';
import { userMayUsePrivilegedTerminal } from '../../identity/workspace/grants.js';
import { resolveTerminalExecIdentity, buildExecTransportHeaders } from './privileged-targets.js';
import { wrapRemoteExecCommandAsUnixUser } from './unix-identity.js';
import { resolveTerminalExecutionPlan } from './execution-plan.js';
import { resolveTerminalTargetTransport } from './transports/index.js';


export async function _ptyExecPayload(session, command) {
    const uid = String(session.ptSessionUserId || "").trim();
    const tid = String(session.ptSessionTenantId || "").trim();
    const wid = String(session.workspaceId || "").trim();
    let cwd = String(session.ptyWorkingDir || "").trim();
    const conn = session.selectedTerminalConnection;
    let settings = null;
    if (wid && session.env?.DB) {
      const { loadWorkspaceSettingsJson } = await import("./pty-workspace-paths.js");
      settings = await loadWorkspaceSettingsJson(session.env, wid);
    }
    if (!cwd && wid && session.env?.DB) {
      const r = await resolveTerminalCwd(session.env, {
        connection: conn,
        tenantId: tid,
        userId: uid,
        workspaceId: wid,
      });
      cwd = r?.cwd ? String(r.cwd).trim() : "";
      if (cwd) session.ptyWorkingDir = cwd;
    }
    const { normalizeExecCwdForConnection } = await import("./host-workspace-paths.js");
    const normalized = normalizeExecCwdForConnection(cwd, conn, settings);
    const payload = { command };
    if (normalized) payload.cwd = normalized;
    return payload;
  }

export async function executePtyCommand(session, command) {
    const execUid = String(session.ptSessionUserId || "").trim();
    const execWid = String(session.workspaceId || "").trim();
    const isOp = await userMayUsePrivilegedTerminal(session.env, { id: execUid }, execWid || session.ptWorkspaceId);
    const routing = await resolveTerminalExecRoutingFromDb(session.env, {
      target_id: session.requestedConnectionId,
      target_type: session.requestedTargetType,
      tool_name: session.requestedToolName || null,
      user_id: execUid,
      mayUsePrivilegedTerminal: isOp,
    });
    // Never invent target_type — require explicit dock/session lane.
    let execTargetRaw = String(
      routing.target_type || session.requestedTargetType || session.selectedTargetType || '',
    ).trim();
    if (
      !execTargetRaw ||
      execTargetRaw === 'auto' ||
      (execTargetRaw !== 'platform_vm' &&
        execTargetRaw !== 'user_hosted_tunnel' &&
        execTargetRaw !== 'sandbox')
    ) {
      return {
        error: execTargetRaw && execTargetRaw !== 'auto' ? 'exec_lane_invalid' : 'exec_lane_required',
      };
    }
    if (!session.requestedTargetType || String(session.requestedTargetType).trim() === 'auto') {
      session.requestedTargetType = execTargetRaw;
    }
    if (!session.selectedTargetType || String(session.selectedTargetType).trim() === 'auto') {
      session.selectedTargetType = execTargetRaw;
    }

    return session._executePtyCommandOnce(command);
  }

export async function _executePtyCommandOnce(session, command) {
    const execUid = String(session.ptSessionUserId || "").trim();
    const execWid = String(session.workspaceId || "").trim();
    const isOp = await userMayUsePrivilegedTerminal(session.env, { id: execUid }, execWid || session.ptWorkspaceId);
    const routing = await resolveTerminalExecRoutingFromDb(session.env, {
      target_id: session.requestedConnectionId,
      target_type: session.requestedTargetType,
      tool_name: session.requestedToolName || null,
      user_id: execUid,
      mayUsePrivilegedTerminal: isOp,
    });
    const execTargetRaw = String(
      routing.target_type || session.requestedTargetType || session.selectedTargetType || '',
    ).trim();
    if (
      !execTargetRaw ||
      execTargetRaw === 'auto' ||
      (execTargetRaw !== 'platform_vm' &&
        execTargetRaw !== 'user_hosted_tunnel' &&
        execTargetRaw !== 'sandbox')
    ) {
      return {
        error: execTargetRaw && execTargetRaw !== 'auto' ? 'exec_lane_invalid' : 'exec_lane_required',
      };
    }
    const execTargetNorm = execTargetRaw;
    const pinnedId =
      String(session.requestedConnectionId || routing.target_id || "").trim() || null;
    let lookupError = null;
    // Always re-resolve for user_hosted_tunnel — DO-cached conn often lacks identity columns.
    let conn =
      pinnedId || execTargetNorm === "user_hosted_tunnel"
        ? null
        : session.selectedTerminalConnection;
    if (!conn && session.env?.DB) {
      const sel = await session.selectTerminalConnection({
        userId: execUid,
        workspaceId: execWid,
        tenantId: String(session.ptSessionTenantId || "").trim() || null,
        connectionId: pinnedId,
        targetType: execTargetNorm,
        healthAware: true,
      });
      conn = sel.connection;
      lookupError = sel.error || null;
      if (conn) {
        session.selectedTerminalConnection = conn;
        session.selectedTargetType = String(conn.target_type || execTargetNorm).trim();
      }
    }
    // Health probe can race / miss while D1 still has the Mac row — unpinned static load.
    if (
      !conn &&
      session.env?.DB &&
      (execTargetRaw === "user_hosted_tunnel" ||
        String(session.requestedTargetType || "").trim() === "user_hosted_tunnel")
    ) {
      const cold = await session.selectTerminalConnection({
        userId: execUid,
        workspaceId: execWid,
        tenantId: String(session.ptSessionTenantId || "").trim() || null,
        connectionId: null,
        targetType: "user_hosted_tunnel",
        healthAware: false,
      });
      conn = cold.connection;
      lookupError = cold.error || lookupError;
      if (conn) {
        session.selectedTerminalConnection = conn;
        session.selectedTargetType = "user_hosted_tunnel";
      }
    }
    const execTarget = String(
      session.selectedTargetType || conn?.target_type || execTargetNorm || '',
    ).trim();
    if (
      !execTarget ||
      execTarget === 'auto' ||
      (execTarget !== 'platform_vm' &&
        execTarget !== 'user_hosted_tunnel' &&
        execTarget !== 'sandbox')
    ) {
      return {
        error: execTarget && execTarget !== 'auto' ? 'exec_lane_invalid' : 'exec_lane_required',
      };
    }
    const isMacTunnel =
      execTarget === "user_hosted_tunnel" ||
      String(conn?.target_type || "").trim() === "user_hosted_tunnel";
    if (isMacTunnel && !conn) {
      console.warn(
        "[terminal] mac_local_connection_unresolved",
        JSON.stringify({
          user_id: execUid || null,
          workspace_id: execWid || null,
          pinned_id: pinnedId,
          lookup_error: lookupError,
        }),
      );
      const code = lookupError || 'connection_missing';
      return {
        error:
          code === 'lane_unhealthy'
            ? 'localpty_lane_unhealthy (conn_mac_local exists; /health probe failed — dock WS can still be up)'
            : `localpty_unresolved (${code})`,
      };
    }
    const execIdentity = await resolveTerminalExecIdentity(session.env?.DB, conn, null, {
      env: session.env,
      userId: execUid,
      workspaceId: execWid || session.ptWorkspaceId,
    });
    if (isMacTunnel && !execIdentity.execUser) {
      console.warn(
        "[terminal] mac_local_missing_exec_identity",
        JSON.stringify({
          connection_id: conn?.id || null,
          platform: conn?.platform || null,
          remote_exec_user: conn?.remote_exec_user || null,
          username: conn?.username || null,
        }),
      );
      return {
        error:
          "IAM Security: X-IAM-Exec-Identity required (terminal_connections.remote_exec_user/username missing for this Mac tunnel)",
      };
    }
    const execHeaders = buildExecTransportHeaders({
      ...execIdentity,
      userId: execUid,
    });
    const execPayload = await session._ptyExecPayload(command);

    const plan = await resolveTerminalExecutionPlan(session, {
      protocol: 'pty',
      routing,
      connection: conn,
      targetType: execTarget,
      targetId: conn?.id ? String(conn.id) : pinnedId,
      userId: execUid,
      workspaceId: execWid,
      tenantId: String(session.ptSessionTenantId || '').trim() || null,
      cwd: execPayload.cwd || session.ptyWorkingDir || null,
      mayUsePrivilegedTerminal: isOp,
    });
    if (plan.forbidden) return { error: 'operator_lane_forbidden' };
    if (!plan.target_lane) return { error: `unsupported_terminal_target:${plan.target_type || 'unknown'}` };

    // Remote: transport header = ExecOS daemon Unix user; body wraps as resolved logical exec user.
    let runCommand = command;
    let runPayload = execPayload;
    if (plan.target_lane === 'remote' && execIdentity.execUser) {
      runCommand = wrapRemoteExecCommandAsUnixUser(
        command,
        execIdentity.execUser,
        execIdentity.transportExecUser,
      );
      runPayload = { ...execPayload, command: runCommand };
    }

    const transport = resolveTerminalTargetTransport(plan);
    let transported;
    try {
      transported = await transport.execute(session, plan, {
        command: runCommand,
        payload: runPayload,
        headers: execHeaders,
        execUser: execIdentity.execUser,
        transportExecUser: execIdentity.transportExecUser,
        privilegedTargetId: execIdentity.privilegedTargetId,
        isTunnelOwner: execIdentity.isTunnelOwner === true,
        timeout_ms: session.requestedTimeoutMs,
      });
    } catch (e) {
      transported = { error: e?.message || `${transport.name} transport failed` };
    }
    if (transported?.error) {
      return {
        error: transported.error,
        ...(transported.failure_class ? { failure_class: transported.failure_class } : {}),
      };
    }

    const output = String(transported?.output || '').trim() || '(no output)';
    const exitCode = transported?.exit_code ?? 0;
    void session.recordExecTerminalHistory(command, output, exitCode);
    return {
      output,
      exit_code: exitCode,
      exec_identity: execIdentity.execUser,
      privileged_target_id: execIdentity.privilegedTargetId,
      target_id: plan.target_id,
      target_type: plan.target_type,
      target_lane: plan.target_lane,
      transport: plan.transport,
      host_receipt: transported?.host_receipt || null,
      failure_class: transported?.failure_class ?? null,
    };
  }
