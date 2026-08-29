/**
 * Shared terminal handler entry — merge run identity, then in-process PTY.
 * Never HTTP-loopback to /api/agent/terminal/run (that path 401s without a browser session).
 */
import { getAuthUser } from './auth.js';
import { wrapShellCommandWithPath } from './mcp-terminal-contract.js';
import { resolveTerminalExecRoutingFromDb } from '../../backend/agentsam/terminal/routing-policy.js';
import { runTerminalCommand } from '../../backend/agentsam/terminal/runtime.js';
import { normalizeTerminalExecutionResult } from '../../backend/agentsam/terminal/execution-result.js';

/**
 * @param {Record<string, unknown>} [params]
 * @param {Record<string, unknown>} [runContext]
 */
export function mergeTerminalHandlerParams(params = {}, runContext = {}) {
  const p = params && typeof params === 'object' ? params : {};
  const rc = runContext && typeof runContext === 'object' ? runContext : {};
  return {
    command: p.command ?? p.cmd ?? null,
    request: p.request ?? rc.request ?? null,
    session_id: p.session_id ?? p.sessionId ?? rc.sessionId ?? rc.session_id ?? null,
    workspace_id: p.workspace_id ?? p.workspaceId ?? rc.workspaceId ?? rc.workspace_id ?? null,
    path: p.path ?? p.cwd ?? null,
    cwd: p.cwd ?? p.path ?? null,
    target_id: p.target_id ?? p.targetId ?? rc.target_id ?? null,
    target_type: p.target_type ?? p.targetType ?? rc.target_type ?? null,
    tool_name: p.tool_name ?? p.toolName ?? rc.tool_name ?? rc.toolName ?? null,
    user_id: p.user_id ?? p.userId ?? rc.userId ?? rc.user_id ?? null,
    client_surface: p.client_surface ?? p.clientSurface ?? rc.client_surface ?? rc.clientSurface ?? null,
    exec_lane: p.exec_lane ?? p.execLane ?? rc.exec_lane ?? rc.execLane ?? null,
    execution_mode: p.execution_mode ?? p.executionMode ?? rc.execution_mode ?? rc.executionMode ?? 'pty',
    timeout_ms: p.timeout_ms ?? p.timeoutMs ?? rc.timeout_ms ?? rc.timeoutMs ?? null,
    authUser: p.authUser ?? rc.authUser ?? rc.user ?? null,
  };
}

/**
 * @param {any} env
 * @param {Request|null|undefined} request
 * @param {string|null|undefined} explicitUserId
 */
export async function resolveTerminalHandlerUserId(env, request, explicitUserId) {
  const fromParams = explicitUserId != null ? String(explicitUserId).trim() : '';
  if (fromParams) return fromParams;
  if (request) {
    const authUser = await getAuthUser(request, env);
    if (authUser?.id) return String(authUser.id).trim();
  }
  return null;
}

function terminalRoutingForbiddenMessage(routing, toolName) {
  const tk = String(toolName || '').trim();
  if (routing?.lane === 'forbidden_non_operator' && tk === 'agentsam_terminal_remote') {
    return 'agentsam_terminal_remote (GCP cloud desk) is restricted to platform operators.';
  }
  if (routing?.forbidden) {
    return `Terminal routing forbidden for ${tk || 'command'}.`;
  }
  return 'Terminal routing denied.';
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} [runContext]
 */
export async function executeTerminalHandlerRun(env, params, runContext = {}) {
  const merged = mergeTerminalHandlerParams(params, runContext);
  const rawCmd = typeof merged.command === 'string' ? merged.command.trim() : '';
  if (!rawCmd) {
    return { error: 'Terminal Error: command required' };
  }

  const workDir = String(merged.path || merged.cwd || '').trim();
  const runCommand = workDir ? wrapShellCommandWithPath(workDir, rawCmd) : rawCmd;
  const toolName = merged.tool_name != null ? String(merged.tool_name).trim() : '';
  const userId =
    (await resolveTerminalHandlerUserId(env, merged.request, merged.user_id)) ||
    (merged.authUser?.id ? String(merged.authUser.id).trim() : '');

  const { userMayUsePrivilegedTerminal } = await import('../../backend/identity/workspace/grants.js');
  const isOp = await userMayUsePrivilegedTerminal(env, { id: userId }, merged.workspace_id);
  const routing = await resolveTerminalExecRoutingFromDb(env, {
    tool_name: toolName || null,
    tool_key: toolName || null,
    target_id: merged.target_id,
    target_type: merged.target_type,
    client_surface: merged.client_surface,
    exec_lane: merged.exec_lane,
    user_id: userId,
    mayUsePrivilegedTerminal: isOp,
  });

  if (routing.forbidden) {
    return { error: `Terminal Error: ${terminalRoutingForbiddenMessage(routing, toolName)}` };
  }

  const remoteTargetId = routing.target_id || '';
  const sessionId = merged.session_id != null ? String(merged.session_id).trim() || null : null;
  const workspaceId =
    merged.workspace_id != null ? String(merged.workspace_id).trim() || null : null;

  const executionMode = String(merged.execution_mode || 'pty').trim().toLowerCase();
  const authUser =
    merged.authUser && typeof merged.authUser === 'object'
      ? merged.authUser
      : userId
        ? { id: userId }
        : null;
  if (!userId && !authUser?.id) {
    return { error: 'Terminal Error: terminal_identity_required' };
  }

  const executionCtx = {
    execution_mode: executionMode,
    workspace_id: workspaceId,
    tool_name: toolName || null,
    user_id: userId,
    userId,
    authUser,
    ...(remoteTargetId || merged.target_id ? { target_id: remoteTargetId || merged.target_id } : {}),
    ...(routing.target_type || merged.target_type
      ? { target_type: routing.target_type || merged.target_type }
      : {}),
    ...(merged.timeout_ms != null ? { timeout_ms: Number(merged.timeout_ms) } : {}),
  };

  try {
    const runRes = await runTerminalCommand(env, merged.request || null, runCommand, sessionId, executionCtx);
    const normalized = normalizeTerminalExecutionResult(runRes, {
      command: runCommand,
      cwd: workDir || null,
      protocol: executionMode,
    });
    return {
      ...normalized,
      output: normalized.output || '(no output)',
      status: normalized.ok ? 'success' : 'error',
    };
  } catch (e) {
    const msg = e?.message || e;
    return {
      error: `Terminal Error: ${msg}`,
      ...(e?.failure_class ? { failure_class: e.failure_class } : {}),
    };
  }
}
