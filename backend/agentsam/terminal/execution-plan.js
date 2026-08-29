import { resolveTerminalExecRoutingFromDb } from './routing-policy.js';
import { userMayUsePrivilegedTerminal } from '../../identity/workspace/grants.js';
import { requireTerminalTargetType, sandboxLifecycleFromInput } from './execution-lane.js';

export const TERMINAL_PROTOCOLS = Object.freeze(['pty', 'ssh', 'mcp', 'batch_exec']);
export const TERMINAL_TARGET_LANES = Object.freeze(['local', 'remote', 'sandbox']);

export function normalizeTerminalProtocol(value) {
  const raw = String(value || 'pty').trim().toLowerCase();
  return raw === 'ssh' || raw === 'mcp' || raw === 'batch_exec' ? raw : 'pty';
}

export function terminalLaneFromTargetType(targetType) {
  const raw = String(targetType || '').trim().toLowerCase();
  if (raw === 'user_hosted_tunnel') return 'local';
  if (raw === 'sandbox' || raw === 'container' || raw === 'ephemeral_container') return 'sandbox';
  if (raw === 'platform_vm' || raw === 'remote') return 'remote';
  return null;
}

export function targetTypeFromTerminalLane(lane) {
  const raw = String(lane || '').trim().toLowerCase();
  if (raw === 'local') return 'user_hosted_tunnel';
  if (raw === 'sandbox') return 'sandbox';
  if (raw === 'remote') return 'platform_vm';
  return null;
}

export function transportNameForTerminalLane(lane) {
  if (lane === 'local') return 'user_hosted_tunnel';
  if (lane === 'sandbox') return 'container_exec';
  if (lane === 'remote') return 'platform_vm';
  return null;
}

export function transportNameForTerminalTarget(targetType, lane = terminalLaneFromTargetType(targetType), lifecycle = 'durable') {
  if (lane === 'sandbox' && String(lifecycle || '').trim() === 'ephemeral') return 'sandbox_ephemeral';
  return transportNameForTerminalLane(lane);
}

/**
 * Resolve protocol and execution target independently.
 * D1 handler_config / terminal-routing-policy remains the target-routing SSOT.
 */
export async function resolveTerminalExecutionPlan(session, opts = {}) {
  const protocol = normalizeTerminalProtocol(opts.protocol || opts.execution_mode);
  const userId = String(opts.userId || session.ptSessionUserId || '').trim();
  const workspaceId = String(opts.workspaceId || session.workspaceId || '').trim();
  const mayUsePrivilegedTerminal = opts.mayUsePrivilegedTerminal != null
    ? opts.mayUsePrivilegedTerminal === true
    : await userMayUsePrivilegedTerminal(session.env, { id: userId }, workspaceId || session.ptWorkspaceId);
  const routing = opts.routing || await resolveTerminalExecRoutingFromDb(session.env, {
    tool_name: opts.toolName || session.requestedToolName || null,
    target_id: opts.targetId || session.requestedConnectionId || null,
    target_type: opts.targetType || session.requestedTargetType || null,
    user_id: userId,
    mayUsePrivilegedTerminal,
  });
  const connection = opts.connection || session.selectedTerminalConnection || null;
  const targetTypeRaw = String(
    opts.targetType || connection?.target_type || session.selectedTargetType || routing?.target_type || session.requestedTargetType || '',
  ).trim() || null;
  let targetType = targetTypeRaw;
  if (targetTypeRaw) {
    try {
      targetType = requireTerminalTargetType(targetTypeRaw);
    } catch {
      targetType = targetTypeRaw;
    }
  }
  const lifecycle = sandboxLifecycleFromInput({
    target_type: targetTypeRaw,
    lifecycle: opts.lifecycle,
    ephemeral: opts.ephemeral,
  });
  const targetLane = terminalLaneFromTargetType(targetType);
  return {
    protocol,
    target_lane: targetLane,
    target_type: targetType,
    target_id: String(opts.targetId || connection?.id || routing?.target_id || session.requestedConnectionId || '').trim() || null,
    transport: transportNameForTerminalTarget(targetType, targetLane, lifecycle),
    lifecycle: targetLane === 'sandbox' ? lifecycle : null,
    routing_lane: routing?.lane || null,
    forbidden: routing?.forbidden === true,
    workspace_id: workspaceId || null,
    user_id: userId || null,
    tenant_id: String(opts.tenantId || session.ptSessionTenantId || '').trim() || null,
    cwd: String(opts.cwd || session.ptyWorkingDir || '').trim() || null,
    connection,
    may_use_privileged_terminal: mayUsePrivilegedTerminal,
  };
}
