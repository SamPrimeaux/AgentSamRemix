/**
 * Explicit lifecycle logging for POST /api/agent/chat SSE streams.
 * Detects silent hangs: stream closes without token or done events.
 */

/**
 * @param {Record<string, unknown>} [meta]
 */
export function createChatStreamLifecycle(meta = {}) {
  const t0 = Date.now();
  /** @type {Record<string, number>} */
  const eventTypes = {};
  let sawToken = false;
  let sawDone = false;
  let sawError = false;
  /** @type {string|null} */
  let lastPhase = null;
  let firstTokenMs = null;
  /** @type {Record<string, unknown>|null} */
  let turnMeta = null;
  /** Last SSE error payload — durable trail (agentsam_error_log) needs more than event_types.error:1. */
  /** @type {{ code: string|null, message: string|null, detail: string|null, extras: Record<string, unknown> }|null} */
  let lastError = null;
  let assistantText = '';

  const basePayload = () => ({
    ...meta,
    elapsed_ms: Date.now() - t0,
    event_types: { ...eventTypes },
    saw_token: sawToken,
    saw_done: sawDone,
    saw_error: sawError,
    last_phase: lastPhase,
    first_token_ms: firstTokenMs,
    last_error_code: lastError?.code ?? null,
    last_error_message: lastError?.message ?? null,
    last_error_detail: lastError?.detail ?? null,
    assistant_text: assistantText ? assistantText.slice(0, 200000) : '',
    ...(lastError?.extras && Object.keys(lastError.extras).length
      ? { last_error_extras: lastError.extras }
      : {}),
  });

  /**
   * @param {string} type
   * @param {Record<string, unknown>} [payload]
   */
  const record = (type, payload = {}) => {
    const t = String(type || 'unknown');
    eventTypes[t] = (eventTypes[t] || 0) + 1;
    if (t === 'status' && payload?.phase != null) {
      lastPhase = String(payload.phase);
    }
    if (t === 'error') {
      sawError = true;
      const p = payload && typeof payload === 'object' ? payload : {};
      const extras = {};
      for (const k of [
        'tool_calls_used',
        'turns',
        'agent_run_id',
        'executed_tools',
        'model_key',
        'status',
      ]) {
        if (p[k] != null) extras[k] = p[k];
      }
      lastError = {
        code: p.code != null ? String(p.code).slice(0, 120) : null,
        message:
          p.message != null
            ? String(p.message).slice(0, 4000)
            : p.error != null
              ? String(p.error).slice(0, 4000)
              : null,
        detail: p.detail != null ? String(p.detail).slice(0, 4000) : null,
        extras,
      };
    }
    if (t === 'done') sawDone = true;
    if ((t === 'text' || t === 'content') && !sawToken) {
      sawToken = true;
      firstTokenMs = Date.now() - t0;
      console.info('[chat_stream] first_token', JSON.stringify(basePayload()));
    }
    if (t === 'text' || t === 'content') {
      const piece =
        typeof payload?.text === 'string'
          ? payload.text
          : typeof payload?.content === 'string'
            ? payload.content
            : '';
      if (piece) assistantText += piece;
    }
  };

  /**
   * @param {(type: string, payload?: Record<string, unknown>) => unknown} emit
   */
  const wrapEmit = (emit) => {
    return (type, payload = {}) => {
      record(type, payload);
      return emit(type, payload);
    };
  };

  /**
   * @param {string} [reason]
   */
  const finalize = (reason = 'stream_close') => {
    const payload = { ...basePayload(), reason, ...(turnMeta || {}) };
    const logPayload = {
      ...payload,
      assistant_text:
        typeof payload.assistant_text === 'string' && payload.assistant_text
          ? `[${payload.assistant_text.length} chars]`
          : '',
    };
    if (sawError) {
      console.warn('[chat_stream] close_with_error', JSON.stringify(logPayload));
      return payload;
    }
    if (!sawDone && !sawToken) {
      console.warn('[chat_stream] close_without_token_or_done', JSON.stringify(logPayload));
      return payload;
    }
    if (sawDone && !sawToken) {
      console.warn('[chat_stream] close_done_no_token', JSON.stringify(logPayload));
      return payload;
    }
    console.info('[chat_stream] close_ok', JSON.stringify(logPayload));
    return payload;
  };

  const logOpen = () => {
    console.info('[chat_stream] open', JSON.stringify({ ...meta, t0 }));
  };

  /** @param {Record<string, unknown>|null|undefined} metaPatch */
  const setTurnMeta = (metaPatch) => {
    turnMeta = metaPatch && typeof metaPatch === 'object' ? { ...metaPatch } : null;
  };

  return { wrapEmit, finalize, record, logOpen, setTurnMeta, basePayload, t0, get sawToken() { return sawToken; }, get sawDone() { return sawDone; } };
}
