/** OpenAI-family adapter boundary. */
import {
  resolveOpenAiApplyPatchEnabled,
  withOpenAiApplyPatchInstructions,
  withOpenAiApplyPatchTool,
} from './openai-apply-patch.js';

function assistantReasoningContent(message) {
  if (typeof message?.reasoning_content === 'string' && message.reasoning_content.trim()) {
    return message.reasoning_content;
  }
  if (Array.isArray(message?.content)) {
    const text = message.content
      .filter((block) => block?.type === 'reasoning')
      .map((block) => (typeof block.text === 'string' ? block.text : ''))
      .join('');
    if (text.trim()) return text;
  }
  return '';
}

export function toOpenAIProviderTools(tools, opts = {}) {
  if (!Array.isArray(tools) || !tools.length) return undefined;
  const strict = opts.deepseekStrictTools === true;
  return tools.map((tool) => {
    if (tool.type === 'function') {
      return strict && tool.function
        ? { ...tool, function: { ...tool.function, strict: true } }
        : tool;
    }
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.input_schema || { type: 'object', properties: {} },
        ...(strict ? { strict: true } : {}),
      },
    };
  });
}

export function buildOpenAIMessages(systemPrompt, messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  const hasSystem = list.some((message) => message?.role === 'system');
  const normalized = [];
  if (systemPrompt && !hasSystem) normalized.push({ role: 'system', content: systemPrompt });

  for (const message of list) {
    if (message?.role === 'assistant' && typeof message.content === 'string') {
      const reasoning = assistantReasoningContent(message);
      normalized.push({
        role: 'assistant',
        content: message.content,
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(Array.isArray(message.tool_calls) && message.tool_calls.length
          ? { tool_calls: message.tool_calls }
          : {}),
      });
      continue;
    }
    if (message?.role === 'assistant' && Array.isArray(message.content)) {
      const text = message.content.filter((block) => block?.type === 'text').map((block) => block.text).join('');
      const toolCalls = message.content
        .filter((block) => block?.type === 'tool_use')
        .map((block) => ({
          id: block.id || `call_${crypto.randomUUID().slice(0, 8)}`,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
        }));
      const reasoning = assistantReasoningContent(message);
      normalized.push({
        role: 'assistant',
        content: text || null,
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }
    if (message?.role === 'user' && Array.isArray(message.content)) {
      const hasImage = message.content.some((block) => block?.type === 'image' && block?.source?.data);
      const hasToolResult = message.content.some((block) => block?.type === 'tool_result');
      if (hasImage && !hasToolResult) {
        const parts = message.content.flatMap((block) => {
          if (block?.type === 'text' && block.text) return [{ type: 'text', text: String(block.text) }];
          if (block?.type === 'image' && block.source?.data) {
            return [{ type: 'image_url', image_url: { url: `data:${block.source.media_type || 'image/png'};base64,${block.source.data}` } }];
          }
          return [];
        });
        if (parts.length) normalized.push({ role: 'user', content: parts });
        continue;
      }
      for (const block of message.content) {
        if (block?.type === 'tool_result') {
          normalized.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          });
        } else if (block?.type === 'text') {
          normalized.push({ role: 'user', content: block.text });
        }
      }
      continue;
    }
    normalized.push(message);
  }
  return normalized;
}

import { resolveProviderApiKey, providerBaseUrl } from './support/credentials.js';
import { jsonResponse } from '../../http/agentsam/shared.js';
import { openAiSseResponse } from '../runtime/provider-stream.js';

function openAiOptions(params) {
  return {
    ...(params.deepseekStrictTools === true ? { deepseekStrictTools: true } : {}),
    ...(params.deepseekBeta === true ? { deepseekBeta: true } : {}),
  };
}

function openAiModel(params) {
  return String(params.providerModelId || params.modelKey || '').trim();
}

function openAiTools(params) {
  return toOpenAIProviderTools(params.tools, {
    deepseekStrictTools: params.deepseekStrictTools === true,
  });
}

