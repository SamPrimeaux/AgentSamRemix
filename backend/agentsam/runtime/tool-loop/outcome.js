import { recordUsage } from '../../../telemetry/index.js';
import { resolveProviderForModelKey } from '../../../telemetry/usage-events.js';
import {
  applyRoutingArmUsageFeedback,
  scheduleRoutingArmBanditUpdate,
  scheduleRoutingArmQualityUpdate,
} from '../routing/routing.js';
import { resolveDominantPromptPatternHash } from '../../../../src/core/prompt-pattern-bridge.js';
import {
  isInternalAgentErrorText,
  synthesizeUserVisibleAgentFailure,
} from '../../../../shared/agent-runtime/user-visible-agent-error.js';

export function wrapEmitForUserVisibleErrors(emitUpstream) {
  const upstream = typeof emitUpstream === 'function' ? emitUpstream : () => {};
  return (type, payload = {}) => {
    if (type === 'text' && payload && typeof payload === 'object') {
      const text = payload.text;
      if (typeof text === 'string' && isInternalAgentErrorText(text)) {
        return upstream('text', { ...payload, text: synthesizeUserVisibleAgentFailure(text) });
      }
    }
    if (type === 'error' && payload && typeof payload === 'object') {
      const message = payload.message;
      if (typeof message === 'string' && message.trim()) {
        return upstream('error', {
          ...payload,
          message: synthesizeUserVisibleAgentFailure(message, {
            code: payload.code != null ? String(payload.code) : null,
          }),
        });
      }
    }
    if (type === 'tool_error' && payload && typeof payload === 'object') {
      const error = payload.error;
      if (typeof error === 'string' && isInternalAgentErrorText(error)) {
        return upstream('tool_error', {
          ...payload,
          error: synthesizeUserVisibleAgentFailure(error, {
            code: payload.code != null ? String(payload.code) : null,
          }),
        });
      }
    }
    return upstream(type, payload);
  };
}

export function createSafeDone(doneGuard, emit) {
  return (payload) => {
    if (doneGuard.emitted) return;
    doneGuard.emitted = true;
    emit('done', payload);
  };
}

export function synthesizeVisibleLoopHalt({
  emit,
  conversationMessages,
  executedToolNames,
  loopBag,
  chatAgentRunId,
  code,
  message,
}) {
  const tools =
    executedToolNames.length > 0
      ? [...new Set(executedToolNames.map((name) => String(name || '').trim()).filter(Boolean))].slice(0, 16)
      : [];
  const text =
    `${message}` +
    (tools.length
      ? `\n\nCompleted tools this run (${loopBag.toolCallsUsed}): ${tools.join(', ')}. ` +
        'Ask me to continue from a specific symbol or hop and I will pick up with a narrower scope.'
      : '');
  console.warn(
    '[agent] loop_halt_visible_reply',
    JSON.stringify({
      code,
      tool_calls_used: loopBag.toolCallsUsed,
      turn: loopBag.turnCount,
      agent_run_id: chatAgentRunId != null ? String(chatAgentRunId) : null,
    }),
  );
  emit('status', { phase: 'recover_halt', message: `Halt ${code} — synthesizing a visible reply` });
  emit('text', { text });
  conversationMessages.push({ role: 'assistant', content: [{ type: 'text', text }] });
}

export function buildLoopResult({ loopBag, modelKey, chatAgentRunId, extras = {} }) {
  return {
    totalUsage: loopBag.totalUsage,
    toolCallsUsed: loopBag.toolCallsUsed,
    executedToolNames: loopBag.executedToolNames,
    modelKey,
    turnCount: loopBag.turnCount,
    workflowRunId: null,
    agentRunId: chatAgentRunId != null ? String(chatAgentRunId) : null,
    chainRootId: loopBag.toolChainRootId,
    dominantPromptPatternHash: resolveDominantPromptPatternHash(loopBag.promptPatternStats),
    ...extras,
  };
}

export function createExitCancelled({
  abortScope,
  scheduleLoopUsageTelemetry,
  emit,
  safeDone,
  loopBag,
  modelKey,
  chatAgentRunId,
}) {
  return () => {
    abortScope.dispose();
    scheduleLoopUsageTelemetry(false);
    emit('error', { message: 'Stopped by user', code: 'agent_run_cancelled' });
    safeDone({
      tool_calls_used: loopBag.toolCallsUsed,
      turns: loopBag.turnCount,
      code: 'agent_run_cancelled',
      cancelled: true,
    });
    return buildLoopResult({
      loopBag,
      modelKey,
      chatAgentRunId,
      extras: { cancelled: true },
    });
  };
}

