/**
 * Live browser event append + WebSocket broadcast for AgentBrowserLiveV1.
 */

/**
 * @param {any} session
 * @param {Record<string, unknown>|string} message
 */
export function broadcastWs(session, message) {
  const text = typeof message === 'string' ? message : JSON.stringify(message);
  for (const ws of session.ctx.getWebSockets()) {
    try {
      ws.send(text);
    } catch (e) {
      console.warn('[AgentBrowserLiveV1] ws broadcast', e?.message ?? e);
    }
  }
}

/**
 * @param {any} session
 * @param {string} eventType
 * @param {Record<string, unknown>} [payload]
 */
export function emitEvent(session, eventType, payload = {}) {
  session.sql.exec(
    'INSERT INTO live_browser_events (event_type, payload_json) VALUES (?, ?)',
    eventType,
    JSON.stringify(payload),
  );
  broadcastWs(session, {
    type: eventType,
    event_type: eventType,
    ...payload,
    created_at: new Date().toISOString(),
  });
}

/**
 * @param {any} session
 * @param {number} [limit]
 */
export function listEvents(session, limit = 50) {
  const n = Math.min(100, Math.max(1, Number(limit) || 50));
  return session.sql
    .exec('SELECT * FROM live_browser_events ORDER BY id DESC LIMIT ?', n)
    .toArray();
}
