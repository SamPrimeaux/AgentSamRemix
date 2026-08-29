/** Anthropic Messages provider adapter. */
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

export function normalizeAnthropicEffort(raw) {
  const value = raw == null ? '' : String(raw).trim().toLowerCase();
  if (!value || ['none', 'off', 'disabled'].includes(value)) return null;
  if (EFFORTS.has(value)) return value;
  if (value === 'minimal') return 'low';
  if (value === 'maximal' || value === 'maximum') return 'max';
  return null;
}

import { resolveProviderApiKey } from './support/credentials.js';
import { jsonResponse } from '../../http/agentsam/shared.js';
import { openAiSseResponse, openAiSseFrame } from '../runtime/provider-stream.js';

function anthropicTools(tools) {
  return (Array.isArray(tools) ? tools : []).map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    input_schema: tool.input_schema || tool.parameters || { type: 'object', properties: {} },
  }));
}

function anthropicBody(params, stream) {
  const options = params.options && typeof params.options === 'object' ? params.options : {};
  return {
    model: params.providerModelId || params.modelKey,
    max_tokens: Number(params.maxOutputTokens) > 0 ? Number(params.maxOutputTokens) : 4096,
    system: params.systemPrompt || undefined,
    messages: (params.messages || []).filter((message) => message?.role !== 'system'),
    ...(anthropicTools(params.tools).length ? { tools: anthropicTools(params.tools) } : {}),
    ...(params.toolChoiceNone === true ? { tool_choice: { type: 'none' } } : {}),
    ...(params.forcedToolName ? { tool_choice: { type: 'tool', name: String(params.forcedToolName) } } : {}),
    ...(params.reasoningEffort ? { output_config: { effort: normalizeAnthropicEffort(params.reasoningEffort) } } : {}),
    ...(stream ? { stream: true } : { stream: false }),
    ...(options.promptCaching === true ? { cache_control: { type: 'ephemeral' } } : {}),
  };
}

function anthropicEventToOpenAi(event, state) {
  const type = String(event?.type || '').toLowerCase();
  if (type === 'content_block_start' && event.content_block?.type === 'tool_use') {
    const block = event.content_block;
    state.toolIds[event.index ?? 0] = block.id || `anthropic_call_${event.index ?? 0}`;
    state.toolNames[event.index ?? 0] = block.name || 'unknown';
    return {
      choices: [{ index: 0, delta: { tool_calls: [{ index: event.index ?? 0, id: state.toolIds[event.index ?? 0], type: 'function', function: { name: state.toolNames[event.index ?? 0], arguments: '' } }] }, finish_reason: null }],
    };
  }
  if (type === 'content_block_delta') {
    if (typeof event.delta?.text === 'string') return { choices: [{ index: 0, delta: { content: event.delta.text }, finish_reason: null }] };
    if (typeof event.delta?.partial_json === 'string') {
      const index = event.index ?? 0;
      return {
        choices: [{ index: 0, delta: { tool_calls: [{ index, id: state.toolIds[index] || `anthropic_call_${index}`, type: 'function', function: { name: state.toolNames[index] || 'unknown', arguments: event.delta.partial_json } }] }, finish_reason: null }],
      };
    }
  }
  if (type === 'message_delta' && event.delta?.stop_reason) {
    return { choices: [{ index: 0, delta: {}, finish_reason: event.delta.stop_reason === 'tool_use' ? 'tool_calls' : 'stop' }] };
  }
  if (event?.usage && typeof event.usage === 'object') {
    return {
      usage: {
        prompt_tokens: Number(event.usage.input_tokens) || 0,
        completion_tokens: Number(event.usage.output_tokens) || 0,
        total_tokens: (Number(event.usage.input_tokens) || 0) + (Number(event.usage.output_tokens) || 0),
      },
      choices: [{ index: 0, delta: {}, finish_reason: null }],
    };
  }
  return null;
}

export async function dispatchAnthropicStream(env, request, params) {
  void request;
  const apiKey = resolveProviderApiKey(env, 'anthropic', params.secretKeyName);
  if (!apiKey) return jsonResponse({ error: 'Anthropic API key not configured' }, 503);
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(anthropicBody(params, true)),
      ...(params.signal ? { signal: params.signal } : {}),
    });
  } catch (error) {
    return jsonResponse({ error: 'Anthropic request failed', detail: error?.message || String(error) }, 502);
  }
  if (!response.ok) return jsonResponse({ error: 'Anthropic API error', status: response.status, detail: (await response.text()).slice(0, 500) }, response.status);
  if (!response.body) return jsonResponse({ error: 'Anthropic stream body missing' }, 502);

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  const state = { toolIds: {}, toolNames: {} };
  const readable = new ReadableStream({
    async start(controller) {
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            try {
              const frame = anthropicEventToOpenAi(JSON.parse(line.slice(5).trim()), state);
              if (frame) controller.enqueue(encoder.encode(openAiSseFrame(frame)));
            } catch {
              // Ignore malformed provider frames.
            }
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return openAiSseResponse(readable);
}

export async function dispatchAnthropicComplete(env, params) {
  const apiKey = resolveProviderApiKey(env, 'anthropic', params.secretKeyName);
  if (!apiKey) throw new Error('Anthropic API key not configured');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify(anthropicBody(params, false)),
    ...(params.signal ? { signal: params.signal } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Anthropic error ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  return data;
}
