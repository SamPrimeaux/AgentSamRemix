import { resolveModelMeta } from '../../provider-dispatch.js';
import {
  consumeOpenAIChatCompletionsSse,
  consumeOpenAIResponsesSse,
} from '../../../../../src/core/agent-sse-consumer.js';
import { normalizeOpenAiToolStopReason } from '../tool-stop-reason.js';
import { isEmptyHostedShellAction } from '../../../../../src/core/openai-hosted-shell.js';
import {
  pinOpenaiContainerId,
  extractContainerIdFromHostedShellEvents,
} from '../../../../../src/core/openai-container-pin.js';
import {
  assertSuccessfulResponse,
  consumeSseText,
  readOpenAiTransportMeta,
} from './stream.js';
import { openAIOutputNeedsContinuation } from '../../../providers/openai-ptc.js';

function applyNormalizedOpenAI(parsed, L, state) {
  const {
    assistantContent,
    pendingToolCalls,
  } = state;
  const textBlock = assistantContent[assistantContent.length - 1];
  if (textBlock && textBlock.type === 'text') textBlock.text = parsed.text || '';
  state.assistantReasoningContent = String(parsed.reasoningContent || '').trim();
  if (Array.isArray(parsed.gemini_model_parts) && parsed.gemini_model_parts.length) {
    state.turnGeminiModelParts = parsed.gemini_model_parts;
  }
  for (const toolCall of parsed.pendingToolCalls) {
    const linkId =
      String(toolCall.call_id || toolCall.id || '').trim() || toolCall.id;
    assistantContent.push({
      type: 'tool_use',
      id: linkId,
      name: toolCall.name,
      input: toolCall.input,
      ...(toolCall.caller != null ? { caller: toolCall.caller } : {}),
      ...(toolCall.gemini_thought_signature
        ? { gemini_thought_signature: toolCall.gemini_thought_signature }
        : {}),
    });
    pendingToolCalls.push({
      ...toolCall,
      id: linkId,
      _done: true,
      _server: false,
    });
  }
  state.stopReason = normalizeOpenAiToolStopReason(
    parsed.finishReason,
    parsed.pendingToolCalls.length +
      (Array.isArray(parsed.pendingApplyPatchCalls)
        ? parsed.pendingApplyPatchCalls.length
        : 0),
  );
  if (
    Array.isArray(parsed.pendingApplyPatchCalls) &&
    parsed.pendingApplyPatchCalls.length
  ) {
    state.pendingApplyPatchCalls = parsed.pendingApplyPatchCalls;
  }
  if (Array.isArray(parsed.hostedShellEvents) && parsed.hostedShellEvents.length) {
    state.turnHostedShellEvents = parsed.hostedShellEvents;
    const shellCalls = parsed.hostedShellEvents.filter(
      (event) => event?.type === 'shell_call',
    );
    console.info(
      '[agent] openai_hosted_shell_calls',
      JSON.stringify({
        count: shellCalls.length,
        event_count: parsed.hostedShellEvents.length,
        call_ids: shellCalls
          .map((event) => event.call_id)
          .filter(Boolean)
          .slice(0, 8),
        empty_count: shellCalls.filter((event) =>
          isEmptyHostedShellAction(event?.action),
        ).length,
        workspace_targeted_count: shellCalls.filter(
          (event) => event?.workspace_targeted === true,
        ).length,
        turn: L.turnCount,
      }),
    );
    const containerId = extractContainerIdFromHostedShellEvents(
      parsed.hostedShellEvents,
    );
    if (containerId) {
      L.ctx.waitUntil?.(
        pinOpenaiContainerId(L.env, {
          ...L.runSpineIds,
          openaiContainerPin: L.turnOpenaiContainerPin,
          agent_run_id:
            L.chatAgentRunId != null ? String(L.chatAgentRunId) : null,
          userId: L.userId,
          workspaceId: L.routingWs || L.workspaceId,
        }, containerId),
      );
    }
  }
  if (
    parsed.input_tokens ||
    parsed.output_tokens ||
    parsed.cache_read_input_tokens
  ) {
    L.totalUsage.input_tokens += parsed.input_tokens || 0;
    L.totalUsage.output_tokens += parsed.output_tokens || 0;
    L.totalUsage.cache_read_input_tokens += parsed.cache_read_input_tokens || 0;
    L.totalUsage.cache_creation_input_tokens +=
      parsed.cache_creation_input_tokens || 0;
  }
}

