import { getAgentSessionStub, withDoFetchTimeout } from './do-stub.js';

/**
 * High-frequency model “thinking” deltas. UI only shows Working… + spinner for these,
 * so persisting each chunk to the DO outbox is pure spam (thousands of POSTs / turn).
 * Live SSE still receives them via emit(); outbox gets at most one status heartbeat.
 */
export const OUTBOX_SILENT_SSE_TYPES = Object.freeze(
  new Set([
    'reasoning',
    'thinking',
    'thinking_delta',
    'reasoning_delta',
    'reasoning_content',
  ]),
);

/** @param {string} sseType */
export function mapSseTypeToOutboxEventType(sseType) {
  const t = String(sseType || '').trim();
  if (t === 'text' || t === 'content') return 'token';
  if (t === 'done') return 'done';
  if (t === 'error') return 'error';
  return 'status';
}

/**
 * @param {any} env
 * @param {string} conversationId
 * @param {string} turnId
 * @param {string} sseType
 * @param {Record<string, unknown>} [payload]
 */
export async function appendTurnOutboxEvent(env, conversationId, turnId, sseType, payload = {}) {
  return appendTurnOutboxBatch(env, conversationId, turnId, [{ sseType, payload }]);
}

/**
 * @param {any} env
 * @param {string} conversationId
 * @param {string} turnId
 * @param {Array<{ sseType: string, payload?: Record<string, unknown> }>} events
 */
export async function appendTurnOutboxBatch(env, conversationId, turnId, events) {
  const convId = String(conversationId || '').trim();
  const tid = String(turnId || '').trim();
  const batch = (Array.isArray(events) ? events : [])
    .map((evt) => ({
      sseType: String(evt?.sseType || evt?.type || 'status').trim(),
      payload: evt?.payload && typeof evt.payload === 'object' ? evt.payload : {},
    }))
    .filter((evt) => evt.sseType);
  if (!convId || !tid || !batch.length) return { ok: false, reason: 'missing_ids' };

  const stub = getAgentSessionStub(env, convId);
  if (!stub) return { ok: false, reason: 'no_binding' };

  const resp = await withDoFetchTimeout(
    stub.fetch(
      new Request('https://do/outbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turn_id: tid,
          events: batch.map((evt) => ({
            event_type: mapSseTypeToOutboxEventType(evt.sseType),
            payload: { type: evt.sseType, ...evt.payload },
          })),
        }),
      }),
    ),
    2000,
  );
  if (!resp) return { ok: false, reason: 'do_timeout' };
  if (!resp.ok) return { ok: false, reason: `do_${resp.status}` };
  const data = await resp.json().catch(() => ({}));
  return {
    ok: true,
    seq: data?.latest_seq ?? data?.seq ?? null,
    count: Number(data?.count) || batch.length,
  };
}

/**
 * Coalesce SSE events before writing to the conversation DO outbox.
 *
 * @param {any} env
 * @param {string} conversationId
 * @param {string} turnId
 * @param {{ flushMs?: number, maxBatch?: number, maxTokenChars?: number }} [opts]
 */
export function createTurnOutboxBatcher(env, conversationId, turnId, opts = {}) {
  const convId = String(conversationId || '').trim();
  const tid = String(turnId || '').trim();
  const flushMs = Math.max(100, Number(opts.flushMs) || 350);
  const maxBatch = Math.max(5, Number(opts.maxBatch) || 24);
  const maxTokenChars = Math.max(256, Number(opts.maxTokenChars) || 4096);

  /** @type {Array<{ sseType: string, payload: Record<string, unknown> }>} */
  let queue = [];
  let tokenBuffer = '';
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  /** @type {Promise<void>|null} */
  let flushPromise = null;
  /** @type {Promise<void>|null} */
  let terminalPromise = null;
  let closed = false;
  /** One outbox status for an entire reasoning/thinking burst (UI is Working… only). */
  let thinkingHeartbeatQueued = false;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const drain = async (terminalEvent = null) => {
    clearTimer();
    if (tokenBuffer) {
      queue.push({ sseType: 'text', payload: { type: 'text', text: tokenBuffer } });
      tokenBuffer = '';
    }
    if (terminalEvent) queue.push(terminalEvent);
    while (queue.length) {
      const batch = queue.splice(0, maxBatch);
      if (!batch.length) break;
      await appendTurnOutboxBatch(env, convId, tid, batch).catch((e) =>
        console.warn('[turn_outbox] batch append failed', e?.message ?? e),
      );
    }
  };

  const flush = async (terminalEvent = null) => {
    flushPromise = Promise.resolve(flushPromise)
      .catch(() => {})
      .then(() => drain(terminalEvent));
    return flushPromise;
  };

  const scheduleFlush = () => {
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, flushMs);
  };

  return {
    append(sseType, payload = {}) {
      if (closed || !convId || !tid || !env?.AGENT_SESSION) return;
      const t = String(sseType || 'status').trim();
      const body = payload && typeof payload === 'object' ? payload : {};

      if (t === 'text' || t === 'content') {
        const piece =
          typeof body.text === 'string'
            ? body.text
            : typeof body.content === 'string'
              ? body.content
              : '';
        if (!piece) return;
        tokenBuffer += piece;
        if (tokenBuffer.length >= maxTokenChars) {
          void flush();
        } else {
          scheduleFlush();
        }
        return;
      }

      if (t === 'status' && body.heartbeat) return;

      // Reasoning/thinking token spam → at most one DO status row per turn burst.
      if (OUTBOX_SILENT_SSE_TYPES.has(t)) {
        if (thinkingHeartbeatQueued) return;
        thinkingHeartbeatQueued = true;
        queue.push({
          sseType: 'status',
          payload: { type: 'status', phase: 'thinking', message: 'Working…' },
        });
        scheduleFlush();
        return;
      }

      if (t === 'done' || t === 'error' || t === 'turn_meta') {
        const terminalEvent = { sseType: t, payload: { type: t, ...body } };
        terminalPromise = Promise.resolve(terminalPromise)
          .catch(() => {})
          .then(() => flush(terminalEvent));
        void terminalPromise;
        if (t === 'done' || t === 'error') closed = true;
        return;
      }

      queue.push({ sseType: t, payload: { type: t, ...body } });
      if (queue.length >= maxBatch) void flush();
      else scheduleFlush();
    },
    async finish() {
      closed = true;
      clearTimer();
      if (terminalPromise) {
        await terminalPromise;
      } else {
        await flush();
      }
    },
  };
}

