/**
 * POST /api/agent/fs/fulfill — peeled from agent/chat.js (Pass A).
 * Ticket: tkt_mod_peel_agent_chat_api_2026_08
 */
import { jsonResponse } from './shared.js';


/**
 * @returns {Promise<Response|null>}
 */
export async function handleFsFulfillApi(request, url, env, ctx, routeAuth, identity) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  if (path !== '/api/agent/fs/fulfill' || method !== 'POST') return null;


  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  const callId = String(body.callId || body.call_id || '').trim();
  const conversationId = String(
    body.conversationId || body.conversation_id || body.sessionId || body.session_id || '',
  ).trim();
  if (!callId || !conversationId) {
    return jsonResponse({ error: 'callId and conversationId required' }, 400);
  }
  if (!env.AGENT_SESSION) {
    return jsonResponse({ error: 'AGENT_SESSION not configured' }, 503);
  }
  const { getAgentSessionStub, doFulfillFsaRequest } = await import('../../agentsam/sessions/session-context.js');
  const stub = getAgentSessionStub(env, conversationId);
  if (!stub) return jsonResponse({ error: 'session_stub_unavailable' }, 503);
  const out = await doFulfillFsaRequest(stub, callId, body.result ?? {});
  return jsonResponse(out?.ok === false ? out : { ok: true, callId, ...out });
}
