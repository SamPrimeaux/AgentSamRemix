/**
 * Agent run cancel — D1 flag the tool loop polls between steps.
 *
 * Soft-cancel must NOT write status='cancelling'. agentsam_agent_run CHECK only
 * allows queued|running|completed|failed|partial|cancelled. In-flight cancel is
 * cancel_requested=1 while status stays running; finalize writes cancelled.
 */

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/** Statuses that still accept a cancel request (non-terminal). */
const CANCELLABLE_STATUSES = new Set(['queued', 'running', 'pending']);

/**
 * @param {any} env
 * @param {string} runId
 * @param {{ userId?: string|null, workspaceId?: string|null, tenantId?: string|null }} auth
 * @param {{
 *   forceTerminal?: boolean,
 *   reason?: string|null,
 * }} [opts]
 *   forceTerminal — also write status=cancelled + completed_at (multitask stop / operator kill).
 *   Soft-only (default) keeps status=running until the loop finalizes — fine for chat SSE,
 *   unreliable for fanout lanes that may be mid-tool for a long time.
 */
export async function requestAgentRunCancel(env, runId, auth = {}, opts = {}) {
  const rid = trim(runId);
  if (!env?.DB || !rid) return { ok: false, error: 'missing_run_id' };
  const forceTerminal = opts.forceTerminal === true;
  const reason = trim(opts.reason) || 'agent_run_cancelled';

  const row = await env.DB.prepare(
    `SELECT id, status, user_id, workspace_id, tenant_id, cancel_requested
       FROM agentsam_agent_run WHERE id = ? LIMIT 1`,
  )
    .bind(rid)
    .first()
    .catch(() => null);

  if (!row?.id) return { ok: false, error: 'run_not_found' };

  const uid = trim(auth.userId);
  if (uid && row.user_id && trim(row.user_id) !== uid) {
    return { ok: false, error: 'forbidden' };
  }
  // Workspace mismatch is not forbid — session identity workspace often differs from
  // the chat execution workspace on the run row; ownership is user_id.

  const st = trim(row.status).toLowerCase();
  if (st && !CANCELLABLE_STATUSES.has(st)) {
    return {
      ok: true,
      already_terminal: true,
      status: st,
      cancel_requested: Number(row.cancel_requested) === 1,
    };
  }

  const schema = await env.DB
    .prepare('PRAGMA table_info(agentsam_agent_run)')
    .all()
    .catch(() => ({ results: [] }));
  const cols = new Set(
    (schema?.results || [])
      .map((column) => String(column?.name || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const alreadyFlagged = cols.has('cancel_requested') && Number(row.cancel_requested) === 1;

  // Soft-only + already flagged → no-op unless forceTerminal still needs to close the row.
  if (alreadyFlagged && !forceTerminal) {
    return {
      ok: true,
      run_id: rid,
      status: st || 'running',
      cancel_requested: true,
      already_requested: true,
    };
  }

  const sets = [];
  const binds = [];

  if (cols.has('cancel_requested')) {
    sets.push('cancel_requested = 1');
  }

  if (forceTerminal || !cols.has('cancel_requested')) {
    // Terminal cancel — CHECK-safe. Soft flag alone left multitask lanes billing as running.
    if (cols.has('status')) sets.push("status = 'cancelled'");
    if (cols.has('completed_at')) {
      sets.push("completed_at = COALESCE(completed_at, datetime('now'))");
    }
  }

  if (cols.has('error_message')) {
    sets.push('error_message = COALESCE(NULLIF(trim(error_message), \'\'), ?)');
    binds.push(reason.slice(0, 500));
  }
  if (cols.has('updated_at_unix')) {
    sets.push('updated_at_unix = ?');
    binds.push(Math.floor(Date.now() / 1000));
  }

  if (!sets.length) return { ok: false, error: 'cancel_columns_missing' };

  binds.push(rid);
  try {
    await env.DB.prepare(`UPDATE agentsam_agent_run SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();
  } catch (e) {
    const msg = String(e?.message || e);
    console.error('[agent-run-cancel] update_failed', { run_id: rid, error: msg });
    return { ok: false, error: 'cancel_update_failed', detail: msg.slice(0, 400) };
  }

  const outStatus = forceTerminal || !cols.has('cancel_requested') ? 'cancelled' : st || 'running';
  return {
    ok: true,
    run_id: rid,
    status: outStatus,
    cancel_requested: true,
    force_terminal: forceTerminal,
    already_requested: alreadyFlagged,
  };
}

/**
 * Cancel every non-terminal agent_run for a conversation (Stop before client
 * learned runId from SSE). Prefer forceTerminal so hung first-token waits stop
 * billing even when the tool loop is not polling cancel_requested yet.
 *
 * @param {any} env
 * @param {string} conversationId
 * @param {{ userId?: string|null, workspaceId?: string|null, tenantId?: string|null }} auth
 * @param {{
 *   forceTerminal?: boolean,
 *   reason?: string|null,
 *   limit?: number,
 * }} [opts]
 */
export async function requestAgentRunCancelByConversation(env, conversationId, auth = {}, opts = {}) {
  const conv = trim(conversationId);
  if (!env?.DB || !conv) return { ok: false, error: 'missing_conversation_id' };
  const uid = trim(auth.userId);
  if (!uid) return { ok: false, error: 'unauthenticated' };

  const limit = Math.min(50, Math.max(1, Math.floor(Number(opts.limit) || 20)));
  const forceTerminal = opts.forceTerminal !== false;
  const reason = trim(opts.reason) || 'agent_run_cancelled_by_conversation';

  // Scope by conversation + owning user only. Do NOT require identity.workspaceId to
  // match the run's workspace_id — chat often posts under an execution workspace while
  // the session identity is still the platform workspace, which made Stop find 0 rows.
  const rows = await env.DB.prepare(
    `SELECT id, status, user_id, workspace_id
       FROM agentsam_agent_run
      WHERE (conversation_id = ? OR session_id = ?)
        AND user_id = ?
        AND LOWER(TRIM(COALESCE(status, ''))) IN ('queued', 'running', 'pending')
      ORDER BY created_at_unix DESC
      LIMIT ?`,
  )
    .bind(conv, conv, uid, limit)
    .all()
    .catch(() => ({ results: [] }));

  const list = Array.isArray(rows?.results) ? rows.results : [];
  if (!list.length) {
    return {
      ok: true,
      conversation_id: conv,
      cancelled: [],
      count: 0,
      none_found: true,
    };
  }

  // Auth for per-run cancel: user only — skip workspace mismatch forbids.
  const cancelAuth = { userId: uid, tenantId: auth.tenantId ?? null };
  const cancelled = [];
  for (const row of list) {
    const out = await requestAgentRunCancel(env, row.id, cancelAuth, {
      forceTerminal,
      reason,
    });
    if (out?.ok) {
      cancelled.push({
        run_id: row.id,
        status: out.status,
        force_terminal: forceTerminal,
        already_requested: out.already_requested === true,
        already_terminal: out.already_terminal === true,
      });
    } else {
      console.warn('[agent-run-cancel] conversation_cancel_row_failed', {
        run_id: row.id,
        error: out?.error ?? 'unknown',
      });
    }
  }

  return {
    ok: true,
    conversation_id: conv,
    cancelled,
    count: cancelled.length,
    force_terminal: forceTerminal,
  };
}

/**
 * @param {any} env
 * @param {string|null|undefined} runId
 * @param {{ cache?: { at: number, value: boolean } }} [opts]
 */
export async function isAgentRunCancelRequested(env, runId, opts = {}) {
  const rid = trim(runId);
  if (!rid || !env?.DB) return false;

  const cache = opts.cache;
  const now = Date.now();
  if (cache && now - cache.at < 350) return cache.value;

  const row = await env.DB.prepare(
    `SELECT cancel_requested, status FROM agentsam_agent_run WHERE id = ? LIMIT 1`,
  )
    .bind(rid)
    .first()
    .catch(() => null);

  // cancel_requested is the soft-cancel SSOT. Also treat terminal cancelled
  // (and legacy 'cancelling' if any pre-CHECK rows existed) as stop signals.
  const cancelled =
    Number(row?.cancel_requested) === 1 ||
    trim(row?.status).toLowerCase() === 'cancelled' ||
    trim(row?.status).toLowerCase() === 'cancelling';

  if (cache) {
    cache.at = now;
    cache.value = cancelled;
  }
  return cancelled;
}

export function makeAgentRunAbortError(reason = 'agent_run_cancelled') {
  const error = new Error('Stopped by user');
  error.name = 'AbortError';
  error.code = reason;
  return error;
}

export function isAgentRunAbortError(error) {
  if (!error) return false;
  if (error.name === 'AbortError') return true;
  const code = String(error.code || '').trim();
  return code === 'agent_run_cancelled' || code === 'spend_cap_exceeded';
}

/**
 * Combine request disconnects, external aborts, and the D1 cancel flag into
 * one signal for the Agent Sam tool loop.
 *
 * @param {{
 *   request?: Request|null,
 *   externalSignal?: AbortSignal|null,
 *   env?: any,
 *   agentRunId?: string|null,
 * }} opts
 */
export function createAgentRunAbortScope(opts = {}) {
  const controller = new AbortController();
  const cancelFlagCache = { at: 0, value: false };
  const linked = [];

  const abort = (reason = 'agent_run_cancelled') => {
    if (controller.signal.aborted) return;
    try {
      controller.abort(reason);
    } catch {
      /* ignore */
    }
  };

  const linkSignal = (signal) => {
    if (!signal) return;
    if (signal.aborted) {
      abort(signal.reason || 'linked_aborted');
      return;
    }
    const onAbort = () => abort(signal.reason || 'linked_aborted');
    signal.addEventListener('abort', onAbort, { once: true });
    linked.push({ signal, onAbort });
  };

  linkSignal(opts.request?.signal ?? null);
  linkSignal(opts.externalSignal ?? null);

  const throwIfAborted = async () => {
    if (controller.signal.aborted) {
      throw makeAgentRunAbortError(String(controller.signal.reason || 'agent_run_cancelled'));
    }
    const runId = opts.agentRunId != null ? String(opts.agentRunId).trim() : '';
    if (runId && opts.env?.DB && await isAgentRunCancelRequested(opts.env, runId, {
      cache: cancelFlagCache,
    })) {
      abort('agent_run_cancelled');
      throw makeAgentRunAbortError('agent_run_cancelled');
    }
  };

  const dispose = () => {
    for (const { signal, onAbort } of linked) {
      signal.removeEventListener('abort', onAbort);
    }
    linked.length = 0;
  };

  const race = async (promise) => {
    await throwIfAborted();
    if (controller.signal.aborted) throw makeAgentRunAbortError();
    return new Promise((resolve, reject) => {
      const onAbort = () =>
        reject(makeAgentRunAbortError(String(controller.signal.reason || 'agent_run_cancelled')));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(promise)
        .then(resolve, reject)
        .finally(() => controller.signal.removeEventListener('abort', onAbort));
    });
  };

  return {
    signal: controller.signal,
    abort,
    throwIfAborted,
    race,
    dispose,
    isAborted: () => controller.signal.aborted,
  };
}

/**
 * Consume a readable stream while honoring the combined run abort signal.
 *
 * @param {ReadableStream<Uint8Array>} readable
 * @param {(chunk: Uint8Array) => void|boolean|Promise<void|boolean>} onChunk
 * @param {{ throwIfAborted?: () => Promise<void>, signal?: AbortSignal|null }} [opts]
 */
export async function consumeReadableWithAbort(readable, onChunk, opts = {}) {
  const reader = readable.getReader();
  const throwIfAborted = opts.throwIfAborted;
  const signal = opts.signal ?? null;
  let stoppedByConsumer = false;
  try {
    while (true) {
      if (throwIfAborted) await throwIfAborted();
      const read =
        signal && !signal.aborted
          ? new Promise((resolve, reject) => {
              const onAbort = () => {
                void reader.cancel('aborted').catch(() => {});
                reject(makeAgentRunAbortError(String(signal.reason || 'agent_run_cancelled')));
              };
              signal.addEventListener('abort', onAbort, { once: true });
              reader
                .read()
                .then(resolve, reject)
                .finally(() => signal.removeEventListener('abort', onAbort));
            })
          : signal?.aborted
            ? Promise.reject(makeAgentRunAbortError(String(signal.reason || 'agent_run_cancelled')))
            : reader.read();
      const { done, value } = await read;
      if (done) break;
      if (value && (await onChunk(value)) === false) {
        stoppedByConsumer = true;
        break;
      }
    }
  } catch (error) {
    try {
      await reader.cancel('aborted');
    } catch {
      /* ignore */
    }
    throw error;
  } finally {
    void stoppedByConsumer;
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}
