/** Google Gemini API provider adapter. */
import { resolveProviderApiKey } from './support/credentials.js';
import { jsonResponse } from '../../http/agentsam/shared.js';
import { openAiSseFrame, openAiSseResponse } from '../runtime/provider-stream.js';

export function normalizeGeminiProviderModelId(value) {
  return String(value || '').trim().replace(/^models\//, '');
}

export function buildGeminiProviderUrl(modelId, apiKey, { stream = false } = {}) {
  const query = new URLSearchParams({ key: apiKey });
  if (stream) query.set('alt', 'sse');
  return `https://generativelanguage.googleapis.com/v1beta/models/${normalizeGeminiProviderModelId(modelId)}:${stream ? 'streamGenerateContent' : 'generateContent'}?${query}`;
}

function contents(messages = []) {
  return messages.filter((message) => message?.role !== 'system').map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: typeof message.content === 'string'
      ? [{ text: message.content }]
      : (Array.isArray(message.content) ? message.content.map((block) => {
          if (block?.type === 'text') return { text: String(block.text || '') };
          if (block?.type === 'tool_use') return { functionCall: { name: block.name, args: block.input || {} } };
          if (block?.type === 'tool_result') return { functionResponse: { name: block.name || 'tool', response: block.content || {} } };
          if (block?.type === 'image' && block.source?.data) return { inlineData: { mimeType: block.source.media_type || 'image/png', data: block.source.data } };
          return null;
        }).filter(Boolean) : []),
  })).filter((message) => message.parts.length);
}

function tools(toolDefinitions) {
  const declarations = (Array.isArray(toolDefinitions) ? toolDefinitions : []).map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    parameters: tool.input_schema || tool.parameters || { type: 'object', properties: {} },
  }));
  return declarations.length ? [{ function_declarations: declarations }] : undefined;
}

function generationConfig(params) {
  return {
    maxOutputTokens: Number(params.maxOutputTokens) > 0 ? Number(params.maxOutputTokens) : 2048,
    ...(params.temperature != null ? { temperature: Number(params.temperature) } : {}),
  };
}

function normalizeGeminiChunk(value) {
  const candidate = value?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const frames = [];
  const text = parts.filter((part) => part?.text && !part.thought).map((part) => part.text).join('');
  if (text) frames.push({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
  parts.filter((part) => part?.functionCall).forEach((part, index) => {
    const call = part.functionCall;
    frames.push({
      choices: [{ index: 0, delta: { tool_calls: [{ index, id: call.id || `gemini_call_${index}`, type: 'function', function: { name: call.name || 'unknown', arguments: JSON.stringify(call.args || {}) } }] }, finish_reason: null }],
    });
  });
  if (value?.usageMetadata) {
    const input = Number(value.usageMetadata.promptTokenCount) || 0;
    const output = Number(value.usageMetadata.candidatesTokenCount) || 0;
    frames.push({ usage: { prompt_tokens: input, completion_tokens: output, total_tokens: Number(value.usageMetadata.totalTokenCount) || input + output }, choices: [{ index: 0, delta: {}, finish_reason: null }] });
  }
  return frames;
}

async function geminiRequest(env, params, stream) {
  const apiKey = resolveProviderApiKey(env, 'google', params.secretKeyName)
    || env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY;
  if (!apiKey) return { error: jsonResponse({ error: 'Google AI API key not configured' }, 503) };
  const model = normalizeGeminiProviderModelId(params.providerModelId || params.modelKey);
  const body = {
    contents: contents(params.messages || []),
    ...(params.systemPrompt ? { systemInstruction: { parts: [{ text: params.systemPrompt }] } } : {}),
    ...(tools(params.tools) ? { tools: tools(params.tools) } : {}),
    generationConfig: generationConfig(params),
  };
  try {
    const response = await fetch(buildGeminiProviderUrl(model, apiKey, { stream }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    return { response };
  } catch (error) {
    return { error: jsonResponse({ error: 'Gemini request failed', detail: error?.message || String(error) }, 502) };
  }
}

export async function dispatchGeminiStream(env, request, params) {
  void request;
  const { response, error } = await geminiRequest(env, params, true);
  if (error) return error;
  if (!response.ok) return jsonResponse({ error: `Gemini ${response.status}`, detail: (await response.text()).slice(0, 500) }, response.status);
  if (!response.body) return jsonResponse({ error: 'Gemini stream body missing' }, 502);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
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
            if (!line.trim().startsWith('data:')) continue;
            try {
              for (const frame of normalizeGeminiChunk(JSON.parse(line.slice(5).trim()))) {
                controller.enqueue(encoder.encode(openAiSseFrame(frame)));
              }
            } catch {
              // Ignore incomplete provider frames.
            }
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return openAiSseResponse(readable);
}

export async function dispatchGeminiComplete(env, params) {
  const { response, error } = await geminiRequest(env, params, false);
  if (error) throw new Error(`Gemini completion unavailable: ${error.status}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  const text = data?.candidates?.[0]?.content?.parts?.filter((part) => part?.text && !part.thought).map((part) => part.text).join('') || '';
  return { ...data, text, output_text: text, usage: data.usageMetadata || null };
}

export {
  dispatchGeminiStream as chatWithToolsGemini,
  dispatchGeminiComplete as completeWithGemini,
};
