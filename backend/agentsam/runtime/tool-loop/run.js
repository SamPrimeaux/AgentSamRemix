import { isAgentRunAbortError } from '../run-cancel.js';
import { resolveCanonicalUserId } from '../../../identity/users/index.js';
import { fillMissingUsageFromText } from '../../../../src/core/openai-usage-tokens.js';
import { finalizeChatToolSessionLedger } from '../../../../src/core/agent-tool-validator.js';
import { extractBestAssistantPlainText } from '../../../../src/core/agent-prompt-builder.js';
import { runAgentModelTurn } from './model-turn/index.js';
import { dispatchToolCallsViaHost } from './host.js';
import { processTextOnlyModelTurn } from './recovery.js';
import { maybeScheduleChatArtifact } from './artifact.js';
import { createToolLoopState } from './state.js';
import {
  buildLoopResult,
  createExitCancelled,
  createSafeDone,
  createScheduleLoopUsageTelemetry,
  scheduleTextOnlyFeedback,
  synthesizeVisibleLoopHalt,
  wrapEmitForUserVisibleErrors,
} from './outcome.js';
import {
  checkRunTimeout,
  checkSpendGate,
  createAbortScopeForLoop,
  createShouldStopRun,
  resolveEffectiveMaxToolCalls,
} from './limits.js';
import { createPersistChatTurnMessages } from './persistence.js';
import { applyImageCapabilityPins, applyNamedCatalogPins } from './capability-pins.js';
import { lastUserMessageText } from './helpers.js';

async function fireFailureStopHooks(state) {
  const {
    loopBag,
    lifecycle,
    loopT0,
    routingWs,
    params: {
      sessionId,
      tenantId,
      userId,
      workspaceId,
      modelKey,
      chatAgentRunId,
    },
  } = state;
  if (!chatAgentRunId || !(routingWs || workspaceId)) return;
  try {
    const { fireAgentRunStopHooks } = await import(
      '../../../../src/core/agentsam-run-stop-hooks.js'
    );
    await fireAgentRunStopHooks(loopBag.env, loopBag.ctx, {
      success: false,
      agentRunId: chatAgentRunId,
      sessionId,
      conversationId: sessionId,
      tenantId,
      workspaceId: routingWs || workspaceId,
      userId,
      modelKey,
      errorMessage: lifecycle.ledgerErrorMsg,
      inputTokens: loopBag.totalUsage.input_tokens,
      outputTokens: loopBag.totalUsage.output_tokens,
      durationMs: Date.now() - loopT0,
      source: 'in_app_agent',
    });
  } catch {
    // Non-blocking failure accounting.
  }
}

