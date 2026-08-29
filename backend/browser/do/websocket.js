/**
 * WebSocket upgrade + message handling for AgentBrowserLiveV1.
 */
import { getSessionRow, rowToLiveSession } from './session.js';

/**
 * @param {any} session
 */
export function handleWebSocketUpgrade(session) {
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  session.ctx.acceptWebSocket(server);

  const row = getSessionRow(session);
  const liveSession = rowToLiveSession(row);
  try {
    server.send(
      JSON.stringify({
        type: 'session_snapshot',
        live_session: liveSession,
        status: row?.status ?? 'idle',
      }),
    );
  } catch {
    /* non-fatal */
  }

  try {
    const rows = session.sql
      .exec('SELECT id, event_type, payload_json, created_at FROM live_browser_events ORDER BY id DESC LIMIT 30')
      .toArray()
      .reverse();
    server.send(JSON.stringify({ type: 'events_bootstrap', events: rows }));
  } catch {
    /* non-fatal */
  }

  return new Response(null, { status: 101, webSocket: client });
}

/**
 * @param {any} _session
 * @param {import('@cloudflare/workers-types').WebSocket} ws
 * @param {string|ArrayBuffer} message
 */
export async function handleBrowserWebSocketMessage(_session, ws, message) {
  const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
  if (text === 'ping') {
    try {
      ws.send('pong');
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed?.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  } catch {
    /* ignore */
  }
}
