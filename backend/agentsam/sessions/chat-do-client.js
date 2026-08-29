import { getAgentSessionStub, withDoFetchTimeout } from './do-stub.js';
import { appendTurnOutboxEvent } from './turn-outbox-client.js';
import {
  getChatDigestText,
  getChatMessagesFromR2,
} from './compaction/archive.js';

/**
 * @param {any} env
 * @param {string} conversationId
 * @param {{
 *   id?: string|null,
 *   turn_id?: string|null,
 *   role: string,
 *   content: string,
 *   status?: string,
 *   error?: string|null,
 *   model_key?: string|null,
 *   tokens_in?: number,
 *   tokens_out?: number,
 *   tool_calls?: unknown,
 * }} turn
 */
async function appendChatMessageToDo(env, conversationId, turn, opts = {}) {
  const stub = getAgentSessionStub(env, conversationId);
  if (!stub) return { ok: false, reason: 'no_binding' };

  const resp = await withDoFetchTimeout(
    stub.fetch(
      new Request('https://do/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: turn.id ?? undefined,
          turn_id: turn.turn_id ?? null,
          role: turn.role,
          content: turn.content,
          status: turn.status ?? 'complete',
          error: turn.error ?? null,
          model_used: turn.model_key ?? null,
          input_tokens: Number(turn.tokens_in) || 0,
          output_tokens: Number(turn.tokens_out) || 0,
          tool_calls: turn.tool_calls ?? null,
        }),
      }),
    ),
    opts.timeoutMs ?? 5000,
  );
  if (!resp) return { ok: false, reason: 'do_timeout' };
  if (!resp.ok) return { ok: false, reason: `do_${resp.status}` };
  const data = await resp.json().catch(() => ({}));
  return { ok: true, id: data?.id ?? turn.id ?? null };
}

/**
 * Best-effort wipe of DO SQLite for a conversation (messages + outbox).
 * @param {any} env
 * @param {string} conversationId
 */
export async function wipeChatSessionDo(env, conversationId) {
  const stub = getAgentSessionStub(env, conversationId);
  if (!stub) return { ok: false, reason: 'no_binding' };
  const resp = await withDoFetchTimeout(
    stub.fetch(new Request('https://do/wipe', { method: 'POST' })),
    8000,
  );
  if (!resp) return { ok: false, reason: 'do_timeout' };
  if (!resp.ok) return { ok: false, reason: `do_${resp.status}` };
  return { ok: true };
}

/**
 * @param {any} env
 * @param {string} conversationId
 * @param {string} messageId
 * @param {{ status: string, error?: string|null, output_tokens?: number|null, content?: string|null }} patch
 */
