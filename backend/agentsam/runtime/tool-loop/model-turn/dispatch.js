import { dispatchStream } from '../../provider-dispatch.js';
import { evaluateGuardrails } from '../../../../../src/core/guardrails.js';
import { ensureExecutionParent } from '../../../../telemetry/executions/ledger.js';
import { isAgentRunAbortError } from '../../run-cancel.js';
import { resolveProviderForModelKey } from '../../../../telemetry/usage-events.js';
import { assembleWorkingContextForInference } from '../../../sessions/window/assemble.js';
import { compactConversationForNextModelPass } from './stream.js';

async function recordDispatchFailure(L, detail, modelT0) {
  const {
    env,
    ctx,
    modelKey,
    chatAgentRunId,
    runSpineIds,
    params,
  } = L;
  const latency = Math.max(0, Date.now() - modelT0);
  const errorPayload = JSON.stringify({
    model_key: modelKey,
    message: detail.slice(0, 4000),
  });
  ctx.waitUntil?.(
    (async () => {
      try {
        const agentRunId = runSpineIds.agent_run_id || params.chatAgentRunId || null;
        if (!agentRunId) return;
        const executionParentId = await ensureExecutionParent(env, {
          executionType: 'agent',
          runId: agentRunId,
          status: 'running',
        });
        if (!executionParentId) return;
        const nowSec = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
          `INSERT INTO agentsam_execution_steps (
             execution_id, agent_run_id, node_key, node_type, status,
             error_json, latency_ms, started_at, completed_at, created_at_unix
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            executionParentId,
            agentRunId,
            'model_dispatch_failed',
            'model',
            'failed',
            errorPayload,
            latency,
            nowSec,
            nowSec,
            nowSec,
          )
          .run();
      } catch (_) {}
    })(),
  );
}

async function dispatchFailure(L, error, modelT0) {
  const {
    emit,
    routeArmOutcome,
    toolCallsUsed,
    turnCount,
    chatAgentRunId,
    modelKey,
    executedToolNames,
  } = L;
  console.warn('[agent] model call failed:', error?.message ?? error);
  const { failureCategoryFromProviderHttpStatus } =
    await import('../../../../../src/core/reward-failure-category.js');
  const failureCategory =
    error && typeof error === 'object' && error.code === 'IAM_PROVIDER_HTTP'
      ? failureCategoryFromProviderHttpStatus(error.status)
      : 'provider_error';
  routeArmOutcome(false, { failure_category: failureCategory });
  const detail =
    error?.message != null
      ? String(error.message).slice(0, 8000)
      : String(error).slice(0, 8000);
  emit('error', {
    message: detail || 'Model call failed',
    detail,
    code: 'MODEL_DISPATCH_FAILED',
    tool_calls_used: toolCallsUsed,
    turns: turnCount,
    agent_run_id: chatAgentRunId != null ? String(chatAgentRunId) : null,
    model_key: modelKey,
    executed_tools: [
      ...new Set(
        executedToolNames
          .map((name) => String(name || '').trim())
          .filter(Boolean),
      ),
    ].slice(0, 24),
  });
  await recordDispatchFailure(L, detail, modelT0);
  const failure = new Error(detail || 'MODEL_DISPATCH_FAILED');
  failure.code = 'MODEL_DISPATCH_FAILED';
  failure.alreadyEmitted = true;
  throw failure;
}

export async function dispatchModelStream(L, mutable) {
  const {
    env,
    ctx,
    emit,
    request,
    modelKey,
    systemPrompt,
    conversationMessages,
    temperature,
    mode,
    userId,
    tenantId,
    workspaceId,
    routingWs,
    sessionId,
    chatAgentRunId,
    routingArmIdParam,
    routingTaskType,
    dispatchSpineParam,
    promptAuditContextParam,
    mcpCtx,
    abortScope,
    turnOpenaiContainerPin,
    turnCount,
    params,
    exitCancelled,
  } = L;
  const modelT0 = Date.now();

  try {
    const loopProvider = await resolveProviderForModelKey(env, modelKey, null);
    emit('runtime_context', {
      model_key: modelKey,
      model: modelKey,
      provider: loopProvider,
      turn: turnCount,
      agent_run_id: chatAgentRunId ?? null,
    });
    if (chatAgentRunId && env?.DB) {
      ctx.waitUntil?.(
        (async () => {
          try {
            await env.DB.prepare(
              `UPDATE agentsam_agent_run SET model_key = ? WHERE id = ?`,
            )
              .bind(String(modelKey).slice(0, 200), String(chatAgentRunId))
              .run();
          } catch (error) {
            console.warn('[agent] run_model_attribution', error?.message ?? error);
          }
        })(),
      );
    }

    const guardrail = await evaluateGuardrails(env, ctx, {
      applies_to: 'model',
      tenant_id: tenantId,
      workspace_id: workspaceId,
      user_id: userId,
      session_id: sessionId,
      conversation_id: sessionId,
      request_id: chatAgentRunId != null ? String(chatAgentRunId) : sessionId,
      run_group_id: chatAgentRunId != null ? String(chatAgentRunId) : null,
      route_path: '/api/agent/chat',
      model_key: modelKey,
    });
    if (guardrail.blocked) {
      throw new Error(
        `GUARDRAIL_BLOCKED:${guardrail.decision?.reason || 'model_blocked'}`,
      );
    }

    try {
      const assembled = await assembleWorkingContextForInference(env, ctx, {
        messages: conversationMessages,
        systemPrompt,
        tools: mutable.activeTools,
        modelKey,
        conversationId: sessionId,
        userId,
        workspaceId: routingWs || workspaceId,
        tenantId,
        agentRunId: chatAgentRunId,
      });
      if (Array.isArray(assembled?.messages)) {
        conversationMessages.length = 0;
        conversationMessages.push(...assembled.messages);
      }
      if (assembled?.compacted || (assembled?.steps && assembled.steps.length)) {
        console.info(
          '[agent] turn_context_assembled',
          JSON.stringify({
            estimated: assembled.estimated,
            compact_at: assembled.compactAt,
            usable: assembled.usable,
            context_window: assembled.contextWindow,
            steps: assembled.steps,
            message_count: conversationMessages.length,
            turn: turnCount,
          }),
        );
      }
    } catch (error) {
      console.warn('[agent] turn_assembler', error?.message ?? error);
      compactConversationForNextModelPass(conversationMessages);
    }

    const stream = await dispatchStream(env, request, {
      modelKey,
      systemPrompt,
      messages: conversationMessages,
      tools: mutable.activeTools,
      ...(mutable.forceTextOnlyAfterRepeatHalt ? { toolChoiceNone: true } : {}),
      reasoningEffort: dispatchSpineParam?.routing_decision?.reasoning_effort ?? null,
      temperature,
      userId,
      tenantId,
      workspaceId: routingWs || null,
      sessionId: sessionId ?? null,
      agentRunId: chatAgentRunId ?? null,
      routingArmId:
        routingArmIdParam ?? dispatchSpineParam?.routing_arm_id ?? null,
      ...(routingTaskType ? { taskType: routingTaskType } : {}),
      routeKey: params.chatRouteKey ?? params.routeKey ?? params.route_key ?? null,
      mode: (dispatchSpineParam?.routing_decision?.mode ?? mode) || 'agent',
      lane:
        dispatchSpineParam?.routing_decision?.lane ??
        (['debug', 'plan'].includes(
          String(
            (dispatchSpineParam?.routing_decision?.mode ?? mode) || '',
          ).toLowerCase(),
        )
          ? 'premium'
          : null),
      signal: abortScope.signal,
      openaiPreviousResponseId: mutable.openaiPtcActive
        ? null
        : mutable.openaiPreviousResponseId,
      ...(mutable.openaiPtcActive && mutable.openaiResponsesAccumulatedInput
        ? { openaiResponsesReplayInput: mutable.openaiResponsesAccumulatedInput }
        : {}),
      openaiResponsesCapture: L.openaiResponsesCapture,
      openaiContainerPin: turnOpenaiContainerPin,
      writePolicy:
        mcpCtx?.write_policy ||
        mcpCtx?.runtimeProfile?.write_policy ||
        mcpCtx?.sessionWritePolicy ||
        null,
      filesSource:
        String(mcpCtx?.files_source || mcpCtx?.filesSource || '')
          .trim()
          .toLowerCase() || null,
      promptAuditContext:
        promptAuditContextParam && typeof promptAuditContextParam === 'object'
          ? { ...promptAuditContextParam, loop_turn: turnCount }
          : promptAuditContextParam,
    });
    return { stream, isWorkersAiStream: false };
  } catch (error) {
    if (isAgentRunAbortError(error)) {
      return { earlyReturn: exitCancelled() };
    }
    return dispatchFailure(L, error, modelT0);
  }
}
