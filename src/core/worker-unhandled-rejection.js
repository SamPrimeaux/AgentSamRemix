/**
 * Workers + nodejs_compat map unhandledRejection → process.exit(1).
 * ReadableStream.cancel() (even with no reason) rejects with `null` and kills
 * the in-flight `/api/agent/chat` isolate after first_token.
 *
 * Swallow only stream-cancel shaped reasons. Other rejections still log.
 */

export function isStreamCancelRejection(reason) {
  if (reason == null) return true;
  const msg =
    typeof reason === 'string'
      ? reason
      : reason && typeof reason === 'object' && typeof reason.message === 'string'
        ? reason.message
        : '';
  if (!msg) return false;
  if (/^(sse_terminal_event|aborted|protocol_complete|outer_stream_closed)$/.test(msg)) {
    return true;
  }
  // Hyperdrive / Postgres after chat close_ok — waitUntil work, not the SSE isolate.
  if (/Connection terminated unexpectedly/i.test(msg)) return true;
  if (/Timed out while waiting for an open slot in the pool/i.test(msg)) return true;
  return false;
}

export function installWorkerUnhandledRejectionGuard() {
  if (typeof process === 'undefined' || typeof process.on !== 'function') return;
  if (globalThis.__IAM_UNHANDLED_REJECTION_GUARD__) return;
  globalThis.__IAM_UNHANDLED_REJECTION_GUARD__ = true;
  process.on('unhandledRejection', (reason) => {
    if (isStreamCancelRejection(reason)) {
      console.warn(
        '[worker] swallowed stream-cancel unhandledRejection',
        reason == null ? 'null' : String(reason).slice(0, 180),
      );
      return;
    }
    console.error('[worker] unhandledRejection', reason);
  });
}

installWorkerUnhandledRejectionGuard();
