/**
 * AgentSession terminal execution boundary.
 *
 * Callers supply an explicit execution lane or inherit the Agent run terminal target.
 * Terminal policy, workspace-token checks,
 * connection health, cwd resolution, and sudo admission remain owned by AGENT_SESSION.
 */
import { resolveAgentRunTerminalConnection } from './connections.js';

const TARGET_TYPE_TO_LANE = Object.freeze({
  user_hosted_tunnel: 'local',
  platform_vm: 'remote',
  sandbox: 'sandbox',
});

/** @param {unknown} execLane */
export function targetTypeFromExecLane(execLane) {
  const lane = String(execLane ?? '').trim().toLowerCase();
  if (lane === 'local') return 'user_hosted_tunnel';
  if (lane === 'remote') return 'platform_vm';
  if (lane === 'sandbox') return 'sandbox';
  const error = new Error(lane ? 'exec_lane_invalid' : 'exec_lane_required');
  error.code = lane ? 'exec_lane_invalid' : 'exec_lane_required';
  throw error;
}

/** @param {string} userId @param {string} workspaceId @param {string} targetType */
export function buildAgentSessionTerminalName(userId, workspaceId, targetType) {
  const lane = TARGET_TYPE_TO_LANE[String(targetType || '').trim()];
  if (!userId || !workspaceId || !lane) {
    const error = new Error('terminal_session_name_incomplete');
    error.code = 'terminal_session_name_incomplete';
    throw error;
  }
  return ['terminal', userId, workspaceId, 'pty', lane, 'agent'].join(':');
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} runContext
 */
export async function resolveAgentSessionTerminalTarget(env, runContext = {}, opts = {}) {
  const explicitTargetType = String(opts.targetType || '').trim();
  const explicitConnectionId = String(opts.connectionId || '').trim() || null;
  const execLane = runContext.exec_lane ?? runContext.execLane ?? null;
  if (explicitTargetType) {
    return {
      target_type: explicitTargetType,
      connection_id: explicitConnectionId,
      requested_lane: String(execLane || '').trim().toLowerCase() || null,
    };
  }
  if (opts.preferExplicitLane === true && execLane != null && String(execLane).trim() !== '') {
    return {
      target_type: targetTypeFromExecLane(execLane),
      connection_id: explicitConnectionId,
      requested_lane: String(execLane || '').trim().toLowerCase() || null,
    };
  }
  const runId = String(runContext.agent_run_id || runContext.agentRunId || '').trim();
  if (runId && env?.DB) {
    const resolved = await resolveAgentRunTerminalConnection(env.DB, runId);
    return {
      target_type: resolved.target_type,
      connection_id: resolved.connection_id,
      requested_lane: resolved.requested_lane,
    };
  }
  return {
    target_type: targetTypeFromExecLane(execLane),
    connection_id: explicitConnectionId,
    requested_lane: String(execLane || '').trim().toLowerCase() || null,
  };
}

/**
 * @param {any} env
 * @param {string} command
 * @param {Record<string, unknown>} runContext
 * @param {{ toolName?: string, timeoutMs?: number, preferExplicitLane?: boolean, executionMode?: string, targetType?: string|null, connectionId?: string|null }} opts
 */
export async function executeAgentSessionTerminalCommand(env, command, runContext = {}, opts = {}) {
  if (!env?.AGENT_SESSION) {
    return { ok: false, error: 'agent_session_unavailable', output: '', exitCode: 1, exit_code: 1 };
  }
  const cmd = String(command || '').trim();
  if (!cmd) return { ok: false, error: 'command_required', output: '', exitCode: 1, exit_code: 1 };

  const userId = String(runContext.userId ?? runContext.user_id ?? '').trim();
  const workspaceId = String(runContext.workspaceId ?? runContext.workspace_id ?? '').trim();
  const tenantId = String(runContext.tenantId ?? runContext.tenant_id ?? '').trim();
  if (!userId || !workspaceId || !tenantId) {
    return {
      ok: false,
      error: 'terminal_execution_scope_required',
      output: '',
      exitCode: 1,
      exit_code: 1,
    };
  }

  let target;
  try {
    target = await resolveAgentSessionTerminalTarget(env, runContext, opts);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.code || error?.message || error),
      output: '',
      exitCode: 1,
      exit_code: 1,
    };
  }

  const targetType = String(target.target_type || '').trim();
  const connectionId = String(target.connection_id || '').trim() || null;
  let sessionName;
  try {
    sessionName = buildAgentSessionTerminalName(userId, workspaceId, targetType);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.code || error?.message || error),
      output: '',
      exitCode: 1,
      exit_code: 1,
    };
  }

  const executionMode = String(opts.executionMode || 'pty').trim().toLowerCase() || 'pty';
  const doUrl = new URL('https://do.internal/terminal/exec');
  doUrl.searchParams.set('execution_mode', executionMode);
  doUrl.searchParams.set('workspace_id', workspaceId);
  doUrl.searchParams.set('user_id', userId);
  doUrl.searchParams.set('tenant_id', tenantId);
  doUrl.searchParams.set('target_type', targetType);
  if (connectionId) doUrl.searchParams.set('connection_id', connectionId);
  const personUuid = String(runContext.personUuid ?? runContext.person_uuid ?? runContext.authUser?.person_uuid ?? '').trim();
  if (personUuid) doUrl.searchParams.set('person_uuid', personUuid);

  const stub = env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(sessionName));
  const response = await stub.fetch(
    new Request(doUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        command: cmd,
        execution_mode: executionMode,
        workspace_id: workspaceId,
        target_id: connectionId,
        target_type: targetType,
        connection_id: connectionId,
        tool_name: String(opts.toolName || '').trim() || null,
        timeout_ms: Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : null,
      }),
    }),
  );
  const payload = await response.json().catch(() => ({}));
  const output = String(payload?.output ?? payload?.stdout ?? payload?.stderr ?? '');
  if (!response.ok || payload?.ok === false || payload?.error) {
    return {
      ok: false,
      error: String(payload?.error || `terminal_exec_${response.status}`),
      output,
      stdout: String(payload?.stdout ?? ''),
      stderr: String(payload?.stderr ?? payload?.error ?? ''),
      exitCode: Number(payload?.exit_code ?? 1),
      exit_code: Number(payload?.exit_code ?? 1),
      targetId: payload?.target_id ?? connectionId,
      targetType: payload?.target_type ?? targetType,
      targetLane: payload?.target_lane ?? null,
      transport: payload?.transport ?? null,
    };
  }
  const exitCode = Number(payload?.exit_code ?? 0);
  return {
    ok: exitCode === 0,
    output,
    stdout: String(payload?.stdout ?? payload?.output ?? ''),
    stderr: String(payload?.stderr ?? ''),
    exitCode,
    exit_code: exitCode,
    targetId: payload?.target_id ?? connectionId,
    targetType: payload?.target_type ?? targetType,
    targetLane: payload?.target_lane ?? null,
    transport: payload?.transport ?? null,
  };
}
