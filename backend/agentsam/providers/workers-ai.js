/**
 * Cloudflare Workers AI adapter.
 *
 * Workers AI models expose a mixture of OpenAI-compatible objects, text
 * frames, and NDJSON. This adapter normalizes all of them before they reach
 * the provider-neutral tool-loop consumer.
 */
import { buildOpenAIMessages, toOpenAITools } from './openai.js';
import { jsonResponse } from '../../http/agentsam/shared.js';
import { dispatchOpenAIStream } from './openai.js';
import { resolveModelMeta } from '../catalog/runtime-model-meta.js';
import { pickCatalogFallback } from '../runtime/routing/model-selection.js';

export const OLLAMA_SKIP_MESSAGE = 'ollama_skip';

export function buildWorkersAiPayload(messages, arm, opts = {}) {
  const maxTokens = opts.maxTokens ?? 2048;
  const tools = toOpenAITools(Array.isArray(opts.tools) ? opts.tools.filter(Boolean) : []);
  const modelHint = String(opts.modelKey || opts.providerModelId || '').toLowerCase();
  const kimi = modelHint.includes('kimi');
  let effort = arm?.reasoning_effort != null ? String(arm.reasoning_effort).trim() : '';
  if (!effort && kimi) effort = 'none';

  const toolChoice =
    opts.toolChoiceNone === true
      ? 'none'
      : opts.forcedToolName
        ? { type: 'function', function: { name: String(opts.forcedToolName).trim() } }
        : 'auto';
  const payload = {
    messages,
    max_tokens: maxTokens,
    max_completion_tokens: maxTokens,
    ...(opts.stream != null ? { stream: opts.stream } : {}),
    ...(tools?.length ? { tools, tool_choice: toolChoice } : {}),
  };
  if (effort) payload.reasoning_effort = effort;
  if (effort === 'none' && kimi && !tools?.length) {
    payload.response_format = { type: 'json_object' };
  }
  return payload;
}

