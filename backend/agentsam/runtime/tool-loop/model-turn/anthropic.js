import { dispatchStream } from '../../provider-dispatch.js';
import {
  aggregateAnthropicUsageTokens,
  extractCompactionFromAnthropicUsage,
  scheduleCompactionFromAnthropicUsage,
} from '../../../../../src/core/agent-costs.js';
import { safeJsonParse } from '../../../../../src/core/tool-arguments-json.js';

function handleAnthropicChunk(chunk, L, state) {
  if (chunk.type === 'message_start') {
    if (chunk.message?.id) L.emit('id', { id: chunk.message.id });
    if (chunk.message?.container?.id) {
      state.containerId = chunk.message.container.id;
    }
  }
  if (chunk.type === 'message_stop' && chunk.message?.container?.id) {
    state.containerId = chunk.message.container.id;
  }
  if (chunk.type === 'content_block_start') {
    if (chunk.content_block?.type === 'thinking') L.emit('thinking_start', {});
    if (chunk.content_block?.type === 'compaction') {
      state.assistantContent.push({ ...chunk.content_block });
      L.emit('compaction', { phase: 'block_start' });
    }
    if (chunk.content_block?.type === 'tool_use') {
      state.pendingToolCalls.push({
        id: chunk.content_block.id,
        name: chunk.content_block.name,
        _args: '',
        _server: false,
      });
      state.assistantContent.push({
        type: 'tool_use',
        id: chunk.content_block.id,
        name: chunk.content_block.name,
        input: {},
      });
    }
    if (chunk.content_block?.type === 'server_tool_use') {
      state.pendingToolCalls.push({
        id: chunk.content_block.id,
        name: chunk.content_block.name,
        _args: '',
        _server: true,
      });
      state.assistantContent.push({
        type: 'server_tool_use',
        id: chunk.content_block.id,
        name: chunk.content_block.name,
        input: {},
      });
    }
    const passthroughResults = new Set([
      'tool_search_tool_result',
      'code_execution_tool_result',
      'bash_code_execution_tool_result',
      'text_editor_code_execution_tool_result',
    ]);
    if (
      chunk.content_block &&
      passthroughResults.has(chunk.content_block.type)
    ) {
      state.assistantContent.push({ ...chunk.content_block });
    }
    if (chunk.content_block?.type === 'text') {
      state.assistantContent.push({ type: 'text', text: '' });
    }
  }
  if (chunk.type === 'content_block_delta') {
    const delta = chunk.delta;
    if (delta.type === 'text_delta') {
      const last = state.assistantContent.findLast(
        (block) => block.type === 'text',
      );
      if (last) last.text += delta.text;
      L.emit('text', { text: delta.text });
    }
    if (delta.type === 'thinking_delta') {
      L.emit('thinking', { text: delta.thinking });
    }
    if (delta.type === 'input_json_delta') {
      const call = state.pendingToolCalls.findLast((item) => !item._done);
      if (call) call._args += delta.partial_json;
    }
    if (delta.type === 'signature_delta') {
      L.emit('signature', { signature: delta.signature });
    }
  }
  if (chunk.type === 'content_block_stop') {
    const call = state.pendingToolCalls.findLast((item) => !item._done);
    if (call) {
      call._done = true;
      try {
        call.input = safeJsonParse(call._args || '{}');
      } catch {
        call.input = {};
      }
      const block = state.assistantContent.find(
        (item) =>
          (item.type === 'tool_use' || item.type === 'server_tool_use') &&
          item.id === call.id,
      );
      if (block) block.input = call.input;
    }
  }
  if (chunk.type === 'message_delta') {
    if (chunk.usage) state.turnUsage = chunk.usage;
    if (chunk.delta?.stop_reason) state.stopReason = chunk.delta.stop_reason;
    if (chunk.delta?.container?.id) {
      state.containerId = chunk.delta.container.id;
    }
  }
}

