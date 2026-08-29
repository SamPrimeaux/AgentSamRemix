/**
 * PTY connect state-machine helpers (generation, abort, URL, selection/cwd laws).
 * Keep this module import-light so race tests do not pull the Worker graph.
 */

export const PTY_DIAL_TIMEOUT_MS = 12_000;

/** Query keys IAM owns on backend PTY URLs. Unknown params are preserved. */
export const PTY_OWNED_QUERY_KEYS = Object.freeze([
  'token',
  'tenant_id',
  'user_id',
  'workspace_id',
  'shell',
  'cwd',
  'session_id',
  'session_token',
]);

/**
 * @param {{ ptyConnectGeneration?: number, ptyConnectAbort?: AbortController }} session
 * @returns {number}
 */
export function bumpPtyConnectGeneration(session) {
  try {
    session.ptyConnectAbort?.abort();
  } catch {
    /* ignore */
  }
  session.ptyConnectGeneration = Number(session.ptyConnectGeneration || 0) + 1;
  session.ptyConnectAbort = new AbortController();
  return session.ptyConnectGeneration;
}

/**
 * Authoritative backend is this socket *and* this generation.
 * @param {{ ptyWs?: unknown, ptyConnectGeneration?: number }} session
 * @param {unknown} pty
 * @param {number} generation
 */
export function isPtyBackendCurrent(session, pty, generation) {
  return (
    !!pty &&
    session?.ptyWs === pty &&
    Number(session?.ptyConnectGeneration || 0) === Number(generation)
  );
}

/**
 * @param {{ ptyConnectGeneration?: number, ptyConnectAbort?: AbortController }} session
 * @param {number} attemptGeneration
 */
export function assertPtyAttemptCurrent(session, attemptGeneration) {
  if (Number(session?.ptyConnectGeneration || 0) !== Number(attemptGeneration)) {
    const err = new Error('pty_connect_stale');
    err.code = 'pty_connect_stale';
    throw err;
  }
  if (session?.ptyConnectAbort?.signal?.aborted) {
    const err = new Error('pty_connect_aborted');
    err.code = 'pty_connect_aborted';
    throw err;
  }
}

/**
 * Nested abort: generation abort *or* dial timeout.
 * @param {{ ptyConnectAbort?: AbortController }} session
 * @param {number} [timeoutMs]
 */
