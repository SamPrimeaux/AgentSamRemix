/** Ollama provider adapter. */
import { jsonResponse } from '../../http/agentsam/shared.js';
import {
  normalizeOllamaChunk,
  pipeJsonStreamToOpenAiSse,
  openAiSseResponse,
} from '../runtime/provider-stream.js';
import { buildOpenAIMessages, toOpenAITools } from './openai.js';

export const OLLAMA_SKIP_MESSAGE = 'ollama_skip';

export async function dispatchOllamaStream(env, request, params) {
  void request;
  const base =
    (env?.OLLAMA_BASE_URL && String(env.OLLAMA_BASE_URL).trim()) ||
    (env?.OLLAMA_TUNNEL_URL && String(env.OLLAMA_TUNNEL_URL).trim()) ||
    'https://ollama.inneranimalmedia.com';
  const model = params.providerModelId || params.modelKey;
  const messages = buildOpenAIMessages(params.systemPrompt, params.messages || []);
  try {
    const upstream = await fetch(`${base.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.OLLAMA_CF_CLIENT_ID && env.OLLAMA_CF_CLIENT_SECRET
          ? {
              'CF-Access-Client-Id': env.OLLAMA_CF_CLIENT_ID,
              'CF-Access-Client-Secret': env.OLLAMA_CF_CLIENT_SECRET,
            }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        keep_alive: '10m',
        ...(Array.isArray(params.tools) && params.tools.length ? { tools: toOpenAITools(params.tools) } : {}),
      }),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    if (!upstream.ok) {
      if (upstream.status === 403) throw new Error(OLLAMA_SKIP_MESSAGE);
      return jsonResponse({ error: `Ollama upstream error ${upstream.status}` }, 502);
    }
    if (!upstream.body) return jsonResponse({ error: 'Ollama stream body missing' }, 502);
    return openAiSseResponse(pipeJsonStreamToOpenAiSse(upstream.body, normalizeOllamaChunk));
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    // The chain recognizes this sentinel and advances without emitting a bad
    // generic SSE error to the user.
    throw new Error(OLLAMA_SKIP_MESSAGE);
  }
}

export function dispatchOllamaComplete() {
  throw new Error('Unsupported completion: Ollama is stream-only in the current adapter contract');
}
