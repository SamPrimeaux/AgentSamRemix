/**
 * Early SSE heartbeat for POST /api/agent/chat — return response headers before D1 preflight.
 */

import { createChatStreamLifecycle } from './agent-chat-stream-audit.js';
import {
  createTurnOutboxBatcher,
  ingestSseChunkToTurnOutbox,
  wrapEmitWithTurnOutboxBatcher,
} from '../../backend/agentsam/sessions/turn-outbox-client.js';

export const AGENT_CHAT_SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'Access-Control-Allow-Origin': '*',
};

/**
 * @param {(ctx: {
 *   emit: (type: string, payload?: Record<string, unknown>) => Promise<void>,
 *   pipeResponse: (response: Response) => Promise<void>,
 *   streamLifecycle: ReturnType<typeof createChatStreamLifecycle>,
 *   outboxCtx: { batcher: ReturnType<typeof createTurnOutboxBatcher>|null },
 * }) => Promise<Response>} runPipeline
 * @param {{ conversationId?: string|null, userId?: string|null, workspaceId?: string|null, requestId?: string|null, env?: any, waitUntil?: (promise: Promise<unknown>) => void, onStreamClose?: (payload: Record<string, unknown>) => void|Promise<void> }} [meta]
 * @returns {Response}
 */
export function startAgentChatEarlySse(runPipeline, meta = {}) {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const streamLifecycle = createChatStreamLifecycle({
    layer: 'early_sse',
    conversation_id: meta.conversationId ?? null,
    user_id: meta.userId ?? null,
    workspace_id: meta.workspaceId ?? null,
    request_id: meta.requestId ?? null,
  });
  streamLifecycle.logOpen();

  const conversationId =
    meta.conversationId != null ? String(meta.conversationId).trim() : '';
  const outboxCtx = { batcher: null };

  const rawEmit = async (type, payload = {}) => {
    try {
      await writer.write(
        encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`),
      );
    } catch {
      /* stream closed */
    }
  };

  let emitImpl = streamLifecycle.wrapEmit(rawEmit);
  const pendingEmits = new Set();
  const emit = (type, payload = {}) => {
    const emission = Promise.resolve(emitImpl(type, payload)).catch(() => {});
    pendingEmits.add(emission);
    emission.then(
      () => pendingEmits.delete(emission),
      () => pendingEmits.delete(emission),
    );
    return emission;
  };

  const bindTurnOutbox = (turnId) => {
    const tid = String(turnId || '').trim();
    if (!tid || !conversationId || !meta.env?.AGENT_SESSION) return;
    outboxCtx.batcher = createTurnOutboxBatcher(meta.env, conversationId, tid);
    emitImpl = wrapEmitWithTurnOutboxBatcher(outboxCtx.batcher, streamLifecycle.wrapEmit(rawEmit));
  };

  const outboxTapState = { buffer: '' };

  // Register waitUntil *before* the SSE stream closes. CF treats stream completion
  // as invocation end; waitUntil() calls in `finally` after writer.close() are
  // cancelled immediately (the chronic dashboard warning).
  let releaseWaitUntilHold = () => {};
  const waitUntilHold = new Promise((resolve) => {
    releaseWaitUntilHold = resolve;
  });
  if (typeof meta.waitUntil === 'function') {
    meta.waitUntil(waitUntilHold);
  }

  const pipeResponse = async (response) => {
    if (!response) {
      await emit('error', { message: 'empty_agent_response' });
      await emit('done', {});
      return;
    }
    const ct = String(response.headers.get('content-type') || '').toLowerCase();
    if (!response.ok || !response.body || !ct.includes('event-stream')) {
      const text = await response.text().catch(() => '');
      let message = text;
      try {
        const j = JSON.parse(text);
        message = j.message || j.error || text;
      } catch {
        /* raw text */
      }
      await emit('error', {
        message: message || `HTTP ${response.status}`,
        code: response.status === 503 ? 'no_model_resolved' : undefined,
      });
      await emit('done', {});
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let completed = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          completed = true;
          break;
        }
        if (value?.byteLength) {
          streamLifecycle.record('pipe_bytes', { bytes: value.byteLength });
          ingestSseChunkToTurnOutbox(decoder.decode(value, { stream: true }), outboxTapState, {
            batcher: outboxCtx.batcher,
            onEvent: (type, payload) => streamLifecycle.record(type, payload),
          });
          await writer.write(value);
        }
      }
    } finally {
      // Do not cancel() — nodejs_compat maps ReadableStream.cancel to process.exit(1).
      void completed;
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  };

  void (async () => {
    try {
      await emit('thinking_start', {});
      await emit('status', { phase: 'preflight' });
      const inner = await runPipeline({
        emit,
        pipeResponse,
        streamLifecycle,
        outboxCtx,
        bindTurnOutbox,
      });
      if (inner instanceof Response) {
        await pipeResponse(inner);
      }
    } catch (e) {
      console.warn('[agent-chat-early-sse]', e?.message ?? e);
      await emit('error', { message: String(e?.message || e || 'agent_chat_failed') });
      await emit('done', {});
    } finally {
      try {
        await Promise.allSettled([...pendingEmits]);
        const closePayload = streamLifecycle.finalize('early_sse_close');
        await writer.close().catch(() => {});
        const outboxTask = Promise.resolve(outboxCtx.batcher?.finish()).catch((e) =>
          console.warn('[agent-chat-early-sse] outbox finish', e?.message ?? e),
        );
        await outboxTask;
        if (typeof meta.onStreamClose === 'function') {
          await Promise.resolve(meta.onStreamClose(closePayload)).catch((e) =>
            console.warn('[agent-chat-early-sse] onStreamClose', e?.message ?? e),
          );
        }
      } finally {
        releaseWaitUntilHold();
      }
    }
  })();

  return new Response(readable, { headers: AGENT_CHAT_SSE_HEADERS });
}