export function createPtyDialAbort(session, timeoutMs = PTY_DIAL_TIMEOUT_MS) {
  const parent = session?.ptyConnectAbort;
  const ac = new AbortController();
  const onParentAbort = () => {
    try {
      ac.abort(parent?.signal?.reason);
    } catch {
      /* ignore */
    }
  };
  if (parent?.signal?.aborted) onParentAbort();
  else parent?.signal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => {
    try {
      const err = new Error('pty_dial_timeout');
      err.code = 'pty_dial_timeout';
      ac.abort(err);
    } catch {
      /* ignore */
    }
  }, timeoutMs);
  return {
    signal: ac.signal,
    dispose() {
      clearTimeout(timer);
      try {
        parent?.signal?.removeEventListener('abort', onParentAbort);
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Convert http(s) → ws(s). Preserve path + query (do not split on '?').
 * @param {unknown} raw
 */
export function normalizeWebSocketUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  let href = trimmed;
  if (href.startsWith('https://')) href = `wss://${href.slice(8)}`;
  else if (href.startsWith('http://')) href = `ws://${href.slice(7)}`;
  else if (!href.startsWith('wss://') && !href.startsWith('ws://')) {
    href = `wss://${href.replace(/^\/+/, '')}`;
  }
  try {
    const u = new URL(href);
    if (u.protocol === 'https:') u.protocol = 'wss:';
    else if (u.protocol === 'http:') u.protocol = 'ws:';
    return u.toString();
  } catch {
    return href;
  }
}

/**
 * Set IAM-owned query keys; leave all other configured params in place.
 * @param {string} url
 * @param {Record<string, string|null|undefined>} owned
 */
export function applyOwnedPtyQueryParams(url, owned = {}) {
  const raw = String(url || '').trim();
  if (!raw) return raw;
  const u = new URL(raw, 'http://127.0.0.1');
  for (const key of PTY_OWNED_QUERY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(owned, key)) continue;
    const value = owned[key];
    if (value == null || String(value).trim() === '') u.searchParams.delete(key);
    else u.searchParams.set(key, String(value));
  }
  return u.toString();
}

/**
 * Fail closed on selection/health errors.
 * Documented exception: sandbox uses MY_CONTAINER, so a missing
 * terminal_connections row is not a routing failure.
 *
 * @param {{ connection?: unknown, error?: string|null }} sel
 * @param {{ targetType?: string|null }} [opts]
 */
export function requireSelectedTerminalConnection(sel, opts = {}) {
  const tt = String(opts.targetType || '').trim();
  const error = sel?.error != null ? String(sel.error).trim() : '';
  if (!error) return sel?.connection || null;
  if (tt === 'sandbox' && (error === 'connection_missing' || error === 'target_type_required')) {
    return null;
  }
  const err = new Error(error);
  err.code = error;
  throw err;
}

/**
 * Host-backed PTY (local/remote) must not attach with unresolved cwd.
 * Sandbox has its own container cwd. `user_home` with a null cwd is an
 * explicit strategy (shell home), not an error.
 *
 * @param {{ cwd?: string|null, error?: string|null, user_message?: string|null, unsupported?: boolean, strategy?: string|null }} cwdResult
 * @param {string|null|undefined} targetLane
 */
export function requireHostPtyCwd(cwdResult, targetLane) {
  const lane = String(targetLane || '').trim();
  if (cwdResult?.error) {
    const err = new Error(String(cwdResult.error));
    err.code = String(cwdResult.error);
    if (cwdResult.user_message) err.user_message = cwdResult.user_message;
    throw err;
  }
  if (cwdResult?.unsupported) {
    const err = new Error('cwd_strategy_unsupported');
    err.code = 'cwd_strategy_unsupported';
    throw err;
  }
  if (lane === 'sandbox') return String(cwdResult?.cwd || '').trim() || null;
  if (lane !== 'local' && lane !== 'remote') return String(cwdResult?.cwd || '').trim() || null;
  const cwd = cwdResult?.cwd != null ? String(cwdResult.cwd).trim() : '';
  if (cwd) return cwd;
  if (String(cwdResult?.strategy || '').trim() === 'user_home') return null;
  const err = new Error('pty_cwd_required');
  err.code = 'pty_cwd_required';
  throw err;
}

/**
 * Restore targetType + connectionId as one selection identity.
 * Never apply a stored connection pin for a different target than the
 * effective/explicit request.
 *
 * @param {Record<string, unknown>} session
 * @param {Record<string, unknown>|null} ctx
 * @param {{ explicitTarget?: string }} [opts]
 */
export function applyRestoredPtySelection(session, ctx, opts = {}) {
  if (!ctx || typeof ctx !== 'object') return;
  const explicit = String(opts.explicitTarget || '').trim();
  const requested = String(session.requestedTargetType || explicit || '').trim();
  const ctxTt = String(ctx.targetType || '').trim();
  if (ctxTt && (!requested || requested === 'auto')) {
    session.requestedTargetType = ctxTt;
    session.selectedTargetType = ctxTt;
  }
  const effectiveTt = String(session.requestedTargetType || '').trim();
  const havePin = String(session.requestedConnectionId || '').trim();
  const ctxConn = String(ctx.connectionId || '').trim();
  if (ctxConn && !havePin) {
    if (ctxTt && effectiveTt && ctxTt !== effectiveTt && effectiveTt !== 'auto') return;
    session.requestedConnectionId = ctxConn;
  }
}
