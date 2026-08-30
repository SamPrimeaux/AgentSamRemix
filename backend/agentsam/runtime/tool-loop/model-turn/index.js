/**
 * One provider stream turn: dispatchStream → consume → tool_calls | text.
 * No force-first / catalog preinvoke — model proposes within the upstream mode menu.
 */
import { dispatchModelStream } from './dispatch.js';
import { consumeResponseTransport } from './openai.js';
import { consumeAnthropicStream } from './anthropic.js';
import { consumeWorkersAiText } from './workers-ai.js';
import {
  compactConsumedContext,
  compactGeminiReplay,
  consumeSseText,
} from './stream.js';
import {
  createStreamTurnUsage,
  decisionTurnUsage,
  snapshotTurnUsage,
  updateBudgetProgressAndMaybeHandoff,
} from './usage.js';

/**
 * @param {Record<string, any>} L shared loop bag
 */
export async function runAgentModelTurn(L) {
  const usageAtTurnStart = snapshotTurnUsage(L.totalUsage);
  const mutable = {
    activeTools: L.activeTools,
    forceTextOnlyAfterRepeatHalt: L.forceTextOnlyAfterRepeatHalt,
    openaiPreviousResponseId: L.openaiPreviousResponseId,
    openaiPtcActive: L.openaiPtcActive,
    openaiResponsesAccumulatedInput: L.openaiResponsesAccumulatedInput,
  };

  const dispatched = await dispatchModelStream(L, mutable);
  if (dispatched && Object.hasOwn(dispatched, 'earlyReturn')) return dispatched;
  const { stream, isWorkersAiStream } = dispatched;

  const state = {
    pendingToolCalls: [],
    pendingApplyPatchCalls: [],
    turnHostedShellEvents: [],
    stopReason: null,
    turnUsage: null,
    containerId: null,
    assistantContent: [],
    assistantReasoningContent: '',
    turnGeminiModelParts: null,
    openaiPreviousResponseId: mutable.openaiPreviousResponseId,
    openaiPtcActive: mutable.openaiPtcActive,
    openaiResponsesAccumulatedInput:
      mutable.openaiResponsesAccumulatedInput,
    openaiNeedsContinuation: false,
  };
  const streamUsage = createStreamTurnUsage(L.totalUsage);

  if (stream instanceof Response) {
    await consumeResponseTransport(stream, L, state, streamUsage);
  } else if (
    stream &&
    typeof stream[Symbol.asyncIterator] === 'function' &&
    !(stream instanceof ReadableStream)
  ) {
    const anthropicResult = await consumeAnthropicStream(
      stream,
      L,
      state,
      mutable,
    );
    if (
      anthropicResult &&
      Object.hasOwn(anthropicResult, 'earlyReturn')
    ) {
      return anthropicResult;
    }
  } else if (stream && typeof stream.getReader === 'function') {
    state.assistantContent.push({ type: 'text', text: '' });
    if (isWorkersAiStream) {
      await consumeWorkersAiText(stream, {
        assistantContent: state.assistantContent,
        emit: L.emit,
        abortScope: L.abortScope,
        usage: streamUsage,
      });
    } else {
      await consumeSseText(stream, {
        assistantContent: state.assistantContent,
        emit: L.emit,
        abortScope: L.abortScope,
        usage: streamUsage,
      });
    }
    state.stopReason = 'end_turn';
  } else if (stream != null) {
    const constructorName = stream.constructor
      ? stream.constructor.name
      : typeof stream;
    console.warn(
      '[agent] stream not iterable/reader/Response:',
      constructorName,
      Object.prototype.toString.call(stream),
    );
  }

  const toolResultCompaction = compactConsumedContext(L.conversationMessages);
  if (toolResultCompaction.compactedBlocks > 0) {
    console.info(
      '[agent] consumed_tool_results_compacted',
      JSON.stringify({
        blocks: toolResultCompaction.compactedBlocks,
        removed_chars: toolResultCompaction.removedChars,
        turn: L.turnCount,
        persist: false,
      }),
    );
  }

  L.conversationMessages.push({
    role: 'assistant',
    content: state.assistantContent,
    ...(state.assistantReasoningContent
      ? { reasoning_content: state.assistantReasoningContent }
      : {}),
    ...(Array.isArray(state.turnGeminiModelParts) &&
    state.turnGeminiModelParts.length
      ? { gemini_model_parts: state.turnGeminiModelParts }
      : {}),
  });
  compactGeminiReplay(L.conversationMessages);

  if (await L.shouldStopRun()) {
    return { earlyReturn: L.exitCancelled() };
  }

  const handoffResult = await updateBudgetProgressAndMaybeHandoff(
    L,
    usageAtTurnStart,
  );
  if (handoffResult) return { earlyReturn: handoffResult };

  const clientToolCalls = state.pendingToolCalls.filter(
    (call) => !call._server,
  );
  L.openaiPreviousResponseId = state.openaiPreviousResponseId;
  L.openaiPtcActive = state.openaiPtcActive;
  L.openaiResponsesAccumulatedInput =
    state.openaiResponsesAccumulatedInput;
  L.forceTextOnlyAfterRepeatHalt = mutable.forceTextOnlyAfterRepeatHalt;

  return {
    pendingToolCalls: state.pendingToolCalls,
    pendingApplyPatchCalls: state.pendingApplyPatchCalls,
    turnHostedShellEvents: state.turnHostedShellEvents,
    assistantContent: state.assistantContent,
    assistantReasoningContent: state.assistantReasoningContent,
    clientToolCalls,
    stopReason: state.stopReason,
    openaiNeedsContinuation: state.openaiNeedsContinuation === true,
    decisionTurnUsage: decisionTurnUsage(L.totalUsage, usageAtTurnStart),
  };
}
