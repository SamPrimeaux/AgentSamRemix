/**
 * MCP panel AgentSam chat runtime — policy, tools, prompt, tool-loop.
 * No HTTP / SSE / Response knowledge.
 */
import { loadAgentSamUserPolicy } from '../../identity/index.js';
import { withTimeout } from '../../../src/core/agent-model-resolver.js';
import { loadToolsForRequest } from '../../../src/core/agent-tool-loader.js';
import { loadModeConfig } from '../../../src/core/d1-tool-profile.js';
import { runAgentToolLoop } from '../runtime/tool-loop/index.js';
import { filterToolsForMcpPanelGlobs, parseMcpPanelToolGlobs } from './panel-tool-policy.js';
import { buildMcpPanelHistoryMessages, scheduleMcpPanelSessionComplete } from './panel-session.js';

/** Outer ceiling for the entire MCP panel tool loop (not per-tool). */
export const MCP_PANEL_RUN_TIMEOUT_MS = 300000;

/**
 * @param {Record<string, unknown>} panel
 * @returns {{
 *   ok: true,
 *   tenantId: string,
 *   userId: string,
 *   workspaceId: string,
 *   personUuid: string|null,
 *   sessionPkId: string,
 *   slug: string,
 *   profile: Record<string, unknown>,
 *   modelKey: string,
 *   messages: { role: string, content: string }[],
 *   toolGlobs: string[],
 *   authUser: unknown,
 * } | { ok: false, httpStatus: number, body: Record<string, unknown> }}
 */
export function validateMcpPanelChatInput(panel) {
  const tenantId = panel?.tenantId != null ? String(panel.tenantId).trim() : '';
  const userId = panel?.userId != null ? String(panel.userId).trim() : '';
  const workspaceId = panel?.workspaceId != null ? String(panel.workspaceId).trim() : '';
  const personUuid =
    panel?.personUuid != null && String(panel.personUuid).trim() !== ''
      ? String(panel.personUuid).trim()
      : null;
  const sessionPkId = panel?.sessionPkId != null ? String(panel.sessionPkId).trim() : '';
  const slug = panel?.slug != null ? String(panel.slug).trim() : '';
  const profile = panel?.profile && typeof panel.profile === 'object' ? panel.profile : {};
  const modelKey = panel?.modelKey != null ? String(panel.modelKey).trim() : '';
  /** @type {{ role: string, content: string }[]} */
  const messages = Array.isArray(panel?.messages) ? panel.messages : [];

  let toolGlobs = parseMcpPanelToolGlobs(profile.allowed_tool_globs);
  if (Array.isArray(panel?.toolGlobsOverride) && panel.toolGlobsOverride.length) {
    toolGlobs = panel.toolGlobsOverride.map((x) => String(x || '').trim()).filter(Boolean);
  }

  if (!tenantId || !userId || !workspaceId || !sessionPkId || !slug || !modelKey) {
    return {
      ok: false,
      httpStatus: 400,
      body: { error: 'mcp_panel_chat: missing tenant/user/workspace/session/model' },
    };
  }
  if (!messages.length) {
    return { ok: false, httpStatus: 400, body: { error: 'messages required' } };
  }

  return {
    ok: true,
    tenantId,
    userId,
    workspaceId,
    personUuid,
    sessionPkId,
    slug,
    profile,
    modelKey,
    messages,
    toolGlobs,
    authUser: panel?.authUser ?? null,
  };
}

/**
 * Prepare mode/policy/tools/prompt for an MCP panel chat turn.
 * @param {any} env
 * @param {ReturnType<typeof validateMcpPanelChatInput> & { ok: true }} input
 */
export async function prepareMcpPanelChatRuntime(env, input) {
  const requestedMode = 'agent';
  const [modeConfig, userPolicy] = await Promise.all([
    loadModeConfig(env, requestedMode, input.workspaceId),
    loadAgentSamUserPolicy(env, input.userId, input.workspaceId),
  ]);

  const menuCap = Math.max(0, Math.min(200, Number(modeConfig.max_tools) || 0));
  const loopCap = Math.max(0, Math.min(200, Number(modeConfig.max_tool_calls) || 0));
  if (menuCap <= 0 || loopCap <= 0) {
    return {
      ok: false,
      httpStatus: 503,
      body: {
        error: 'mode_runtime_policy_missing',
        detail: 'agentsam_tool_profiles.runtime_policy_json / max_tools required for mode=agent',
        profile_key: modeConfig.profile_key,
        source: modeConfig.source,
      },
    };
  }

  const lastUserMsg =
    input.messages.length && String(input.messages[input.messages.length - 1]?.role || '') === 'user'
      ? String(input.messages[input.messages.length - 1]?.content || '')
      : '';

  const {
    tools: dbToolsRaw,
    toolRoutingError: panelToolRoutingError,
  } = await loadToolsForRequest(env, requestedMode, 'question', {
    limit: menuCap,
    includeSchemas: false,
    userId: input.userId,
    workspaceId: input.workspaceId,
    tenantId: input.tenantId,
    personUuid: input.personUuid,
    message: lastUserMsg,
    taskType: 'tool_use',
    agentChat: true,
    routeKey: 'general',
  });

  if (panelToolRoutingError) {
    return {
      ok: false,
      httpStatus: 422,
      body: {
        error: panelToolRoutingError.message,
        code: panelToolRoutingError.code,
        missing_capabilities: panelToolRoutingError.missing,
      },
    };
  }

  let tools = dbToolsRaw.map((t) => {
    const raw = t.input_schema && typeof t.input_schema === 'object' ? t.input_schema : {};
    return {
      name: t.name,
      description: t.description || t.name,
      input_schema: Object.assign({ type: 'object', properties: {} }, raw, { type: 'object' }),
    };
  });
  tools = filterToolsForMcpPanelGlobs(tools, input.toolGlobs);

  const sysInst = String(input.profile.instructions_markdown || '').trim();
  const systemPrompt =
    sysInst +
    '\n\n## Current Session\n' +
    `Tenant: ${input.tenantId}\n` +
    `Workspace: ${input.workspaceId}\n` +
    `Date: ${new Date().toISOString()}\n`;

  const mcpRuntimeContext = {
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    personUuid: input.personUuid,
    sessionId: input.sessionPkId,
    authUser: input.authUser,
    routeKey: 'general',
    mcp_panel_slug: input.slug,
  };

  return {
    ok: true,
    requestedMode,
    modeConfig,
    userPolicy,
    tools,
    systemPrompt,
    mcpRuntimeContext,
    effectiveMaxToolCalls: loopCap,
  };
}