async function consumeResponses(stream, L, state, transportMeta) {
  state.assistantContent.push({ type: 'text', text: '' });
  const parsed = await consumeOpenAIResponsesSse(stream.body, L.emit, {
    throwIfAborted: () => L.abortScope.throwIfAborted(),
    signal: L.abortScope.signal,
  });
  applyNormalizedOpenAI(parsed, L, state);

  if (L.openaiResponsesCapture.openaiPtcEnabled === true) {
    state.openaiPtcActive = true;
    if (!state.openaiResponsesAccumulatedInput) {
      state.openaiResponsesAccumulatedInput = Array.isArray(
        L.openaiResponsesCapture.sentInput,
      )
        ? [...L.openaiResponsesCapture.sentInput]
        : [];
    }
    if (Array.isArray(parsed.outputItems) && parsed.outputItems.length) {
      state.openaiResponsesAccumulatedInput.push(...parsed.outputItems);
    }
    state.openaiNeedsContinuation = openAIOutputNeedsContinuation(parsed.outputItems);
    for (const item of parsed.outputItems || []) {
      if (item?.type !== 'function_call') continue;
      const callerType = String(item?.caller?.type || '').toLowerCase();
      if (callerType === 'program' || callerType === 'programmatic') {
        const match = (parsed.pendingToolCalls || []).find(
          (toolCall) =>
            String(toolCall.call_id || toolCall.id || '') ===
            String(item.call_id || ''),
        );
        if (match && match.caller == null) {
          console.error(
            '[agent] openai_ptc_caller_integrity_fail',
            JSON.stringify({ call_id: item.call_id, name: item.name }),
          );
          L.emit('error', {
            message: 'OpenAI PTC caller integrity failed — refusing silent resume',
            code: 'openai_ptc_caller_integrity',
          });
          throw new Error('openai_ptc_caller_integrity');
        }
      }
    }
    state.openaiPreviousResponseId = null;
    L.emit('provider_response', {
      provider: 'openai_responses',
      response_id: parsed.responseId || null,
      transport: transportMeta?.transport || null,
      turn: L.turnCount,
      agent_run_id:
        L.chatAgentRunId != null ? String(L.chatAgentRunId) : null,
      openai_ptc: true,
      store: false,
      replay_items: state.openaiResponsesAccumulatedInput.length,
      needs_continuation: state.openaiNeedsContinuation === true,
    });
  } else if (parsed.responseId) {
    state.openaiPreviousResponseId = parsed.responseId;
    L.emit('provider_response', {
      provider: 'openai_responses',
      response_id: parsed.responseId,
      transport: transportMeta?.transport || null,
      turn: L.turnCount,
      agent_run_id:
        L.chatAgentRunId != null ? String(L.chatAgentRunId) : null,
    });
  }
}

export async function consumeResponseTransport(stream, L, state, streamUsage) {
  const transportMeta = readOpenAiTransportMeta(stream, L);
  await assertSuccessfulResponse(stream, L);
  const streamMeta = await resolveModelMeta(L.env, L.modelKey);
  const platform = String(streamMeta?.api_platform || '').toLowerCase();
  const useOpenAIResponses =
    platform === 'openai_responses' || platform === 'responses';
  const useOpenAIChatCompletions =
    platform === 'openai' ||
    platform === 'openai_chat_completions' ||
    platform === 'deepseek';
  const useOpenAiShapedToolStream =
    useOpenAIChatCompletions ||
    platform === 'gemini_api' ||
    platform === 'workers_ai';

  if (stream.body && useOpenAIResponses) {
    await consumeResponses(stream, L, state, transportMeta);
  } else if (stream.body && useOpenAiShapedToolStream) {
    state.assistantContent.push({ type: 'text', text: '' });
    const parsed = await consumeOpenAIChatCompletionsSse(
      stream.body,
      L.emit,
      {
        throwIfAborted: () => L.abortScope.throwIfAborted(),
        signal: L.abortScope.signal,
      },
    );
    applyNormalizedOpenAI(parsed, L, state);
  } else if (stream.body) {
    state.assistantContent.push({ type: 'text', text: '' });
    await consumeSseText(stream.body, {
      assistantContent: state.assistantContent,
      emit: L.emit,
      abortScope: L.abortScope,
      usage: streamUsage,
    });
    state.stopReason = 'end_turn';
  } else {
    state.assistantContent.push({ type: 'text', text: '' });
    state.stopReason = 'end_turn';
  }
}
