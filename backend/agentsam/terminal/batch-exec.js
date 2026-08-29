import { resolveTerminalExecRoutingFromDb } from './routing-policy.js';
import { userMayUsePrivilegedTerminal } from '../../identity/workspace/grants.js';
import { resolveTerminalExecIdentity, buildExecTransportHeaders } from './privileged-targets.js';
import { wrapRemoteExecCommandAsUnixUser } from './unix-identity.js';
import { requireTerminalTargetType, sandboxLifecycleFromInput } from './execution-lane.js';
import { resolveTerminalExecutionPlan } from './execution-plan.js';
import { resolveTerminalTargetTransport } from './transports/index.js';
import { _ptyExecPayload } from './pty-exec.js';

export async function executeBatchCommand(session, command, body = {}) {
  const cmd = String(command || '').trim();
  if (!cmd) return { error: 'command required' };
  const userId = String(session.ptSessionUserId || body.user_id || '').trim();
  const workspaceId = String(session.workspaceId || body.workspace_id || '').trim();
  const isOp = await userMayUsePrivilegedTerminal(session.env, { id: userId }, workspaceId || session.ptWorkspaceId);
  const routing = await resolveTerminalExecRoutingFromDb(session.env, {
    target_id: body.target_id || session.requestedConnectionId,
    target_type: body.target_type || session.requestedTargetType,
    tool_name: body.tool_name || session.requestedToolName || null,
    user_id: userId,
    mayUsePrivilegedTerminal: isOp,
  });

  let requestedType;
  try {
    requestedType = requireTerminalTargetType(
      body.target_type || session.requestedTargetType || routing.target_type,
    );
  } catch (e) {
    return { error: e?.code || e?.message || 'target_type_required' };
  }
  const sandboxLifecycle = sandboxLifecycleFromInput({
    target_type: body.target_type || session.requestedTargetType,
    lifecycle: body.lifecycle,
    ephemeral: body.ephemeral,
  });
  let conn = null;
  if (!(requestedType === 'sandbox' && sandboxLifecycle === 'ephemeral') && session.env?.DB) {
    try {
      const sel = await session.selectTerminalConnection({
        userId,
        workspaceId,
        tenantId: String(session.ptSessionTenantId || body.tenant_id || '').trim() || null,
        connectionId: body.target_id || session.requestedConnectionId || routing.target_id || null,
        targetType: requestedType,
        healthAware: true,
      });
      conn = sel.connection || null;
      if (!conn && requestedType === 'user_hosted_tunnel') {
        const cold = await session.selectTerminalConnection({
          userId,
          workspaceId,
          tenantId: String(session.ptSessionTenantId || body.tenant_id || '').trim() || null,
          connectionId: null,
          targetType: 'user_hosted_tunnel',
          healthAware: false,
        });
        conn = cold.connection || null;
      }
    } catch (e) {
      console.warn('[batch-exec] connection lookup', e?.message || e);
    }
  }

  if (conn) {
    session.selectedTerminalConnection = conn;
    if (conn.target_type) session.selectedTargetType = String(conn.target_type).trim();
  }
  const resolvedTargetType = String(conn?.target_type || requestedType || '').trim();
  if (!resolvedTargetType) return { error: 'target_type_required' };
  const execIdentity = await resolveTerminalExecIdentity(session.env?.DB, conn, null, {
    env: session.env,
    userId,
    workspaceId: workspaceId || session.ptWorkspaceId,
  });
  const headers = buildExecTransportHeaders({ ...execIdentity, userId });
  const payload = await _ptyExecPayload(session, cmd);
  const plan = await resolveTerminalExecutionPlan(session, {
    protocol: 'batch_exec',
    routing,
    connection: conn,
    targetType: resolvedTargetType,
    targetId: body.target_id || conn?.id || routing.target_id || null,
    userId,
    workspaceId,
    tenantId: String(session.ptSessionTenantId || body.tenant_id || '').trim() || null,
    cwd: body.cwd || payload.cwd || session.ptyWorkingDir || null,
    mayUsePrivilegedTerminal: isOp,
    lifecycle: sandboxLifecycle,
    ephemeral: body.ephemeral,
  });
  if (plan.forbidden) return { error: 'operator_lane_forbidden' };
  if (!plan.target_lane) return { error: `unsupported_terminal_target:${plan.target_type || 'unknown'}` };

  let runCmd = cmd;
  let runPayload = { ...payload, cwd: body.cwd || payload.cwd };
  if (plan.target_lane === 'remote' && execIdentity.execUser) {
    runCmd = wrapRemoteExecCommandAsUnixUser(
      cmd,
      execIdentity.execUser,
      execIdentity.transportExecUser,
    );
    runPayload = { ...runPayload, command: runCmd };
  }

  const transport = resolveTerminalTargetTransport(plan);
  const transported = await transport.execute(session, plan, {
    command: runCmd,
    payload: runPayload,
    headers,
    execUser: execIdentity.execUser,
    transportExecUser: execIdentity.transportExecUser,
    privilegedTargetId: execIdentity.privilegedTargetId,
    isTunnelOwner: execIdentity.isTunnelOwner === true,
    timeout_ms: body.timeout_ms,
    authUser: body.auth_user ?? null,
    signal: body.signal ?? null,
    instance_name: body.job_id ? `terminal-job-${String(body.job_id).replace(/[^A-Za-z0-9_-]/g, '').slice(-48)}` : null,
    runMcpZoneSandboxCommand: body.runMcpZoneSandboxCommand ?? plan.runMcpZoneSandboxCommand ?? null,
  });
  if (transported?.error) {
    return {
      error: transported.error,
      ...(transported.failure_class ? { failure_class: transported.failure_class } : {}),
      target_id: plan.target_id,
      target_type: plan.target_type,
      target_lane: plan.target_lane,
      transport: plan.transport,
      cleanup: transported.cleanup ?? transported.ephemeral_cleanup ?? null,
      lifecycle: transported.lifecycle ?? plan.lifecycle,
      instance_name: transported.instance_name,
    };
  }
  const output = String(transported.output || '').trim() || '(no output)';
  const exitCode = transported.exit_code ?? 0;
  void session.recordExecTerminalHistory(cmd, output, exitCode);
  return {
    output,
    stdout: transported.stdout ?? output,
    stderr: transported.stderr ?? '',
    exit_code: exitCode,
    target_id: plan.target_id,
    target_type: plan.target_type,
    target_lane: plan.target_lane,
    transport: plan.transport,
    exec_identity: execIdentity.execUser,
    privileged_target_id: execIdentity.privilegedTargetId,
    cleanup: transported.cleanup ?? transported.ephemeral_cleanup ?? null,
    lifecycle: transported.lifecycle ?? plan.lifecycle,
    instance_name: transported.instance_name,
  };
}
