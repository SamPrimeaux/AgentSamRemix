import { migrateSessionAgentContextSchema } from './schema.js';

function waiters(session) {
  if (!session._fsaWaiters) session._fsaWaiters = new Map();
  return session._fsaWaiters;
}

function deleteFsaRow(session, id) {
  try {
    session.sql.exec(`DELETE FROM fsa_fulfill WHERE call_id = ?`, id);
  } catch {
    /* ignore */
  }
}

/**
 * Waiter map is the in-flight set — there is no FSA semaphore. Hyperdrive
 * "open slot in the pool" is Postgres. Log waiter_count so an orphaned park
 * is visible before the 90s timeout.
 *
 * @param {object} session
 * @param {string} phase
 * @param {string} callId
 */
function logFsaWaiterTelemetry(session, phase, callId) {
  const map = waiters(session);
  let oldestMs = 0;
  const now = Date.now();
  for (const entry of map.values()) {
    const age = now - (Number(entry.createdAt) || now);
    if (age > oldestMs) oldestMs = age;
  }
  console.info(
    '[fsa] waiters',
    JSON.stringify({
      phase,
      call_id: callId,
      in_use: map.size,
      oldest_pending_ms: oldestMs,
    }),
  );
}

/**
 * Park until client POSTs fulfill. Always delete the waiter + SQL row on
 * success, timeout, or abort — do not rely on the caller to clean up.
 *
 * @param {object} session
 * @param {string} callId
 * @param {{ timeoutMs?: number, signal?: AbortSignal|null }} [opts]
 */
export async function waitForFsaFulfill(session, callId, opts = {}) {
  migrateSessionAgentContextSchema(session.sql);
  const id = String(callId || '').trim();
  if (!id) throw new Error('fsa_call_id_required');
  const timeoutMs = Math.min(120000, Math.max(5000, Number(opts.timeoutMs) || 90000));
  const signal = opts.signal && typeof opts.signal === 'object' ? opts.signal : null;
  session.sql.exec(
    `INSERT INTO fsa_fulfill (call_id, result_json, created_at, fulfilled_at)
     VALUES (?, NULL, unixepoch(), NULL)
     ON CONFLICT(call_id) DO UPDATE SET result_json = NULL, fulfilled_at = NULL, created_at = unixepoch()`,
    id,
  );

  logFsaWaiterTelemetry(session, 'acquire', id);

  return new Promise((resolve, reject) => {
    const map = waiters(session);
    let settled = false;
    /** @type {ReturnType<typeof setTimeout>|null} */
    let timer = null;
    /** @type {(() => void)|null} */
    let onAbort = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal && onAbort) {
        try {
          signal.removeEventListener('abort', onAbort);
        } catch {
          /* ignore */
        }
      }
      map.delete(id);
      deleteFsaRow(session, id);
      logFsaWaiterTelemetry(session, 'release', id);
      fn(value);
    };

    timer = setTimeout(() => {
      finish(reject, new Error('fsa_fulfill_timeout'));
    }, timeoutMs);

    onAbort = () => {
      finish(reject, new Error('stream_canceled'));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    map.set(id, {
      createdAt: Date.now(),
      callId: id,
      resolve: (value) => finish(resolve, value),
      reject: (err) => finish(reject, err),
    });
  });
}

/**
 * Force-reject every parked FSA waiter (stream cancel / run abort).
 * @param {object} session
 * @param {string} [reason]
 * @returns {{ cancelled: number }}
 */
export function cancelPendingFsaRequests(session, reason = 'stream_canceled') {
  const map = waiters(session);
  const err = new Error(reason);
  let cancelled = 0;
  for (const [id, entry] of [...map.entries()]) {
    cancelled += 1;
    try {
      if (typeof entry.reject === 'function') entry.reject(err);
      else {
        map.delete(id);
        deleteFsaRow(session, id);
      }
    } catch {
      map.delete(id);
      deleteFsaRow(session, id);
    }
  }
  if (cancelled > 0) {
    logFsaWaiterTelemetry(session, 'cancel_all', reason);
  }
  return { cancelled };
}

export async function fulfillFsaRequest(session, callId, result) {
  migrateSessionAgentContextSchema(session.sql);
  const id = String(callId || '').trim();
  if (!id) return { ok: false, error: 'callId required' };
  const resultJson = JSON.stringify(result ?? {});
  session.sql.exec(
    `INSERT INTO fsa_fulfill (call_id, result_json, created_at, fulfilled_at)
     VALUES (?, ?, unixepoch(), unixepoch())
     ON CONFLICT(call_id) DO UPDATE SET result_json = excluded.result_json, fulfilled_at = unixepoch()`,
    id,
    resultJson,
  );
  const waiter = waiters(session).get(id);
  if (waiter) waiter.resolve(result ?? {});
  return { ok: true, callId: id };
}
