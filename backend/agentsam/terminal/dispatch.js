import { executeAgentSessionTerminalCommand, targetTypeFromExecLane } from './exec.js';
import { submitTerminalBackgroundJob } from './background-job.js';

const HANDLER_LANE = Object.freeze({
  terminal_local: 'local',
  terminal_remote: 'remote',
  terminal_sandbox: 'sandbox',
});

function requestedLane(runContext = {}) {
  return String(runContext.exec_lane ?? runContext.execLane ?? '').trim().toLowerCase();
}

function shellQuote(raw) {
  const value = String(raw ?? '');
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function isTerminalCatalogLane({ handlerType, handlerKey, config = {} } = {}) {
  const type = String(handlerType || '').trim().toLowerCase();
  const key = String(handlerKey || '').trim().toLowerCase();
  const dispatcher = String(config.dispatcher || '').trim().toLowerCase();
  return dispatcher === 'workspace_argv' || type === 'workspace_argv' ||
    (type === 'terminal' && Object.prototype.hasOwnProperty.call(HANDLER_LANE, key));
}

async function executeWorkspaceArgvLane(laneCtx) {
  const { executeCatalogWorkspaceArgv } = await import('./workspace-argv.js');
  return executeCatalogWorkspaceArgv(laneCtx);
}

async function executeSandboxForeground(laneCtx, command) {
  const { env, params = {}, runContext = {}, tenantId, userId, workspaceId, agentRunId, config = {} } = laneCtx;
  const { runMcpZoneSandboxCommand, normalizeMcpZoneSlug } = await import('../mcp/sandbox-exec.js');
  const timeoutRaw = params.timeout_ms ?? params.timeoutMs;
  const timeoutMs = Number(timeoutRaw);
  const zoneSlug = normalizeMcpZoneSlug(
    params.zone_slug ?? params.zoneSlug ?? runContext.mcp_panel_slug ?? runContext.mcpZoneSlug,
  );
  const out = await runMcpZoneSandboxCommand(env, runContext.request, {
    command,
    zoneSlug,
    tenantId,
    userId,
    workspaceId,
    sessionId: runContext.sessionId ?? runContext.session_id ?? null,
    config,
    language: params.language,
    path: params.path,
    timeout_ms: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
    authUser: runContext.authUser ?? runContext.user ?? null,
    agentRunId: agentRunId != null ? String(agentRunId) : null,
    modelKey: runContext.modelKey ?? runContext.model_key ?? null,
    ctx: runContext.ctx ?? null,
    recordPatchSession: !!(runContext.mcp_panel_slug || params.zone_slug || params.zoneSlug),
  });
  return out?.ok
    ? { ok: true, body: out.body }
    : { ok: false, error: out?.error || 'sandbox execution failed', body: out?.body || {} };
}

export async function executeTerminalCatalogLane(laneCtx) {
  const { env, config = {}, params = {}, runContext = {}, handlerType, handlerKey, toolKey,
    workspaceId, tenantId, userId, conversationId, agentId } = laneCtx;
  const dispatcher = String(config.dispatcher || '').trim().toLowerCase();
  if (dispatcher === 'workspace_argv' || String(handlerType || '').trim().toLowerCase() === 'workspace_argv') {
    return executeWorkspaceArgvLane(laneCtx);
  }

  const lane = HANDLER_LANE[String(handlerKey || '').trim().toLowerCase()];
  if (!lane) return { ok: false, error: 'terminal_handler_key_required' };
  const dockLane = requestedLane(runContext);
  if (dockLane && dockLane !== lane) {
    return {
      ok: false,
      error: 'terminal_lane_mismatch',
      body: {
        requested_lane: dockLane,
        resolved_lane: lane,
        lane_substituted: false,
        user_message: `Terminal lane is hard-bound to ${dockLane}; ${lane} was not executed.`,
      },
    };
  }

  let command = String(params.command || params.cmd || config.command_template || '').trim();
  if (!command) return { ok: false, error: 'terminal tool requires command in input' };
  const explicitPath = String(params.path ?? params.cwd ?? '').trim();
  if (explicitPath && lane === 'local') command = `cd ${shellQuote(explicitPath)} && ${command}`;

  const background = params.background === true || params.background === 1 ||
    params.background === '1' || params.background === 'true';
  if (background) {
    return submitTerminalBackgroundJob(env, {
      terminalToolKey: toolKey,
      command,
      params,
      runContext,
      conversationId,
      userId,
      workspaceId,
      tenantId,
      agentId,
    });
  }

  const executionMode = String(params.execution_mode || params.executionMode || 'pty').trim().toLowerCase() || 'pty';
  if (lane === 'sandbox' && executionMode !== 'batch_exec') {
    return executeSandboxForeground(laneCtx, command);
  }

  const timeoutRaw = params.timeout_ms ?? params.timeoutMs ?? config.timeout_ms;
  const timeoutMs = Number(timeoutRaw);
  const targetType = targetTypeFromExecLane(lane);
  const terminalOut = await executeAgentSessionTerminalCommand(
    env,
    command,
    {
      ...runContext,
      userId,
      user_id: userId,
      workspaceId,
      workspace_id: workspaceId,
      tenantId,
      tenant_id: tenantId,
      exec_lane: lane,
      execLane: lane,
    },
    {
      toolName: toolKey,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
      executionMode,
      preferExplicitLane: true,
      targetType,
      connectionId: params.target_id ?? params.targetId ?? null,
    },
  );

  const exitCode = Number(terminalOut?.exit_code ?? terminalOut?.exitCode ?? (terminalOut?.ok ? 0 : 1));
  const body = {
    ok: terminalOut?.ok === true && exitCode === 0,
    protocol: executionMode,
    output: terminalOut?.output ?? terminalOut?.stdout ?? '',
    stdout: terminalOut?.stdout ?? terminalOut?.output ?? '',
    stderr: terminalOut?.stderr ?? '',
    exit_code: exitCode,
    tool_name: toolKey,
    target_id: terminalOut?.targetId ?? null,
    target_type: terminalOut?.targetType ?? targetType,
    target_lane: terminalOut?.targetLane ?? lane,
    transport: terminalOut?.transport ?? null,
    requested_lane: dockLane || lane,
    resolved_lane: lane,
    lane_substituted: false,
  };
  return body.ok
    ? { ok: true, body }
    : { ok: false, error: terminalOut?.error || 'terminal_command_failed', body };
}
