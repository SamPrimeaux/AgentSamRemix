/**
 * OpenAI Responses API — WebSocket transport (Phase 1).
 * DO-held socket → SSE ReadableStream compatible with consumeOpenAIResponsesSse.
 * On any WS failure, callers should fall back to HTTP chatWithToolsOpenAIResponses.
 */
import { chatWithToolsOpenAIResponses, buildOpenAIResponsesRequestParts } from './openai.js';
import { jsonResponse } from '../core/responses.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

const WS_FALLBACK_RE =
  /previous_response_not_found|websocket_connection_limit_reached|openai_ws_(?:closed|error)_mid_turn|openai_ws_turn_timeout|openai_ws_turn_failed/i;
const WS_DECISIVE_EVENT_RE =
  /response\.(?:output_item\.(?:added|done)|output_text\.delta|function_call_arguments\.[a-z_]+|apply_patch_call(?:\.[a-z_]+)?|completed|failed|incomplete)/i;

export function detectOpenAiResponsesWsFallback(text) {
  const m = String(text || '').match(WS_FALLBACK_RE);
  return m ? m[0].toLowerCase() : null;
}

export function shouldForceOpenAiResponsesWsReconnect(request, previousResponseId) {
  if (!trim(previousResponseId)) return false;
  if (trim(request?.headers?.get?.('X-IAM-OpenAI-WS-Force-Reconnect')) === '1') return true;
  try {
    return (
      new URL(request?.url || 'https://invalid.local').searchParams.get(
        'openai_ws_force_reconnect',
      ) === '1'
    );
  } catch {
    return false;
  }
}

export function withOpenAiResponsesFallbackHeaders(response, reason, fullInput) {
  if (!(response instanceof Response)) return response;
  const headers = new Headers(response.headers);
  headers.set('X-IAM-OpenAI-Transport', 'http');
  headers.set('X-IAM-OpenAI-Fallback-Reason', trim(reason) || 'websocket_failed');
  headers.set('X-IAM-OpenAI-Full-Input', fullInput ? '1' : '0');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fallbackToHttp(env, request, params, reason) {
  const hadPreviousResponse = !!trim(params.openaiPreviousResponseId);
  const httpParams = hadPreviousResponse
    ? { ...params, openaiPreviousResponseId: null }
    : params;
  const response = await chatWithToolsOpenAIResponses(env, request, httpParams);
  console.warn(
    '[openai_responses_ws] fallback_http',
    JSON.stringify({ reason, full_input: hadPreviousResponse }),
  );
  return withOpenAiResponsesFallbackHeaders(response, reason, hadPreviousResponse);
}

/**
 * Stable privacy-preserving safety id (not raw au_*).
 * @param {string|null|undefined} userId
 */
export async function openaiSafetyIdentifier(userId) {
  const uid = trim(userId);
  if (!uid) return null;
  const data = new TextEncoder().encode(`iam:openai-safety:${uid}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 64);
}

/**
 * @param {any} env
 * @param {string} sessionKey
 */
function getOpenAiResponsesWsStub(env, sessionKey) {
  const ns = env?.OPENAI_RESPONSES_WS;
  if (!ns || typeof ns.idFromName !== 'function') return null;
  const name = `oai-resp-ws:${trim(sessionKey) || 'anon'}`;
  return ns.get(ns.idFromName(name));
}

/**
 * Stream Responses via DO-held WebSocket. Returns the same SSE Response shape as HTTP path.
 * Falls back to HTTP when binding missing, connect fails, or previous_response_not_found mid-reconnect.
 *
 * @param {any} env
 * @param {Request} request
 * @param {Record<string, unknown>} params — same as chatWithToolsOpenAIResponses + sessionKey
 */
export async function chatWithToolsOpenAIResponsesWs(env, request, params) {
  const sessionKey =
    trim(params.sessionKey) ||
    trim(params.sessionId) ||
    trim(params.agentRunId) ||
    trim(params.userId) ||
    'default';

  const stub = getOpenAiResponsesWsStub(env, sessionKey);
  if (!stub) {
    console.warn('[openai_responses_ws] binding_missing_fallback_http');
    return fallbackToHttp(env, request, params, 'binding_missing');
  }

  let parts;
  try {
    parts = await buildOpenAIResponsesRequestParts(env, params);
  } catch (e) {
    return jsonResponse(
      { error: 'OpenAI Responses WS prep failed', detail: e?.message || String(e) },
      502,
    );
  }
  if (parts.errorResponse) return parts.errorResponse;

  const { apiKey, body } = parts;
  const safetyIdentifier = await openaiSafetyIdentifier(params.userId);

  // WS mode: no stream/background fields
  const create = { ...body };
  delete create.stream;
  delete create.background;

  if (shouldForceOpenAiResponsesWsReconnect(request, params.openaiPreviousResponseId)) {
    console.warn('[openai_responses_ws] soak_forced_reconnect');
    try {
      await stub.close();
    } catch (e) {
      console.warn('[openai_responses_ws] soak_force_reconnect_close_failed', e?.message ?? e);
    }
  }

  let readable;
  try {
    readable = await stub.createResponseSse({
      apiKey,
      safetyIdentifier,
      create,
    });
  } catch (e) {
    console.warn('[openai_responses_ws] create_failed_fallback_http', e?.message ?? e);
    return fallbackToHttp(env, request, params, 'connect_or_create_failed');
  }

  // Buffer the WS prelude until success is decisive. OpenAI may send lifecycle
  // frames before a cache-miss error, so inspecting only the first chunk is unsafe.
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let peeked = '';
  const bufferedChunks = [];
  try {
    for (let i = 0; i < 12 && peeked.length < 64 * 1024; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      bufferedChunks.push(value);
      peeked += decoder.decode(value, { stream: true });
      if (detectOpenAiResponsesWsFallback(peeked) || WS_DECISIVE_EVENT_RE.test(peeked)) break;
    }
  } catch (e) {
    console.warn('[openai_responses_ws] peek_failed_fallback_http', e?.message ?? e);
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
    return fallbackToHttp(env, request, params, 'peek_failed');
  }

  const fallbackCode = detectOpenAiResponsesWsFallback(peeked);
  if (fallbackCode) {
    console.warn('[openai_responses_ws] cache_miss_fallback_http');
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
    return fallbackToHttp(env, request, params, fallbackCode);
  }

  if (!bufferedChunks.length) {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
    return fallbackToHttp(env, request, params, 'empty_ws_stream');
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (const chunk of bufferedChunks) controller.enqueue(chunk);
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) controller.enqueue(value);
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  console.info(
    '[openai_responses_ws] transport',
    JSON.stringify({ transport: 'websocket', buffered_chunks: bufferedChunks.length }),
  );
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-IAM-OpenAI-Transport': 'websocket',
    },
  });
}