export function createScheduleLoopUsageTelemetry({
  env,
  ctx,
  loopBag,
  modelKey,
  sessionId,
  tenantId,
  workspaceId,
  routingWs,
  userId,
  routingTaskType,
  mode,
  chatRouteKey,
  chatAgentRunId,
  cacheWriteTtlForBilling,
  loopT0,
  attributedRoutingArmId,
  getLedgerErrorMsg,
}) {
  let telemetryFlushed = false;
  return (success = true) => {
    const totalUsage = loopBag.totalUsage;
    if (telemetryFlushed) return;
    if (!totalUsage.input_tokens && !totalUsage.output_tokens && loopBag.turnCount <= 0) return;
    telemetryFlushed = true;
    const aid = attributedRoutingArmId();
    ctx.waitUntil?.(
      (async () => {
        try {
          const provider = await resolveProviderForModelKey(env, modelKey, null);
          const out = await recordUsage(
            env,
            {
              sessionId,
              tenantId,
              workspaceId: routingWs || undefined,
              userId,
              provider,
              model: modelKey,
              inputTokens: totalUsage.input_tokens,
              outputTokens: totalUsage.output_tokens,
              cacheReadTokens: totalUsage.cache_read_input_tokens,
              cacheWriteTokens: totalUsage.cache_creation_input_tokens,
              cacheWriteTtl: cacheWriteTtlForBilling,
              toolCallCount: loopBag.toolCallsUsed,
              success,
              routingArmId: aid,
              latencyMs: Date.now() - loopT0,
              ...(routingTaskType ? { taskType: routingTaskType } : {}),
              mode: mode || 'agent',
              executionCtx: ctx,
            },
            null,
          );
          if (aid && success) {
            await applyRoutingArmUsageFeedback(env, {
              armId: aid,
              success: true,
              routeKey: chatRouteKey,
              mode: mode || 'agent',
              modelKey,
              workspaceId: routingWs || workspaceId,
              tenantId,
              agentRunId: chatAgentRunId != null ? String(chatAgentRunId) : null,
              costUsd: Number(out?.estimatedCostUsd) || 0,
              durationMs: Date.now() - loopT0,
            });
          }
          if (chatAgentRunId && (routingWs || workspaceId)) {
            const { fireAgentRunStopHooks } = await import('../../../../src/core/agentsam-run-stop-hooks.js');
            await fireAgentRunStopHooks(env, ctx, {
              success,
              agentRunId: chatAgentRunId,
              sessionId,
              conversationId: sessionId,
              tenantId,
              workspaceId: routingWs || workspaceId,
              userId,
              modelKey,
              provider,
              errorMessage: success ? null : getLedgerErrorMsg(),
              inputTokens: totalUsage.input_tokens,
              outputTokens: totalUsage.output_tokens,
              costUsd: Number(out?.estimatedCostUsd) || 0,
              durationMs: Date.now() - loopT0,
              source: 'in_app_agent',
            });
          }
        } catch (error) {
          console.warn('[agent] loop_usage_telemetry', error?.message ?? error);
        }
      })(),
    );
  };
}

export function scheduleTextOnlyFeedback(state, textOnly) {
  const {
    loopBag,
    loopT0,
    routingWs,
    chatRouteKey,
    attributedRoutingArmId,
    params: {
      mode,
      modelKey,
      routingTaskType,
      qualityScore,
      workspaceId,
      tenantId,
      userId,
      chatAgentRunId,
    },
  } = state;
  if (textOnly.banditPenalty?.reason) {
    const reason = String(textOnly.banditPenalty.reason);
    const armId = attributedRoutingArmId();
    const runId = chatAgentRunId != null ? String(chatAgentRunId).trim() : '';
    if (armId) {
      loopBag.ctx.waitUntil?.(
        applyRoutingArmUsageFeedback(loopBag.env, {
          armId,
          success: false,
          signalValue: 1,
          routeKey: chatRouteKey,
          mode: mode || 'ask',
          modelKey,
          taskType: routingTaskType,
          workspaceId: routingWs || workspaceId,
          tenantId,
          userId,
          agentRunId: runId || null,
          durationMs: Math.max(0, Date.now() - loopT0),
          dedupKey: runId
            ? `empty_end_turn:${runId}:${reason}`
            : `empty_end_turn:${armId}:${reason}:${Math.floor(Date.now() / 1000)}`,
          reason,
          failure_category: 'empty_response',
          metadata: { empty_end_turn: reason },
        }),
      );
    } else if (routingWs && routingTaskType) {
      scheduleRoutingArmBanditUpdate(loopBag.env, loopBag.ctx, {
        taskType: routingTaskType,
        mode: mode || 'ask',
        modelKey,
        workspaceId: routingWs,
        success: false,
        lastChainId: null,
        failure_category: 'empty_response',
      });
    }
  }
  if (textOnly.action === 'continue' || !routingWs || !routingTaskType) return;
  const score = Number(qualityScore);
  if (!Number.isFinite(score)) return;
  scheduleRoutingArmQualityUpdate(loopBag.env, loopBag.ctx, {
    taskType: routingTaskType,
    routeKey: chatRouteKey,
    mode: mode || 'ask',
    modelKey,
    workspaceId: routingWs,
    qualityScore: score,
  });
}