/**
 * Execute a prepared MCP panel chat (streaming via emit).
 *
 * @param {any} env
 * @param {Request} request
 * @param {any} ctx
 * @param {Extract<ReturnType<typeof validateMcpPanelChatInput>, { ok: true }>} input
 * @param {Extract<Awaited<ReturnType<typeof prepareMcpPanelChatRuntime>>, { ok: true }>} prepared
 * @param {(type: string, payload?: Record<string, unknown>) => void} emit
 */
export async function executeMcpPanelChat(env, request, ctx, input, prepared, emit) {
  emit('context', {
    intent: 'mcp_panel',
    mode: prepared.requestedMode,
    model: input.modelKey,
    tool_count: prepared.tools.length,
    slug: input.slug,
  });

  let assistantAccum = '';
  let textEmitted = 0;
  /** @type {string|null} */
  let runError = null;
  let failedHard = false;

  const emitWrapped = (type, payload) => {
    if (type === 'text' && payload?.text) {
      textEmitted += String(payload.text).length;
      assistantAccum += String(payload.text);
    }
    emit(type, payload || {});
  };

  let toolCallsUsed = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  try {
    const lastLoopStats = await withTimeout(
      runAgentToolLoop(env, ctx, emitWrapped, {
        request,
        messages: input.messages,
        tools: prepared.tools,
        systemPrompt: prepared.systemPrompt,
        modelKey: input.modelKey,
        temperature:
          prepared.modeConfig.temperature != null ? prepared.modeConfig.temperature : undefined,
        maxToolCalls: prepared.effectiveMaxToolCalls,
        mode: prepared.requestedMode,
        modeConfig: prepared.modeConfig,
        userPolicy: prepared.userPolicy,
        sessionId: input.sessionPkId,
        tenantId: input.tenantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        qualityScore: 1,
        mcpRuntimeContext: prepared.mcpRuntimeContext,
        routingArmId: null,
        thompsonModelKey: null,
        chatRouteKey: 'general',
        promptAuditContext: {
          route: 'mcp_panel_chat',
          mcp_slug: input.slug,
          session_id: input.sessionPkId,
          workspace_id: input.workspaceId,
          mode: prepared.requestedMode,
        },
      }),
      MCP_PANEL_RUN_TIMEOUT_MS,
    );

    toolCallsUsed = Number(lastLoopStats?.toolCallsUsed) || 0;
    tokensIn = Number(lastLoopStats?.totalUsage?.input_tokens) || 0;
    tokensOut = Number(lastLoopStats?.totalUsage?.output_tokens) || 0;

    if (textEmitted <= 0) {
      runError = 'empty_stream';
      emit('error', { message: 'empty_stream' });
    }
  } catch (e) {
    failedHard = true;
    runError = String(e?.message || e || 'chat_failed');
    console.warn('[mcp_panel_chat]', runError);
    emit('error', { message: runError });
  }

  const historyMessages = failedHard
    ? undefined
    : buildMcpPanelHistoryMessages(input.messages, assistantAccum);

  scheduleMcpPanelSessionComplete(env, ctx, {
    zoneSlug: input.slug,
    tenantId: input.tenantId,
    messages: historyMessages,
    toolCallsUsed: failedHard ? 0 : toolCallsUsed,
    status: 'idle',
  });

  return {
    ok: true,
    assistantText: assistantAccum,
    toolCallsUsed,
    usage: { input_tokens: tokensIn, output_tokens: tokensOut },
    messages: historyMessages || buildMcpPanelHistoryMessages(input.messages, ''),
    status: 'idle',
    error: runError,
  };
}

/**
 * Validate + prepare + execute. Prefer HTTP adapter preflight then {@link executeMcpPanelChat}.
 *
 * @param {any} env
 * @param {Request} request
 * @param {any} ctx
 * @param {Record<string, unknown>} panel
 * @param {(type: string, payload?: Record<string, unknown>) => void} emit
 */
export async function runMcpPanelChat(env, request, ctx, panel, emit) {
  const input = validateMcpPanelChatInput(panel);
  if (!input.ok) return input;

  const prepared = await prepareMcpPanelChatRuntime(env, input);
  if (!prepared.ok) return prepared;

  return executeMcpPanelChat(env, request, ctx, input, prepared, emit);
}
