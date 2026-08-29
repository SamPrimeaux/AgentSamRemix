/**
 * POST /api/agent/chat/execute-approved-tool — peeled from agent/chat.js (Pass A).
 * Ticket: tkt_mod_peel_agent_chat_api_2026_08
 */
import { jsonResponse } from './shared.js';


/**
 * @returns {Promise<Response|null>}
 */
export async function handleExecuteApprovedToolApi(request, url, env, ctx, routeAuth, identity, services = {}) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  if (path !== '/api/agent/chat/execute-approved-tool' || method !== 'POST') return null;


  const body = await request.json().catch(() => ({}));
  const {
    resolveIamActorContext,
    scheduleRecordMcpToolExecution,
    normalizeToolName,
    dispatchToolCallWithBudget,
    resolveToolExecutionBudgetMs,
    resolveCatalogDispatchToolKey,
  } = services;
  if (
    typeof resolveIamActorContext !== 'function' ||
    typeof scheduleRecordMcpToolExecution !== 'function' ||
    typeof normalizeToolName !== 'function' ||
    typeof dispatchToolCallWithBudget !== 'function' ||
    typeof resolveToolExecutionBudgetMs !== 'function' ||
    typeof resolveCatalogDispatchToolKey !== 'function'
  ) {
    return jsonResponse({ success: false, error: 'approved_tool_services_required' }, 503);
  }
  const rawToolName = String(body.tool_name ?? body.name ?? '').trim();
  // normalize aliases then map legacy write_file → fs_write_file for agentsam_tools lookup
  const toolName = resolveCatalogDispatchToolKey(normalizeToolName(rawToolName));
  if (!toolName) {
    return jsonResponse({ success: false, error: 'tool_name required' }, 400);
  }
  const toolInput =
    body.tool_input && typeof body.tool_input === 'object'
      ? body.tool_input
      : body.parameters && typeof body.parameters === 'object'
        ? body.parameters
        : body.input && typeof body.input === 'object'
          ? body.input
          : {};
  const conversationId =
    body.conversation_id != null && String(body.conversation_id).trim() !== ''
      ? String(body.conversation_id).trim()
      : null;
  const approvedToolSpine = {
    agent_run_id:
      body.agent_run_id != null && String(body.agent_run_id).trim() !== ''
        ? String(body.agent_run_id).trim()
        : body.agentRunId != null && String(body.agentRunId).trim() !== ''
          ? String(body.agentRunId).trim()
          : null,
    conversation_id: conversationId,
  };

  console.log('[execute-approved-tool] tool_name:', toolName);
  console.log('[execute-approved-tool] tool_input:', JSON.stringify(toolInput).slice(0, 2000));

  const actorCtx = await resolveIamActorContext(request, env).catch(() => null);
  const sessionId = conversationId ?? identity?.sessionId ?? actorCtx?.sessionId ?? null;
  const context = {
    sessionId,
    tenantId: identity?.tenantId ?? actorCtx?.tenantId ?? null,
    userId: identity?.userId ?? actorCtx?.userId ?? null,
    workspaceId: identity?.workspaceId ?? actorCtx?.workspaceId ?? null,
    personUuid: identity?.personUuid ?? actorCtx?.personUuid ?? null,
    mayUsePrivilegedTerminal: actorCtx?.mayUsePrivilegedTerminal === true,
    request,
    ...approvedToolSpine,
  };

  const toolBudgetMs = resolveToolExecutionBudgetMs(toolName, toolInput);
  const execT0 = Date.now();
  try {
    const result = await dispatchToolCallWithBudget(
      env,
      toolName,
      toolInput,
      context,
      toolBudgetMs,
    );
    const execMs = Math.max(0, Date.now() - execT0);
    console.log('[execute-approved-tool] result:', JSON.stringify(result).slice(0, 2000));

    scheduleRecordMcpToolExecution(env, ctx, {
      tenant_id: context.tenantId,
      workspace_id: context.workspaceId,
      session_id: sessionId,
      tool_name: toolName,
      tool_id: null,
      input_json: JSON.stringify(toolInput || {}),
      output_json: JSON.stringify(result ?? null).slice(0, 50000),
      success: true,
      error_message: null,
      duration_ms: execMs,
      user_id: context.userId,
      invoked_by: context.userId || 'iam_agent',
      status: 'completed',
      // TELEMETRY-001: catalog insertToolCallLog owns agentsam_tool_call_log on this path.
      skip_tool_call_log: true,
      ...approvedToolSpine,
    });

    return jsonResponse({ success: true, tool_name: toolName, result });
  } catch (e) {
    const execMs = Math.max(0, Date.now() - execT0);
    const errMsg =
      e && typeof e === 'object' && 'message' in e && typeof e.message === 'string'
        ? e.message
        : String(e ?? 'unknown_error');
    console.warn('[execute-approved-tool] tool_error', toolName, errMsg);

    scheduleRecordMcpToolExecution(env, ctx, {
      tenant_id: context.tenantId,
      workspace_id: context.workspaceId,
      session_id: sessionId,
      tool_name: toolName,
      tool_id: null,
      input_json: JSON.stringify(toolInput || {}),
      output_json: null,
      success: false,
      error_message: errMsg.slice(0, 4000),
      duration_ms: execMs,
      user_id: context.userId,
      invoked_by: context.userId || 'iam_agent',
      status: 'error',
      // TELEMETRY-001: catalog owns agentsam_tool_call_log on this path (incl. error finalize).
      skip_tool_call_log: true,
      ...approvedToolSpine,
    });

    return jsonResponse({ success: false, tool_name: toolName, error: errMsg }, 200);
  }
  return null;
}
