/**
 * Turn lifecycle SSE: turn_meta / context / runtime_context / error / done.
 */
import { writeTurnOutboxCursor } from '../../../../lib/chatTurnOutbox';
import { IAM_AGENT_RUN_CONTEXT } from '../../../../agentChatConstants';
import { looksLikeRawProviderLeak, isStreamErrorPayload } from '../../streamParsing';
import { patchIamAgentStreamDebug } from '../../streamDebug';

import type { SseSession, SseDispatchResult } from './sseTypes';

/** turn_meta — runs before subagent/handoff (original order). */
export function handleTurnMetaFromSse(s: SseSession, data: unknown, evType: string | undefined): SseDispatchResult {
  if (evType === 'turn_meta' && data && typeof data === 'object') {
    const d = data as { turn_id?: string; conversation_id?: string };
    if (typeof d.turn_id === 'string' && d.turn_id.trim()) {
      s.activeTurnId = d.turn_id.trim();
      writeTurnOutboxCursor(s.activeTurnId, 0);
    }
    if (typeof d.conversation_id === 'string' && d.conversation_id.trim()) {
      s.activeConversationId = d.conversation_id.trim();
    }
    return 'continue';
  }
  return 'fallthrough';
}

/** context / runtime_context / error / done / provider-leak guards (after handoff). */
export function handleTurnStateFromSse(s: SseSession, data: unknown, evType: string | undefined): SseDispatchResult {
if (evType === 'status' && data && typeof data === 'object') {
  const st = data as { phase?: string; agent_run_id?: string };
  if (st.phase === 'agent_run_scheduled' && typeof st.agent_run_id === 'string' && st.agent_run_id.trim()) {
    const spineRunId = st.agent_run_id.trim();
    s.ctx.onAgentRunContext?.(spineRunId);
    s.activeAgentRunId = spineRunId;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(IAM_AGENT_RUN_CONTEXT, { detail: { id: spineRunId } }));
    }
    return 'continue';
  }
  return 'fallthrough';
}
if (evType === 'context' && data && typeof data === 'object') {
  const ctx = data as Record<string, unknown>;
  const spineRunId =
    typeof ctx.agent_run_id === 'string'
      ? ctx.agent_run_id.trim()
      : typeof ctx.agentRunId === 'string'
        ? ctx.agentRunId.trim()
        : '';
  s.ctx.onAgentRunContext?.(spineRunId || null);
  const mk =
    typeof ctx.model === 'string'
      ? ctx.model.trim()
      : typeof ctx.model_key === 'string'
        ? ctx.model_key.trim()
        : '';
  if (mk) s.ctx.onStreamModel?.(mk);
  s.activeAgentRunId = spineRunId || null;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(IAM_AGENT_RUN_CONTEXT, { detail: { id: spineRunId || null } }),
    );
  }
  patchIamAgentStreamDebug({
    context_event_at: Date.now(),
    context: { ...ctx },
  });
  return 'continue';
}
if (evType === 'runtime_context' && data && typeof data === 'object') {
  const rc = data as Record<string, unknown>;
  const mk =
    typeof rc.model === 'string'
      ? rc.model.trim()
      : typeof rc.model_key === 'string'
        ? rc.model_key.trim()
        : '';
  if (mk) s.ctx.onStreamModel?.(mk);
  return 'continue';
}
if (evType === 'error') {
  const d = data as { message?: string; error?: string; detail?: string; code?: string };
  if (d.code === 'agent_run_cancelled') {
    s.ctx.streamFinalizedRef.current = true;
    s.ctx.setIsLoading(false);
    return 'continue';
  }
  // Timeout / budget stops often emit error+done with zero tokens. Throwing here
  // drops `done` and leaves an empty assistant bubble (loading-game forever).
  const softCodes = new Set([
    'agent_run_timeout',
    'max_tool_calls_reached',
    'spend_cap_exceeded',
  ]);
  const partsErr = [d.message, d.error, d.detail].filter(Boolean);
  const errMsg = partsErr.join(' — ') || 'Agent stream error';
  if (softCodes.has(String(d.code || '')) && !s.assistantStreamBuf.trim()) {
    const visible =
      d.code === 'agent_run_timeout'
        ? 'I hit the run time limit before finishing a written answer. Prior tool results are still in the thread — ask me to continue from a specific hop.'
        : errMsg;
    s.assistantContent = visible;
    s.assistantStreamBuf = visible;
    s.ctx.setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: visible };
      else next.push({ role: 'assistant', content: visible });
      return next;
    });
    s.ctx.streamFinalizedRef.current = true;
    s.ctx.setIsLoading(false);
    return 'continue';
  }
  s.ctx.streamFinalizedRef.current = true;
  throw new Error(errMsg);
}
if (evType === 'done') {
  s.doneReceived = true;
  patchIamAgentStreamDebug({ done_at: Date.now(), done_received: true });
  if (!s.ctx.streamFinalizedRef.current) {
    s.ctx.streamFinalizedRef.current = true;
    s.ctx.setIsLoading(false);
  }
  // emailArtifactFromText: render email card from assistant text, no tool call needed
  try {
    const _subjMatch = s.assistantContent.match(/^subject[:\s]+(.+)$/im);
    if (_subjMatch && s.assistantContent.length > 100) {
      const _subj = _subjMatch[1].trim();
      const _subjLineEnd = s.assistantContent.indexOf(_subjMatch[0]) + _subjMatch[0].length;
      const _body = s.assistantContent.slice(_subjLineEnd).replace(/^[\n\r]+/, '').trim();
      const _toMatch = s.assistantContent.match(/^to[:\s]+([^\n]+)/im);
      const _to = _toMatch ? _toMatch[1].trim() : undefined;
      if (_body.length > 20) {
        s.ctx.setMessages((prev) => {
          const _last = [...prev];
          const _lm = _last[_last.length - 1];
          if (_lm && _lm.role === 'assistant' && !_lm.emailArtifact) {
            _last[_last.length - 1] = {
              ..._lm,
              emailArtifact: { subject: _subj, body: _body, to: _to },
            };
          }
          return _last;
        });
      }
    }
  } catch (_) { /* non-fatal */ }
  return 'continue';
}
if (s.ctx.streamFinalizedRef.current && evType === 'error') {
  return 'continue';
}

if (data && typeof data === 'object' && Array.isArray((data as { choices?: unknown }).choices)) {
  const ch0 = (data as { choices: Array<{ delta?: { content?: string | null; reasoning_content?: unknown } }> })
    .choices[0];
  const del = ch0?.delta;
  if (del) {
    if (del.reasoning_content) return 'continue';
    if (del.content === null) return 'continue';
  }
}
if (looksLikeRawProviderLeak(data)) {
  s.emptyRun += 1;
  return 'continue';
}
if (isStreamErrorPayload(data)) {
  s.ctx.streamFinalizedRef.current = true;
  const partsErr = [data.error, data.detail, data.provider, data.model].filter(Boolean);
  throw new Error(partsErr.join(' — '));
}
  return 'fallthrough';
}