async function patchChatMessageInDo(env, conversationId, messageId, patch) {
  const stub = getAgentSessionStub(env, conversationId);
  const msgId = String(messageId || '').trim();
  if (!stub || !msgId) return { ok: false, reason: 'missing_target' };

  const resp = await withDoFetchTimeout(
    stub.fetch(
      new Request(`https://do/message/${encodeURIComponent(msgId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    ),
    8000,
  );
  if (!resp) return { ok: false, reason: 'do_timeout' };
  if (!resp.ok) return { ok: false, reason: `do_${resp.status}` };
  return { ok: true };
}

/**
 * Write compacted tool payloads back into session_messages.content (same rows, no new table).
 *
 * DEPRECATED for inference/hydrate: DO is immutable canonical history. Turn
 * assembly must clone and trim working copies only. Prefer not calling this
 * from agent chat / tool-loop paths.
 *
 * @param {any} env
 * @param {string} conversationId
 * @param {any[]} messages
 */
export async function persistCompactedChatMessages(env, conversationId, messages) {
  const convId = String(conversationId || '').trim();
  if (!convId || !Array.isArray(messages) || !messages.length) return { patched: 0 };
  let patched = 0;
  for (const m of messages) {
    const id = m?.id != null ? String(m.id).trim() : '';
    if (!id) continue;
    let content = m.content;
    if (content == null) continue;
    if (typeof content !== 'string') {
      try {
        content = JSON.stringify(content);
      } catch {
        continue;
      }
    }
    const out = await patchChatMessageInDo(env, convId, id, {
      status: m.status != null ? String(m.status) : 'complete',
      content,
    });
    if (out?.ok) patched += 1;
  }
  return { patched };
}

/**
 * @param {any} env
 * @param {string} conversationId
 * @param {number} [limit]
 */
async function getChatMessagesFromDo(env, conversationId, limit = 500) {
  const convId = String(conversationId || '').trim();
  if (!convId) return null;
  const stub = getAgentSessionStub(env, convId);
  if (!stub) return null;

  const resp = await stub.fetch(
    new Request(`https://do/history?limit=${encodeURIComponent(String(limit))}`),
  );
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => ({}));
  const rows = Array.isArray(data) ? data : (data?.messages || []);
  if (!rows.length) return null;
  return fillEmptyAssistantFromOutbox(env, convId, mapDoHistoryRows(rows));
}

export function messagesFromDoBootstrap(boot) {
  const rows = Array.isArray(boot?.messages) ? boot.messages : [];
  if (!rows.length) return [];
  return mapDoHistoryRows(rows);
}

function coerceHydratedMessageContent(content) {
  if (typeof content !== 'string') return content;
  const t = content.trim();
  if (!t || (t[0] !== '[' && t[0] !== '{')) return content;
  if (!t.includes('tool_result') && !t.includes('"role"')) return content;
  try {
    return JSON.parse(t);
  } catch {
    return content;
  }
}

function mapDoHistoryRows(rows) {
  return rows.map((r) => ({
    id: r.id,
    turn_id: r.turn_id ?? null,
    role: r.role,
    content: coerceHydratedMessageContent(r.content),
    status: r.status ?? 'complete',
    error: r.error ?? null,
    ts: r.created_at ? new Date(Number(r.created_at) * 1000).toISOString() : null,
    model_key: r.model_used ?? null,
    tokens_in: Number(r.input_tokens) || 0,
    tokens_out: Number(r.output_tokens) || 0,
    tool_calls: r.tool_calls ?? null,
  }));
}

function assistantTextFromOutboxEvents(events) {
  if (!Array.isArray(events) || !events.length) return '';
  let text = '';
  for (const evt of events) {
    const t = String(evt?.event_type || '').trim();
    if (t !== 'token' && t !== 'text' && t !== 'content') continue;
    const p = evt?.payload && typeof evt.payload === 'object' ? evt.payload : {};
    const piece =
      typeof p.text === 'string' ? p.text : typeof p.content === 'string' ? p.content : '';
    if (piece) text += piece;
  }
  return text.trim();
}

function messageContentLooksEmpty(content) {
  const c = typeof content === 'string' ? content.trim() : '';
  return !c || c === '(empty)' || c === 'Loading conversation…';
}

async function fillEmptyAssistantFromOutbox(env, conversationId, rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const stub = getAgentSessionStub(env, conversationId);
  if (!stub) return rows;
  for (const m of rows) {
    if (m?.role !== 'assistant' || !messageContentLooksEmpty(m.content)) continue;
    const turnId = m.turn_id != null ? String(m.turn_id).trim() : '';
    if (!turnId) continue;
    try {
      const resp = await withDoFetchTimeout(
        stub.fetch(
          new Request(
            `https://do/outbox?turn_id=${encodeURIComponent(turnId)}&limit=1000`,
          ),
        ),
        5000,
      );
      if (!resp || !resp.ok) continue;
      const data = await resp.json().catch(() => ({}));
      const text = assistantTextFromOutboxEvents(data?.events);
      if (!text) continue;
      m.content = text;
      m.status = 'complete';
      const id = m.id != null ? String(m.id).trim() : '';
      if (id) {
        patchChatMessageInDo(env, conversationId, id, {
          status: 'complete',
          content: text,
        }).catch((e) => console.warn('[getChatMessages] backfill DO from outbox', e?.message ?? e));
      }
    } catch (e) {
      console.warn('[getChatMessages] outbox fill', e?.message ?? e);
    }
  }
  return rows;
}

/** @param {string} status */
function mapChatTurnStatusToMessageStatus(status) {
  const st = String(status || '').trim();
  if (st === 'completed') return 'complete';
  if (st === 'done_no_token') return 'failed';
  if (st === 'in_progress') return 'pending';
  return st;
}

/**
 * Reserve a turn in the conversation DO: pending assistant row + turn_id for grouping.
 *
 * @param {any} env
 * @param {string} conversationId
 * @param {{ model_key?: string|null }} [opts]
 * @returns {Promise<{ turnId: string, assistantMessageId: string }|null>}
 */
export async function beginChatTurn(env, conversationId, opts = {}) {
  const convId = String(conversationId || '').trim();
  if (!convId) return null;

  const turnId = `turn_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const assistantMessageId = crypto.randomUUID();

  // Persist the user turn immediately so reopen/history survives mid-turn hard fails.
  const userContent =
    typeof opts.user_content === 'string'
      ? opts.user_content
      : typeof opts.userContent === 'string'
        ? opts.userContent
        : '';
  if (userContent.trim()) {
    const userWrite = await appendChatMessageToDo(
      env,
      convId,
      {
        turn_id: turnId,
        role: 'user',
        content: userContent,
        status: 'complete',
        model_key: opts.model_key ?? null,
      },
      { timeoutMs: opts.timeoutMs ?? 4000 },
    );
    if (!userWrite.ok) {
      console.warn('[beginChatTurn] user_write', userWrite.reason || 'do_write_failed', convId);
    }
  }

  const pending = await appendChatMessageToDo(
    env,
    convId,
    {
      id: assistantMessageId,
      turn_id: turnId,
      role: 'assistant',
      content: '',
      status: 'pending',
      model_key: opts.model_key ?? null,
    },
    { timeoutMs: opts.timeoutMs ?? 4000 },
  );
  if (!pending.ok) {
    console.warn('[beginChatTurn]', pending.reason || 'do_write_failed', convId);
    return null;
  }
  void appendTurnOutboxEvent(env, convId, turnId, 'status', {
    phase: 'turn_started',
    assistant_message_id: assistantMessageId,
  }).catch(() => {});
  return { turnId, assistantMessageId };
}

/**
 * Append a turn to messages.jsonl in R2 (get → append → put).
 * Increments message_count and token accumulators on the D1 row.
 *
 * @param {any} env
 * @param {string} conversationId
 * @param {{
 *   role: 'user'|'assistant'|'tool',
 *   content: string,
 *   id?: string|null,
 *   turn_id?: string|null,
 *   status?: string,
 *   error?: string|null,
 *   model_key?: string|null,
 *   tokens_in?: number,
 *   tokens_out?: number,
 *   tool_calls?: unknown,
 * }} turn
 * @returns {Promise<{ ok: boolean, id?: string|null }>}
 */
export async function appendChatMessage(env, conversationId, turn) {
  const convId = String(conversationId || '').trim();
  if (!convId) return { ok: false };

  const doResult = await appendChatMessageToDo(env, convId, turn);
  if (!doResult.ok) {
    console.warn('[appendChatMessage] DO write failed', doResult.reason);
    return { ok: false };
  }

  if (env.DB) {
    const bumpCount =
      turn.role === 'user' ||
      (turn.role === 'assistant' && String(turn.status || 'complete') === 'complete');
    if (bumpCount) {
      env.DB.prepare(
        `UPDATE agentsam_chat_sessions
         SET message_count = COALESCE(message_count, 0) + 1,
             updated_at    = unixepoch()
         WHERE conversation_id = ?`,
      )
        .bind(convId)
        .run()
        .catch((e) => console.warn('[appendChatMessage] D1 count update failed', e?.message ?? e));
    }
  }

  return { ok: true, id: doResult.id ?? null };
}

/**
 * Persist turn lifecycle on agentsam_chat_sessions (requires migration 749).
 * Values: in_progress | completed | failed | interrupted | done_no_token
 *
 * @param {any} env
 * @param {string|null|undefined} conversationId
 * @param {string} status
 * @param {string|null} [error]
 * @param {{ assistantMessageId?: string|null, output_tokens?: number|null, content?: string|null }} [opts]
 */
export async function markChatTurnStatus(env, conversationId, status, error = null, opts = {}) {
  const convId = String(conversationId || '').trim();
  const st = String(status || '').trim();
  if (!convId || !st) return { ok: false };

  const assistantMessageId =
    opts.assistantMessageId != null ? String(opts.assistantMessageId).trim() : '';
  if (assistantMessageId && env?.AGENT_SESSION && st !== 'in_progress') {
    const patch = {
      status: mapChatTurnStatusToMessageStatus(st),
      error: error != null ? String(error).slice(0, 500) : null,
    };
    if (opts.output_tokens != null) patch.output_tokens = Number(opts.output_tokens) || 0;
    if (typeof opts.content === 'string') patch.content = opts.content;
    await patchChatMessageInDo(env, convId, assistantMessageId, patch).catch((e) =>
      console.warn('[markChatTurnStatus] DO patch failed', e?.message ?? e),
    );
  }

  if (!env?.DB) return { ok: false };
  try {
    await env.DB.prepare(
      `UPDATE agentsam_chat_sessions
       SET last_turn_status = ?,
           last_turn_error = ?,
           last_turn_at = unixepoch(),
           updated_at = unixepoch()
       WHERE conversation_id = ?`,
    )
      .bind(st, error != null ? String(error).slice(0, 500) : null, convId)
      .run();
    return { ok: true };
  } catch (e) {
    console.warn('[markChatTurnStatus]', e?.message ?? e);
    return { ok: false };
  }
}

/**
 * Fetch and parse messages.jsonl from R2.
 * Returns an array of turn objects in chronological order.
 *
 * @param {any} env
 * @param {string} conversationId
 * @returns {Promise<Array<{ role: string, content: string, ts: string, model_key: string|null, tokens_in: number, tokens_out: number }>>}
 */
function chatMessagesLookEmpty(rows) {
  if (!Array.isArray(rows) || !rows.length) return true;
  return !rows.some((m) => {
    if (m?.role !== 'assistant') return false;
    const st = String(m?.status || '').toLowerCase();
    if (st === 'pending' || st === 'in_progress') return false;
    return !messageContentLooksEmpty(m.content);
  });
}

export async function getChatMessages(env, conversationId, opts = {}) {
  const convId = String(conversationId || '').trim();
  if (!convId) return [];
  const hydrate = opts.hydrate === true;
  // DO page size max is 500. Hydrate for inference loads a large slice;
  // pressure-aware reduction happens in assembleWorkingContextForInference.
  const limit = Math.min(
    Math.max(Number(opts.limit) || (hydrate ? 500 : 200), 1),
    500,
  );

  // DO is hot path, but empty stubs (e.g. image turns that never wrote markdown)
  // must not block R2 fallback — that is why refresh showed "(empty)".
  // Never replace a non-empty DO payload with an empty R2 miss.
  let rows = null;
  try {
    rows = await getChatMessagesFromDo(env, convId, limit);
  } catch (e) {
    console.warn('[getChatMessages] DO history failed', e?.message ?? e);
    rows = null;
  }
  if (!rows?.length || chatMessagesLookEmpty(rows)) {
    const r2 = await getChatMessagesFromR2(env, convId);
    if (r2?.length) {
      if (!chatMessagesLookEmpty(r2) || !rows?.length) rows = r2;
    }
  }
  if (!Array.isArray(rows) || !rows.length) return [];

  if (!hydrate) return rows;

  const { windowChatMessagesForHydrate, prependChatDigest } = await import('./window/hydrate.js');
  // Stub-strip only — no tool trim persist, no universal 12/48/80k ceiling.
  const windowed = windowChatMessagesForHydrate(rows);
  const digest = await getChatDigestText(env, convId);
  return prependChatDigest(windowed.messages, digest);
}