function stripWorkersAiMarkers(value) {
  return String(value ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```$/m, '');
}

function extractContent(value) {
  const message = value?.choices?.[0]?.message ?? value?.choices?.[0]?.delta;
  if (typeof message?.content === 'string') return message.content;
  if (typeof message?.reasoning_content === 'string') return message.reasoning_content;
  if (typeof value?.response === 'string') return value.response;
  return '';
}

export function normalizeWorkersAiSseChunk(value) {
  if (!value || typeof value !== 'object') return null;
  const usage =
    value.usage && typeof value.usage === 'object'
      ? value.usage
      : value.usageMetadata && typeof value.usageMetadata === 'object'
        ? {
            prompt_tokens: Number(value.usageMetadata.promptTokenCount ?? value.usageMetadata.prompt_tokens) || 0,
            completion_tokens: Number(value.usageMetadata.candidatesTokenCount ?? value.usageMetadata.completion_tokens ?? value.usageMetadata.output_tokens) || 0,
            total_tokens: Number(value.usageMetadata.totalTokenCount ?? value.usageMetadata.total_tokens) || 0,
          }
        : null;

  if (Array.isArray(value.choices) && value.choices.length) {
    const choices = value.choices.map((choice) => ({ ...choice }));
    const first = choices[0];
    if (first?.delta && typeof first.delta === 'object') {
      first.delta = {
        ...first.delta,
        ...(typeof first.delta.content === 'string'
          ? { content: stripWorkersAiMarkers(first.delta.content) }
          : {}),
        ...(typeof first.delta.reasoning_content === 'string'
          ? { reasoning_content: stripWorkersAiMarkers(first.delta.reasoning_content) }
          : {}),
      };
    } else if (first?.message && typeof first.message === 'object') {
      first.delta = { ...first.message };
      delete first.message;
    }
    return { ...value, ...(usage && !value.usage ? { usage } : {}), choices };
  }

  const content = stripWorkersAiMarkers(extractContent(value));
  if (!content && !usage) return null;
  return {
    ...(usage ? { usage } : {}),
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: usage ? 'stop' : null }],
  };
}

async function routingArm(env, params) {
  const id = params.routingArmId ?? params.routing_arm_id;
  if (!env?.DB || !id) return {};
  return env.DB.prepare(
    'SELECT reasoning_effort FROM agentsam_routing_arms WHERE id = ? LIMIT 1',
  ).bind(String(id).trim()).first().catch(() => ({}));
}

async function openAiFallback(env, request, params, detail) {
  const modelKey = await pickCatalogFallback(env?.DB, { provider: 'openai' })
    || await pickCatalogFallback(env?.DB);
  if (!modelKey) {
    return jsonResponse(
      { error: 'Workers AI failed and no chat-capable fallback is configured', detail },
      503,
    );
  }
  const meta = await resolveModelMeta(env, modelKey);
  return dispatchOpenAIStream(env, request, {
    ...params,
    modelKey,
    providerModelId: meta?.provider_model_id ?? null,
    provider: meta?.provider ?? 'openai',
    apiPlatform: meta?.api_platform ?? 'openai_chat_completions',
    secretKeyName: meta?.secret_key_name ?? null,
  });
}

export async function dispatchWorkersAI(env, request, params) {
  const model = params.providerModelId || params.modelKey;
  if (!model) return jsonResponse({ error: 'modelKey required' }, 400);
  if (params.signal?.aborted) {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    throw error;
  }

  const pinned =
    String(params.modelKey || '').trim().toLowerCase() !== 'auto' &&
    !params.routingArmId && !params.routing_arm_id;
  const fallback = (error) => {
    const detail = String(error?.message || error || 'workers_ai_failed');
    if (pinned) return jsonResponse({ error: 'Workers AI model failed', model: params.modelKey, detail }, 502);
    return openAiFallback(env, request, params, detail);
  };
  if (!env?.AI || typeof env.AI.run !== 'function') return fallback('AI binding not available');

  const messages = buildOpenAIMessages(params.systemPrompt, params.messages || []);
  const arm = await routingArm(env, params);
  let response;
  try {
    response = await env.AI.run(model, buildWorkersAiPayload(messages, arm, {
      maxTokens: params.maxOutputTokens ?? 2048,
      stream: true,
      modelKey: params.modelKey,
      providerModelId: params.providerModelId,
      tools: params.tools,
      forcedToolName: params.forcedToolName,
      toolChoiceNone: params.toolChoiceNone === true || params.tool_choice_none === true,
    }));
  } catch (error) {
    return fallback(error);
  }

  const encoder = new TextEncoder();
  const source =
    response instanceof ReadableStream
      ? response
      : new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(JSON.stringify(response)));
            controller.close();
          },
        });
  const reader = source.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const readable = new ReadableStream({
    async pull(controller) {
      while (true) {
        const newline = buffer.indexOf('\n');
        if (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line || line === 'data: [DONE]' || line === '[DONE]') continue;
          try {
            const jsonText = line.startsWith('data:') ? line.slice(5).trim() : line;
            const normalized = normalizeWorkersAiSseChunk(JSON.parse(jsonText));
            if (normalized) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(normalized)}\n\n`));
              return;
            }
          } catch {
            if (line && !line.startsWith('event:')) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                choices: [{ index: 0, delta: { content: line } }],
              })}\n\n`));
              return;
            }
          }
          continue;
        }
        const { done, value } = await reader.read();
        if (done) {
          const tail = buffer.trim();
          buffer = '';
          if (tail) {
            try {
              const normalized = normalizeWorkersAiSseChunk(JSON.parse(tail.replace(/^data:\s*/, '')));
              if (normalized) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(normalized)}\n\n`));
                return;
              }
            } catch {
              // Ignore malformed tail.
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function dispatchWorkersAIComplete(env, params) {
  const model = params.providerModelId || params.modelKey;
  if (!model) throw new Error('modelKey required');
  if (!env?.AI || typeof env.AI.run !== 'function') {
    throw new Error('Workers AI binding not available');
  }
  const messages = buildOpenAIMessages(params.systemPrompt, params.messages || []);
  const arm = await routingArm(env, params);
  const response = await env.AI.run(model, buildWorkersAiPayload(messages, arm, {
    maxTokens: params.maxOutputTokens ?? 2048,
    stream: false,
    modelKey: params.modelKey,
    providerModelId: params.providerModelId,
    tools: params.tools,
    forcedToolName: params.forcedToolName,
    toolChoiceNone: params.toolChoiceNone === true || params.tool_choice_none === true,
  }));
  const normalized = normalizeWorkersAiSseChunk(response);
  const message = normalized?.choices?.[0]?.delta || response?.choices?.[0]?.message || {};
  const text = typeof message.content === 'string' ? message.content : '';
  return {
    ...(response && typeof response === 'object' ? response : {}),
    text,
    output_text: text,
    choices: [{ message: { content: text, ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) } }],
  };
}