/**
 * @param {any} env
 * @param {string} conversationId
 * @param {string} turnId
 * @param {number} [sinceSeq]
 */
export async function fetchTurnOutboxEvents(env, conversationId, turnId, sinceSeq = 0) {
  const convId = String(conversationId || '').trim();
  const tid = String(turnId || '').trim();
  if (!convId || !tid) return { events: [], latest_seq: sinceSeq };

  const stub = getAgentSessionStub(env, convId);
  if (!stub) return { events: [], latest_seq: sinceSeq };

  const resp = await stub.fetch(
    new Request(
      `https://do/outbox?turn_id=${encodeURIComponent(tid)}&since_seq=${encodeURIComponent(String(Math.max(0, Number(sinceSeq) || 0)))}`,
    ),
  );
  if (!resp.ok) return { events: [], latest_seq: sinceSeq };
  const data = await resp.json().catch(() => ({}));
  return {
    events: Array.isArray(data?.events) ? data.events : [],
    latest_seq: Number(data?.latest_seq) || sinceSeq,
    turn_id: tid,
  };
}

/**
 * @param {any} env
 * @param {string|null|undefined} conversationId
 * @param {string|null|undefined} turnId
 * @param {(type: string, payload?: Record<string, unknown>) => unknown} emit
 */
export function wrapEmitWithTurnOutbox(env, conversationId, turnId, emit) {
  const batcher = createTurnOutboxBatcher(env, conversationId, turnId);
  return wrapEmitWithTurnOutboxBatcher(batcher, emit);
}

/**
 * @param {ReturnType<typeof createTurnOutboxBatcher>|null|undefined} batcher
 * @param {(type: string, payload?: Record<string, unknown>) => unknown} emit
 */
export function wrapEmitWithTurnOutboxBatcher(batcher, emit) {
  if (!batcher) return emit;
  return (type, payload = {}) => {
    batcher.append(type, payload);
    return emit(type, payload);
  };
}

/**
 * Parse complete SSE blocks from a byte buffer; optionally record lifecycle + outbox batch.
 *
 * @param {string} chunk
 * @param {{ buffer?: string }} state
 * @param {{ batcher?: ReturnType<typeof createTurnOutboxBatcher>|null, onEvent?: (type: string, payload: Record<string, unknown>) => void }} [hooks]
 */
export function ingestSseChunkToTurnOutbox(chunk, state = {}, hooks = {}) {
  if (!chunk) return;

  const buf = String(state.buffer || '') + chunk;
  const parts = buf.split('\n\n');
  state.buffer = parts.pop() || '';

  for (const block of parts) {
    for (const rawLine of block.split('\n')) {
      const line = rawLine.trim();
      if (!line.toLowerCase().startsWith('data:')) continue;
      const dataStr = line.replace(/^data:\s*/i, '').trim();
      if (!dataStr || dataStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(dataStr);
        const type = typeof parsed?.type === 'string' ? parsed.type : 'status';
        hooks.batcher?.append(type, parsed);
        hooks.onEvent?.(type, parsed);
      } catch {
        /* ignore malformed SSE */
      }
    }
  }
}