export async function runAgentToolLoop(env, ctx, emit, params) {
  emit = wrapEmitForUserVisibleErrors(emit);
  const state = await createToolLoopState(env, ctx, emit, params);
  const {
    loopBag,
    lifecycle,
    doneGuard,
    userTextForForce,
    explicitCatalogSeedParam,
    runStartedAt,
    maxRunMs,
    maxTurns,
    routingWs,
    mcpCtx,
    attributedRoutingArmId,
    cacheWriteTtlForBilling,
    loopT0,
  } = state;
  const {
    modelKey,
    mode,
    sessionId,
    tenantId,
    userId,
    workspaceId,
    chatAgentRunId,
  } = state.params;
  const conversationMessages = loopBag.conversationMessages;
  const safeDone = createSafeDone(doneGuard, emit);
  const abortScope = createAbortScopeForLoop({
    request: params.request,
    externalSignal: params.signal,
    env,
    chatAgentRunId,
    sessionId,
  });
  const shouldStopRun = createShouldStopRun(abortScope);
  const scheduleLoopUsageTelemetry = createScheduleLoopUsageTelemetry({
    env,
    ctx,
    loopBag,
    modelKey,
    sessionId,
    tenantId,
    workspaceId,
    routingWs,
    userId,
    routingTaskType: params.routingTaskType,
    mode,
    chatRouteKey: state.chatRouteKey,
    chatAgentRunId,
    cacheWriteTtlForBilling,
    loopT0,
    attributedRoutingArmId,
    getLedgerErrorMsg: () => lifecycle.ledgerErrorMsg,
  });
  const synthesizeVisibleLoopHaltForRun = (code, message) =>
    synthesizeVisibleLoopHalt({
      emit,
      conversationMessages,
      executedToolNames: loopBag.executedToolNames,
      loopBag,
      chatAgentRunId,
      code,
      message,
    });
  const exitCancelled = createExitCancelled({
    abortScope,
    scheduleLoopUsageTelemetry,
    emit,
    safeDone,
    loopBag,
    modelKey,
    chatAgentRunId,
  });
  const persistChatTurnMessages = createPersistChatTurnMessages({
    env,
    sessionId,
    userId,
    modelKey,
    messages: params.messages,
    params,
    getConversationMessages: () => loopBag.conversationMessages,
    getTotalUsage: () => loopBag.totalUsage,
    getChatTurnPersisted: () => lifecycle.chatTurnPersisted,
    setChatTurnPersisted: (persisted) => {
      lifecycle.chatTurnPersisted = persisted;
    },
  });
  Object.assign(loopBag, {
    abortScope,
    effectiveMaxToolCalls: resolveEffectiveMaxToolCalls(params.maxToolCalls, params.userPolicy),
    safeDone,
    shouldStopRun,
    exitCancelled,
    synthesizeVisibleLoopHalt: synthesizeVisibleLoopHaltForRun,
    scheduleLoopUsageTelemetry,
  });

  try {
    if (explicitCatalogSeedParam != null) {
      console.info(
        '[agent] explicit_catalog_seed_ignored',
        JSON.stringify({
          name:
            explicitCatalogSeedParam && typeof explicitCatalogSeedParam === 'object'
              ? explicitCatalogSeedParam.name || null
              : null,
        }),
      );
    }
    await applyNamedCatalogPins(env, loopBag, emit, userTextForForce);
    await applyImageCapabilityPins(env, loopBag, emit, mcpCtx, userTextForForce);

    // Auth already resolved userId at session entry. Tools require auth_users.id (au_*).
    loopBag.canonicalToolChainUserId = userId
      ? await resolveCanonicalUserId(userId, env)
      : null;
    if (userId && !loopBag.canonicalToolChainUserId) {
      synthesizeVisibleLoopHaltForRun(
        'auth_user_id_required',
        'Agent tools require auth_users.id (au_*) from the authenticated session',
      );
      scheduleLoopUsageTelemetry(false);
      persistChatTurnMessages({ failed: true, errorText: 'auth_user_id_required' });
      return;
    }

    while (loopBag.turnCount < maxTurns) {
      loopBag.turnCount += 1;
      if (await shouldStopRun()) return exitCancelled();

      const timeoutResult = checkRunTimeout({
        runStartedAt,
        maxRunMs,
        loopBag,
        scheduleLoopUsageTelemetry,
        synthesizeVisibleLoopHalt: synthesizeVisibleLoopHaltForRun,
        emit,
        safeDone,
        modelKey,
        chatAgentRunId,
      });
      if (timeoutResult) return timeoutResult;

      const spendResult = await checkSpendGate({
        env,
        tenantId,
        workspaceId,
        routingWs,
        userId,
        sessionId,
        modelKey,
        loopBag,
        scheduleLoopUsageTelemetry,
        emit,
        safeDone,
        chatAgentRunId,
      });
      if (spendResult) return spendResult;

      const modelTurn = await runAgentModelTurn(loopBag);
      if (modelTurn?.earlyReturn) return modelTurn.earlyReturn;
      const {
        pendingApplyPatchCalls = [],
        turnHostedShellEvents = [],
        assistantContent = [],
        clientToolCalls = [],
        openaiNeedsContinuation = false,
      } = modelTurn;

      if (
        openaiNeedsContinuation &&
        !clientToolCalls.length &&
        !pendingApplyPatchCalls.length
      ) {
        emit('provider_continuation', {
          provider: 'openai_responses',
          reason: 'program_output_without_final_message',
          turn: loopBag.turnCount,
          agent_run_id: chatAgentRunId != null ? String(chatAgentRunId) : null,
        });
        continue;
      }

      if (!clientToolCalls.length && !pendingApplyPatchCalls.length) {
        const textOnly = processTextOnlyModelTurn({
          emit,
          conversationMessages,
          turnHostedShellEvents,
          assistantContent,
          turnCount: loopBag.turnCount,
          maxTurns,
          modelKey,
          chatAgentRunId,
          forceTextOnlyAfterRepeatHalt: loopBag.forceTextOnlyAfterRepeatHalt,
          emptyEndTurnRecoverUsed: loopBag.emptyEndTurnRecoverUsed,
          consecutiveEmptyHostedShellRecovers: loopBag.consecutiveEmptyHostedShellRecovers,
          EMPTY_HOSTED_SHELL_RECOVER_CAP: loopBag.EMPTY_HOSTED_SHELL_RECOVER_CAP,
        });
        loopBag.forceTextOnlyAfterRepeatHalt = textOnly.forceTextOnlyAfterRepeatHalt;
        loopBag.emptyEndTurnRecoverUsed = textOnly.emptyEndTurnRecoverUsed;
        loopBag.consecutiveEmptyHostedShellRecovers =
          textOnly.consecutiveEmptyHostedShellRecovers;
        scheduleTextOnlyFeedback(state, textOnly);
        if (textOnly.action === 'continue') continue;
        break;
      }

      loopBag.consecutiveEmptyHostedShellRecovers = 0;
      const hostResult = await dispatchToolCallsViaHost(
        loopBag,
        clientToolCalls,
        pendingApplyPatchCalls,
        modelTurn.decisionTurnUsage || null,
      );
      if (hostResult?.earlyReturn) return hostResult.earlyReturn;
    }
  } catch (error) {
    if (isAgentRunAbortError(error)) return exitCancelled();
    lifecycle.ledgerLoopThrew = true;
    lifecycle.ledgerErrorMsg =
      error?.message != null ? String(error.message) : String(error);
    const detail =
      error && typeof error === 'object' && 'detail' in error && error.detail != null
        ? String(error.detail).slice(0, 4000)
        : lifecycle.ledgerErrorMsg;
    persistChatTurnMessages({
      failed: true,
      errorText:
        error && typeof error === 'object' && error.code === 'IAM_PROVIDER_HTTP'
          ? `Model provider error (${error.status || 400}): ${detail}`
          : lifecycle.ledgerErrorMsg,
    });
    await fireFailureStopHooks(state);
    throw error;
  } finally {
    const assistantPlain = extractBestAssistantPlainText(conversationMessages) || '';
    let inputBlob = lastUserMessageText(conversationMessages) || '';
    try {
      inputBlob = JSON.stringify(conversationMessages);
    } catch {
      // Keep the last-user fallback.
    }
    fillMissingUsageFromText(loopBag.totalUsage, {
      inputText: inputBlob,
      outputText: assistantPlain,
    });
    if (loopBag.chatToolLedger?.runId) {
      try {
        await finalizeChatToolSessionLedger(env, ctx, emit, loopBag.chatToolLedger, {
          ok: !lifecycle.ledgerLoopThrew && !loopBag.loopTimedOut,
          errorMessage: loopBag.loopTimedOut
            ? 'agent_run_timeout'
            : lifecycle.ledgerErrorMsg,
        });
      } catch (error) {
        console.warn('[agent] chat_tool_session_ledger_finalize', error?.message ?? error);
      }
    }
    if (!lifecycle.chatTurnPersisted) {
      await persistChatTurnMessages({
        failed: Boolean(lifecycle.ledgerLoopThrew || loopBag.loopTimedOut),
        errorText: loopBag.loopTimedOut
          ? 'agent_run_timeout'
          : lifecycle.ledgerErrorMsg
            ? String(lifecycle.ledgerErrorMsg).slice(0, 500)
            : undefined,
      });
    }
    abortScope.dispose();
  }

  if (!loopBag.loopTimedOut && !lifecycle.ledgerLoopThrew) {
    scheduleLoopUsageTelemetry(true);
  }
  maybeScheduleChatArtifact({
    env,
    ctx,
    conversationMessages,
    userId,
    tenantId,
    workspaceId: routingWs || workspaceId,
    chatAgentRunId,
    sessionId,
  });
  if (!doneGuard.emitted) {
    safeDone({ tool_calls_used: loopBag.toolCallsUsed, turns: loopBag.turnCount });
  }
  return buildLoopResult({ loopBag, modelKey, chatAgentRunId, extras: { timedOut: false } });
}
