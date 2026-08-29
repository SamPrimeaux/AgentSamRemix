const TERMINAL_WS_TAG = 'terminal';

/**
 * @param {any} _session
 * @param {WebSocket} ws
 * @param {string} status
 * @param {string|null} [error]
 * @param {{ binding?: Record<string, unknown>|null }} [meta]
 */
export function sendTerminalState(_session, ws, status, error = null, meta = null) {
  try {
    const binding = meta?.binding || _session?.terminalBinding || undefined;
    ws.send(
      JSON.stringify({
        type: 'state',
        status,
        error: error || undefined,
        binding: binding || undefined,
      }),
    );
  } catch {}
}

export function publishTerminalEvent(session, event) {
  const payload = JSON.stringify(event);
  let delivered = 0;
  for (const ws of session.ctx.getWebSockets(TERMINAL_WS_TAG)) {
    try { ws.send(payload); delivered += 1; } catch {}
  }
  return delivered;
}

/**
 * @param {any} session
 * @param {string} status
 * @param {string|null} [error]
 * @param {{ binding?: Record<string, unknown>|null }} [meta]
 */
export function broadcastTerminalState(session, status, error = null, meta = null) {
  const binding = meta?.binding || session?.terminalBinding || undefined;
  return publishTerminalEvent(session, {
    type: 'state',
    status,
    error: error || undefined,
    binding: binding || undefined,
  });
}

export function broadcastTerminalOutput(session, text) {
  return publishTerminalEvent(session, { type: 'output', data: text });
}
