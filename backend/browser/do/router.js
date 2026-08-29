/**
 * HTTP path router for AgentBrowserLiveV1 fetch handler.
 */
import { listEvents } from './events.js';
import { handleEnsure, handleLiveUrlRefresh } from './ensure.js';
import {
  handleHumanInputCancel,
  handleHumanInputRequest,
  handleHumanInputResume,
} from './human-input.js';
import {
  CLASS_NAME,
  getSessionRow,
  handleClose,
  handleSessionPatch,
  json,
  rowToLiveSession,
} from './session.js';
import { handleWebSocketUpgrade } from './websocket.js';

/**
 * @param {any} session
 * @param {Request} request
 */
export async function handleBrowserSessionFetch(session, request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (request.headers.get('Upgrade') === 'websocket' && path === '/ws') {
    return handleWebSocketUpgrade(session);
  }

  if (method === 'GET' && path === '/health') {
    const row = getSessionRow(session);
    return json({
      ok: true,
      class: CLASS_NAME,
      browser_session_id: row?.browser_session_id ?? null,
      agent_run_id: row?.agent_run_id ?? null,
      status: row?.status ?? 'idle',
    });
  }

  if (method === 'GET' && path === '/session') {
    const row = getSessionRow(session);
    if (!row) return json({ ok: false, error: 'no session' }, 404);
    return json({ ok: true, live_session: rowToLiveSession(row), session: row });
  }

  if (method === 'POST' && path === '/session/ensure') {
    return handleEnsure(session, request);
  }

  if (method === 'GET' && path === '/session/live-url') {
    return handleLiveUrlRefresh(session);
  }

  if (method === 'DELETE' && path === '/session/close') {
    return handleClose(session);
  }

  if (method === 'POST' && path === '/human-input/request') {
    return handleHumanInputRequest(session, request);
  }

  if (method === 'POST' && path === '/human-input/resume') {
    return handleHumanInputResume(session);
  }

  if (method === 'POST' && path === '/human-input/cancel') {
    return handleHumanInputCancel(session);
  }

  if (method === 'POST' && path === '/session/patch') {
    return handleSessionPatch(session, request);
  }

  if (method === 'GET' && path === '/events') {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const rows = listEvents(session, limit);
    return json({ ok: true, events: rows });
  }

  return json({ error: 'Not found', path }, 404);
}
