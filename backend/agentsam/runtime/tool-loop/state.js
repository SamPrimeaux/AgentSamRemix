import { normalizeChatDispatchSpine } from '../turn/context.js';
import {
  applyRoutingArmUsageFeedback,
  scheduleRoutingArmBanditUpdate,
} from '../routing/routing.js';
import { cloneMessagesForWorkingContext } from '../../sessions/window/assemble.js';
import { createAgentToolLoopPtcHelpers } from './ptc.js';
import { lastUserMessageText } from './helpers.js';

export async function createToolLoopState(env, ctx, emit, params) {
  const {
    request,
    messages,
    tools,
    systemPrompt,
    modelKey,
    temperature,
    mode,
    modeConfig,
    userPolicy,
    sessionId,
    tenantId,
    userId,
    workspaceId,
    authUser: authUserParam = null,
    routingTaskType,
    routeKey: routeKeyParam = null,
    chatRouteKey: chatRouteKeyParam = null,
    qualityScore,
    mcpRuntimeContext,
    routingArmId: routingArmIdParam,
    agentSlug: agentSlugParam = null,
    runStartedAt: runStartedAtParam,
    maxRuntimeMs: maxRuntimeMsParam,
    chatAgentRunId,
    dispatchSpine: dispatchSpineParam = null,
    codemodeRuntime: codemodeRuntimeParam = null,
    promptAuditContext: promptAuditContextParam,
    promptManifest: promptManifestParam = null,
    cacheWriteTtl: cacheWriteTtlParam,
    activeFileEnvelope: activeFileEnvelopeParam = null,
    handoffDepth: handoffDepthParam = 0,
    rootSessionId: rootSessionIdParam = null,
    explicitCatalogSeed: explicitCatalogSeedParam = null,
  } = params;

  const cacheWriteTtlForBilling =
    cacheWriteTtlParam != null && String(cacheWriteTtlParam).trim()
      ? String(cacheWriteTtlParam).trim()
      : '5m';
  const routingWs = workspaceId != null ? String(workspaceId).trim() : '';
  const chatRouteKey =
    routeKeyParam != null && String(routeKeyParam).trim()
      ? String(routeKeyParam).trim()
      : chatRouteKeyParam != null && String(chatRouteKeyParam).trim()
        ? String(chatRouteKeyParam).trim()
        : null;
  const loopT0 = Date.now();
  const runStartedAt = runStartedAtParam != null ? Number(runStartedAtParam) : loopT0;
  const maxRunMs =
    Number(modeConfig?.max_runtime_ms) || Number(maxRuntimeMsParam) || 180_000;
  const maxTurns = Math.max(1, Math.min(24, Number(modeConfig?.max_turns) || 6));
  const doneGuard = params.doneGuard ?? { emitted: false };
  const dispatchSpine = normalizeChatDispatchSpine(
    dispatchSpineParam && typeof dispatchSpineParam === 'object'
      ? dispatchSpineParam
      : { agent_run_id: chatAgentRunId, routing_arm_id: routingArmIdParam, mode },
  );
  const routingArmIdStr = dispatchSpine.routing_arm_id || '';
  const openWebBudget = { turnCalls: 0, runCalls: 0 };
  const turnOpenaiContainerPin = Object.create(null);
  const runSpineIds = {
    agent_run_id: dispatchSpine.agent_run_id,
    conversation_id: sessionId != null ? String(sessionId).trim() : null,
    turn_id: params.chatTurnMeta?.turnId ?? null,
    routing_arm_id: routingArmIdStr || null,
    openWebBudget,
    activeFileEnvelope: activeFileEnvelopeParam,
    ctx,
    openaiContainerPin: turnOpenaiContainerPin,
  };
  const attributedRoutingArmId = () => routingArmIdStr || null;
  const ledgerIdentityFields = {
    agentId: String(params.agentId ?? params.agent_id ?? agentSlugParam ?? '').trim() || null,
    sourceTool:
      String(
        params.sourceTool ?? params.source_tool ?? params.chatRouteKey ?? 'dashboard_chat',
      ).trim() || 'dashboard_chat',
  };
  const mcpCtx =
    mcpRuntimeContext && typeof mcpRuntimeContext === 'object' ? { ...mcpRuntimeContext } : {};
  if (!mcpCtx.authUser && authUserParam) mcpCtx.authUser = authUserParam;
  if (chatRouteKey) mcpCtx.routeKey = chatRouteKey;

  const loopBag = {
    conversationMessages: cloneMessagesForWorkingContext(messages),
    activeTools: Array.isArray(tools) ? tools.slice() : tools,
    openWebSearchRetired: false,
    toolCallsUsed: 0,
    executedToolNames: [],
    totalUsage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    turnCount: 0,
    chatToolLedger: null,
    toolChainRootId: null,
    openaiPreviousResponseId: null,
    openaiResponsesAccumulatedInput: null,
    openaiPtcActive: false,
    loopTimedOut: false,
    lastToolArgsFingerprint: null,
    repeatedSameToolArgsCount: 0,
    lastToolNameOnly: null,
    repeatedSameToolNameCount: 0,
    forceTextOnlyAfterRepeatHalt: false,
    emptyEndTurnRecoverUsed: false,
    consecutiveEmptyHostedShellRecovers: 0,
    EMPTY_HOSTED_SHELL_RECOVER_CAP: 2,
    retrieveKnownSymbols: new Set(),
    imageAskForTurn: false,
    canonicalToolChainUserId: null,
    promptManifest: promptManifestParam,
    promptPatternStats: {},
    cacheWriteTtlForBilling,
  };
  const openaiResponsesCapture = {};
  const lifecycle = {
    ledgerLoopThrew: false,
    ledgerErrorMsg: null,
    chatTurnPersisted: false,
  };
  const routeArmOutcome = (success, opts = {}) => {
    const failureCategory =
      !success && opts?.failure_category != null ? opts.failure_category : null;
    const armId = attributedRoutingArmId();
    if (armId) {
      ctx.waitUntil?.(
        applyRoutingArmUsageFeedback(env, {
          armId,
          success,
          routeKey: chatRouteKey,
          mode: mode || 'agent',
          modelKey,
          workspaceId: routingWs || workspaceId,
          tenantId,
          agentRunId: chatAgentRunId != null ? String(chatAgentRunId) : null,
          costUsd: 0,
          durationMs: Math.max(0, Date.now() - loopT0),
          failure_category: failureCategory,
        }),
      );
    } else if (routingWs && routingTaskType) {
      scheduleRoutingArmBanditUpdate(env, ctx, {
        taskType: routingTaskType,
        mode: mode || 'ask',
        modelKey,
        workspaceId: routingWs,
        success,
        lastChainId: null,
        failure_category: failureCategory,
      });
    }
  };
  const ptc = createAgentToolLoopPtcHelpers({
    emit,
    getOpenaiPtcActive: () => loopBag.openaiPtcActive,
    getOpenaiResponsesAccumulatedInput: () => loopBag.openaiResponsesAccumulatedInput,
    getActiveTools: () => loopBag.activeTools,
    setActiveTools: (activeTools) => {
      loopBag.activeTools = activeTools;
    },
    getOpenWebSearchRetired: () => loopBag.openWebSearchRetired,
    setOpenWebSearchRetired: (retired) => {
      loopBag.openWebSearchRetired = retired;
    },
  });
  const userTextForForce =
    lastUserMessageText(loopBag.conversationMessages) ||
    String(mcpCtx?.userMessage || mcpCtx?.message || '').trim();

  Object.assign(loopBag, {
    env,
    ctx,
    emit,
    request,
    params,
    messages,
    modelKey,
    systemPrompt,
    temperature,
    mode,
    modeConfig,
    userPolicy,
    userId,
    tenantId,
    workspaceId,
    routingWs,
    sessionId,
    chatAgentRunId,
    routingArmIdParam,
    routingTaskType,
    chatRouteKey,
    qualityScore,
    agentSlugParam,
    handoffDepthParam,
    rootSessionIdParam,
    dispatchSpineParam,
    routeArmOutcome,
    promptAuditContextParam,
    mcpCtx,
    authUserParam,
    activeFileEnvelopeParam,
    codemodeRuntimeParam,
    runSpineIds,
    openaiResponsesCapture,
    turnOpenaiContainerPin,
    runStartedAt,
    maxRunMs,
    maxTurns,
    ...ptc,
    attributedRoutingArmId,
    ledgerIdentityFields,
    userTextForForce,
  });

  return {
    loopBag,
    lifecycle,
    doneGuard,
    userTextForForce,
    explicitCatalogSeedParam,
    loopT0,
    runStartedAt,
    maxRunMs,
    maxTurns,
    routingWs,
    chatRouteKey,
    mcpCtx,
    attributedRoutingArmId,
    cacheWriteTtlForBilling,
    params: {
      request,
      messages,
      modelKey,
      mode,
      userPolicy,
      sessionId,
      tenantId,
      userId,
      workspaceId,
      routingTaskType,
      qualityScore,
      chatAgentRunId,
    },
  };
}