function openAiChatBody(params, stream) {
  const model = openAiModel(params);
  const tools = openAiTools(params);
  const responseFormat =
    params.responseFormat && typeof params.responseFormat === 'object'
      ? params.responseFormat
      : params.jsonSchema && typeof params.jsonSchema === 'object'
        ? { type: 'json_schema', json_schema: params.jsonSchema }
        : params.jsonMode === true
          ? { type: 'json_object' }
          : null;
  const body = {
    model,
    messages: buildOpenAIMessages(params.systemPrompt, params.messages || []),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    ...(tools?.length ? { tools, tool_choice: params.toolChoiceNone === true ? 'none' : params.forcedToolName ? { type: 'function', function: { name: params.forcedToolName } } : 'auto' } : {}),
    ...(params.maxOutputTokens > 0 ? { max_tokens: params.maxOutputTokens, max_completion_tokens: params.maxOutputTokens } : {}),
    ...(params.reasoningEffort ? { reasoning_effort: params.reasoningEffort } : {}),
    ...(params.verbosity ? { verbosity: params.verbosity } : {}),
    ...(responseFormat && (!tools?.length || params.forceJsonOutput === true) ? { response_format: responseFormat } : {}),
  };
  if (params.provider === 'deepseek' || params.apiPlatform === 'deepseek') {
    delete body.max_completion_tokens;
    delete body.reasoning_effort;
  }
  return body;
}