function mergeTurnUsage(L, state, compactionMeta) {
  if (!state.turnUsage) return;
  const usage = aggregateAnthropicUsageTokens(state.turnUsage);
  L.totalUsage.input_tokens += usage.input_tokens;
  L.totalUsage.output_tokens += usage.output_tokens;
  L.totalUsage.cache_read_input_tokens += usage.cache_read_input_tokens;
  L.totalUsage.cache_creation_input_tokens +=
    usage.cache_creation_input_tokens;
  if (
    scheduleCompactionFromAnthropicUsage(
      L.env,
      L.ctx,
      state.turnUsage,
      compactionMeta,
    )
  ) {
    const compacted = extractCompactionFromAnthropicUsage(state.turnUsage);
    L.emit('compaction', {
      phase: 'recorded',
      tokens_before: compacted?.tokens_before ?? null,
      tokens_after: compacted?.tokens_after ?? null,
    });
  }
  state.turnUsage = null;
}

async function drainAnthropicStream(stream, L, state, compactionMeta) {
  state.stopReason = null;
  state.turnUsage = null;
  for await (const chunk of stream) {
    await L.abortScope.throwIfAborted();
    handleAnthropicChunk(chunk, L, state);
  }
  mergeTurnUsage(L, state, compactionMeta);
}

export async function consumeAnthropicStream(stream, L, state, mutable) {
  const compactionMeta = {
    tenantId: L.tenantId,
    workspaceId: L.workspaceId,
    userId: L.userId,
    sessionId: L.sessionId,
    modelKey: L.modelKey,
    provider: 'anthropic',
  };
  await drainAnthropicStream(stream, L, state, compactionMeta);

  const PAUSE_TURN_MAX = 8;
  let pauseIterations = 0;
  while (
    state.stopReason === 'pause_turn' &&
    state.containerId &&
    pauseIterations < PAUSE_TURN_MAX
  ) {
    if (await L.shouldStopRun()) {
      return { earlyReturn: L.exitCancelled() };
    }
    pauseIterations += 1;
    console.log(
      `[agent] pause_turn continuation ${pauseIterations} container=${state.containerId}`,
    );
    L.emit('pause_turn', {
      container_id: state.containerId,
      iteration: pauseIterations,
    });
    let continueMessages;
    try {
      continueMessages = [
        ...L.conversationMessages,
        {
          role: 'assistant',
          content: JSON.parse(JSON.stringify(state.assistantContent)),
        },
      ];
    } catch {
      continueMessages = [
        ...L.conversationMessages,
        { role: 'assistant', content: state.assistantContent },
      ];
    }
    state.pendingToolCalls.length = 0;
    let nextStream;
    try {
      nextStream = await dispatchStream(L.env, L.request, {
        modelKey: L.modelKey,
        systemPrompt: L.systemPrompt,
        messages: continueMessages,
        tools: mutable.activeTools,
        reasoningEffort:
          L.dispatchSpineParam?.routing_decision?.reasoning_effort ?? null,
        temperature: L.temperature,
        userId: L.userId,
        tenantId: L.tenantId,
        workspaceId: L.routingWs || null,
        agentRunId: L.chatAgentRunId ?? null,
        routingArmId: L.routingArmIdParam ?? null,
        ...(L.routingTaskType ? { taskType: L.routingTaskType } : {}),
        mode: L.mode || 'agent',
        lane:
          L.dispatchSpineParam?.routing_decision?.lane ??
          (['debug', 'plan'].includes(String(L.mode || '').toLowerCase())
            ? 'premium'
            : null),
        signal: L.abortScope.signal,
        anthropicContainerId: state.containerId,
        promptAuditContext:
          L.promptAuditContextParam &&
          typeof L.promptAuditContextParam === 'object'
            ? {
                ...L.promptAuditContextParam,
                loop_turn: L.turnCount,
                pause_turn_continuation: true,
              }
            : L.promptAuditContextParam,
      });
    } catch (error) {
      console.warn(
        '[agent] pause_turn continuation request failed:',
        error?.message ?? error,
      );
      break;
    }
    if (!nextStream || typeof nextStream[Symbol.asyncIterator] !== 'function') {
      console.warn(
        '[agent] pause_turn: continuation stream is not async-iterable',
      );
      break;
    }
    await drainAnthropicStream(nextStream, L, state, compactionMeta);
  }
  if (
    pauseIterations >= PAUSE_TURN_MAX &&
    state.stopReason === 'pause_turn'
  ) {
    console.warn('[agent] pause_turn max iterations reached, forcing end_turn');
    state.stopReason = 'end_turn';
  }
  return null;
}
