/**
 * Session sync from SSE: budget handoff + conversation_id persistence.
 */
import { LS_AGENT_CHAT_CONVERSATION_ID } from '../../../../agentChatConstants';
import { notifyAgentChatSessionsRefresh } from '../../../../lib/openAgentConversation';
import { replaceAgentConversationUrl } from '../../../../lib/agentRoutes';
import type { SseSession, SseDispatchResult } from './sseTypes';

/** Budget handoff — child session + cheaper model tier. */
export function handleHandoffFromSse(s: SseSession, data: unknown, evType: string | undefined): SseDispatchResult {
if (evType === 'handoff' && data && typeof data === 'object') {
  const h = data as {
    type?: string;
    next_session_id?: string;
    fallback_model_key?: string;
    reason?: string;
  };
  const nextId =
    typeof h.next_session_id === 'string' && h.next_session_id.trim()
      ? h.next_session_id.trim()
      : '';
  if (nextId) {
    try {
      localStorage.setItem(LS_AGENT_CHAT_CONVERSATION_ID, nextId);
    } catch {
      /* ignore */
    }
    s.ctx.setConversationId(nextId);
    replaceAgentConversationUrl(nextId);
    s.ctx.loadSessions();
    notifyAgentChatSessionsRefresh(nextId);
    s.ctx.onAgentHandoff?.({
      next_session_id: nextId,
      fallback_model_key:
        typeof h.fallback_model_key === 'string' ? h.fallback_model_key.trim() : undefined,
      reason: typeof h.reason === 'string' ? h.reason.trim() : undefined,
    });
  }
  s.ctx.onThinkingEvent?.({
    type: 'handoff',
    text:
      h.fallback_model_key && h.reason
        ? `Handoff → ${h.fallback_model_key} (${h.reason})`
        : 'Handoff to cheaper model tier…',
  });
  return 'continue';
}
  return 'fallthrough';
}

/** Persist conversation_id from any payload that carries it (deferred URL sync). */
export function handleConversationIdFromSse(s: SseSession, data: unknown): SseDispatchResult {
if (data && typeof data === 'object' && 'conversation_id' in data) {
  const cid = (data as { conversation_id?: string }).conversation_id;
  if (typeof cid === 'string' && cid) {
    s.activeConversationId = cid;
    s.ctx.setConversationId(cid);
    // Persist id immediately, but defer URL navigate until the stream ends.
    // Navigating /agent/new → /agent/{id} mid-SSE force-hydrates the tab and
    // cancels the fetch (image gen pick_model runs server-side; UI never sees it).
    try {
      localStorage.setItem(LS_AGENT_CHAT_CONVERSATION_ID, cid);
    } catch {
      /* ignore */
    }
    // Sidebar refresh only (dedicated event). Do not force-hydrate the live tab mid-SSE.
    notifyAgentChatSessionsRefresh(cid);
    s.pendingConversationUrlSync = cid;
  }
}
  return 'fallthrough';
}