async function openAiFetch(env, params, path, body) {
  const provider = String(params.provider || params.apiPlatform || 'openai').toLowerCase();
  const apiKey = resolveProviderApiKey(env, provider, params.secretKeyName);
  if (!apiKey) {
    return { error: jsonResponse({ error: `${provider === 'deepseek' ? 'DeepSeek' : 'OpenAI'} API key not configured` }, 503) };
  }
  if (!openAiModel(params)) return { error: jsonResponse({ error: 'modelKey required' }, 400) };
  try {
    const response = await fetch(`${providerBaseUrl(provider, openAiOptions(params))}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    return { response };
  } catch (error) {
    return { error: jsonResponse({ error: 'OpenAI request failed', detail: error?.message || String(error) }, 502) };
  }
}

export async function dispatchOpenAIStream(env, request, params) {
  void request;
  const { response, error } = await openAiFetch(env, params, '/chat/completions', openAiChatBody(params, true));
  if (error) return error;
  if (!response.ok) return jsonResponse({ error: 'OpenAI API error', status: response.status, detail: (await response.text()).slice(0, 500) }, response.status);
  return openAiSseResponse(response.body);
}

function responsesInput(messages = [], previousResponseId = null) {
  const output = [];
  const previous = String(previousResponseId || '').trim();
  if (previous) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role !== 'user' || !Array.isArray(message.content)) continue;
      if (!message.content.some((block) => block?.type === 'tool_result')) continue;
      for (const block of message.content) {
        if (block?.type !== 'tool_result') continue;
        const callId = String(block.tool_use_id || block.call_id || '').trim();
        if (!callId) continue;
        if (block.apply_patch_call_output && typeof block.apply_patch_call_output === 'object') {
          const patch = block.apply_patch_call_output;
          output.push({
            type: 'apply_patch_call_output',
            call_id: callId,
            status: String(patch.status || 'failed') === 'completed' ? 'completed' : 'failed',
            ...(patch.output != null ? { output: String(patch.output) } : {}),
          });
          continue;
        }
        output.push({
          type: 'function_call_output',
          call_id: callId,
          output: typeof block.content === 'string' ? block.content : JSON.stringify(block.content || {}),
          ...(block.caller != null ? { caller: block.caller } : {}),
        });
      }
      return output;
    }
  }
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role === 'system') continue;
    if (message?.role === 'assistant' && (Array.isArray(message.tool_calls) || Array.isArray(message.content))) {
      const calls = Array.isArray(message.tool_calls)
        ? message.tool_calls
        : message.content.filter((block) => block?.type === 'tool_use').map((block) => ({
            id: block.id,
            function: { name: block.name, arguments: block.input || {} },
          }));
      for (const call of calls) {
        output.push({
          type: 'function_call',
          call_id: call.id || `call_${output.length}`,
          name: call.function?.name || 'unknown',
          arguments: typeof call.function?.arguments === 'string'
            ? call.function.arguments
            : JSON.stringify(call.function?.arguments || {}),
        });
      }
      const text = typeof message.content === 'string' ? message.content : '';
      if (text) output.push({ role: 'assistant', content: text });
      continue;
    }
    if (Array.isArray(message?.content)) {
      for (const block of message.content) {
        if (block?.type !== 'tool_result') continue;
        const callId = block.tool_use_id || block.call_id;
        if (callId) {
          output.push({
            type: 'function_call_output',
            call_id: String(callId),
            output: typeof block.content === 'string' ? block.content : JSON.stringify(block.content || {}),
          });
        }
      }
      const text = message.content.filter((block) => block?.type === 'text').map((block) => block.text || '').join('');
      if (text) output.push({ role: message.role, content: text });
      continue;
    }
    if (typeof message?.content === 'string' && message.content) {
      output.push({ role: message.role, content: message.content });
    }
  }
  return output;
}

export function buildOpenAIResponsesBody(params, stream) {
  const functionTools = openAiTools(params)?.map((tool) => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
  const tools = withOpenAiApplyPatchTool(functionTools, params.openaiApplyPatchEnabled === true);
  const instructions = withOpenAiApplyPatchInstructions(
    params.systemPrompt,
    params.openaiApplyPatchEnabled === true,
  );
  return {
    model: openAiModel(params),
    input: params.openaiResponsesReplayInput || responsesInput(params.messages, params.openaiPreviousResponseId),
    ...(instructions ? { instructions: String(instructions) } : {}),
    ...(stream ? { stream: true } : {}),
    ...(params.openaiPreviousResponseId ? { previous_response_id: params.openaiPreviousResponseId } : {}),
    ...(tools?.length ? {
      tools,
      tool_choice: params.toolChoiceNone === true
        ? 'none'
        : params.forcedToolName
          ? { type: 'function', name: String(params.forcedToolName) }
          : 'auto',
    } : {}),
    ...(params.maxOutputTokens > 0 ? { max_output_tokens: params.maxOutputTokens } : {}),
    ...(params.reasoningEffort ? { reasoning: { effort: params.reasoningEffort } } : {}),
  };
}

async function prepareOpenAiResponsesParams(env, params) {
  const openaiApplyPatchEnabled = await resolveOpenAiApplyPatchEnabled(env, params);
  return { ...params, openaiApplyPatchEnabled };
}

export async function dispatchOpenAIResponsesStream(env, request, params) {
  void request;
  const prepared = await prepareOpenAiResponsesParams(env, params);
  const { response, error } = await openAiFetch(env, prepared, '/responses', buildOpenAIResponsesBody(prepared, true));
  if (error) return error;
  if (!response.ok) return jsonResponse({ error: 'OpenAI Responses API error', status: response.status, detail: (await response.text()).slice(0, 500) }, response.status);
  return openAiSseResponse(response.body, { 'X-IAM-OpenAI-Transport': 'http' });
}

export async function dispatchOpenAIComplete(env, params) {
  const { response, error } = await openAiFetch(env, params, '/chat/completions', openAiChatBody(params, false));
  if (error) throw new Error(`OpenAI completion unavailable: ${error.status}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OpenAI error ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  return data;
}

export async function dispatchOpenAIResponsesComplete(env, params) {
  const prepared = await prepareOpenAiResponsesParams(env, params);
  const { response, error } = await openAiFetch(env, prepared, '/responses', buildOpenAIResponsesBody(prepared, false));
  if (error) throw new Error(`OpenAI Responses completion unavailable: ${error.status}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OpenAI Responses error ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  const text = typeof data.output_text === 'string' ? data.output_text : '';
  return { ...data, text, output_text: data.output_text ?? text, choices: [{ message: { content: text } }] };
}

export function chatWithOpenAIProviderResponsesWs(env, request, params) {
  return dispatchOpenAIResponsesStream(env, request, params);
}

export {
  dispatchOpenAIStream as chatWithToolsOpenAI,
  dispatchOpenAIResponsesStream as chatWithToolsOpenAIResponses,
  dispatchOpenAIComplete as completeWithOpenAI,
  dispatchOpenAIResponsesComplete as completeWithOpenAIResponsesNonStream,
  toOpenAIProviderTools as toOpenAITools,
  chatWithOpenAIProviderResponsesWs as chatWithToolsOpenAIResponsesWs,
};
