/**
 * Fetch + SSE consume for chat send (peel A2 split).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { consumeAgentChatSseBody, type AgentHandoffPayload } from './useAgentChatStream';
import { initIamAgentStreamDebug, patchIamAgentStreamDebug } from '../streamDebug';
import { formatHttpErrorMessage } from '../streamParsing';
import { synthesizeUserVisibleAgentFailure } from '../../../shared/agent-runtime/user-visible-agent-error.js';
import {
  parseAndDispatchDatabaseStudioActions,
  tryDispatchDbApplyFromAssistantMessage,
} from '../../../src/lib/databaseStudioEvents';
import { LS_AGENT_CHAT_CONVERSATION_ID } from '../../../agentChatConstants';

export async function executeChatSendStream(ctx: any): Promise<void> {
  const {
    form, signal, sendWorkspaceId, sendToSplitChild,
    setSplitChildMessages, setMessages, setIsLoading, setWorkflowLedger, setToolTraceRows,
    handlePythonDraftOpened, setConversationId, stripEmptyAssistantTail, loadSessions,
    onBrowserNavigate, onR2FileUpdated, handleThinkingEvent, handleSubagentEvent,
    onAgentRunContext, handleStreamModel, onFileSelect, setPendingToolApproval,
    onVoiceResponse,
    streamFinalizedRef, abortControllerRef, streamReaderRef, handleSendRef,
    setPresenceState, setThinkingState, clearAttachments, setBrowserElementContext, messagesRef,
    databaseSurfaceRef, agentsamPolicy, messageQueue, setMessageQueue,
  } = ctx;

  const applyAssistantError = (msg: string) => {
    setMessages((prev) => [...stripEmptyAssistantTail(prev), { role: 'assistant', content: msg }]);
  };

  try {
    const streamDebugId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `dbg_${Date.now()}`;
    initIamAgentStreamDebug(streamDebugId);
    const chatHeaders: Record<string, string> = {};
    if (sendWorkspaceId) chatHeaders['x-iam-workspace-id'] = sendWorkspaceId;

    const response = await fetch('/api/agent/chat', {
      method: 'POST',
      body: form,
      headers: chatHeaders,
      signal,
      credentials: 'same-origin',
    });

    patchIamAgentStreamDebug({
      response_headers_at: Date.now(),
      http_status: response.status,
    });

    if (!response.ok) {
      patchIamAgentStreamDebug({
        error_at: Date.now(),
      });
      const errBody = await response.text().catch(() => '');
      applyAssistantError(formatHttpErrorMessage(response.status, errBody || response.statusText || ''));
      return;
    }
    if (!response.body) {
      patchIamAgentStreamDebug({
        error_at: Date.now(),
      });
      applyAssistantError('Empty response body from chat endpoint');
      return;
    }

    const reader = response.body.getReader();
    streamReaderRef.current = reader;
    // Mutable box so TS does not treat post-await reads as still-null (callback CFA).
    const handoffResumeBox: { value: AgentHandoffPayload | null } = { value: null };
    const assistantText = await consumeAgentChatSseBody({
      signal,
      reader,
      streamFinalizedRef,
      streamReaderRef,
      setMessages: sendToSplitChild ? setSplitChildMessages : setMessages,
      setIsLoading,
      setWorkflowLedger,
      setToolTraceRows,
      onPythonDraftOpened: handlePythonDraftOpened,
      setConversationId: sendToSplitChild ? () => {} : setConversationId,
      stripEmptyAssistantTail,
      loadSessions,
      onBrowserNavigate,
      onR2FileUpdated,
      onThinkingEvent: handleThinkingEvent,
      onSubagentEvent: handleSubagentEvent,
      onAgentRunContext,
      onStreamModel: handleStreamModel,
      onFileSelect: onFileSelect
        ? (f) => onFileSelect({ name: f.name, content: f.content, originalContent: f.originalContent ?? '' })
        : undefined,
      onAgentHandoff: (payload: AgentHandoffPayload) => {
        handoffResumeBox.value = payload;
      },
      onToolApprovalRequest: (tool) => {
        setPendingToolApproval({ tool });
        setIsLoading(false);
        streamFinalizedRef.current = true;
        abortControllerRef.current = null;
      },
    });
    streamReaderRef.current = null;
    if (onVoiceResponse && assistantText?.trim()) {
      await onVoiceResponse(assistantText);
    }
    // Read fields via optional chaining — avoid CFA narrowing the box value to never.
    const childSession = handoffResumeBox.value?.next_session_id?.trim() || '';
    const fallbackModel = handoffResumeBox.value?.fallback_model_key?.trim();
    if (childSession) {
      setConversationId(childSession);
      try {
        localStorage.setItem(LS_AGENT_CHAT_CONVERSATION_ID, childSession);
      } catch {
        /* ignore */
      }
      streamFinalizedRef.current = false;
      abortControllerRef.current = new AbortController();
      await handleSendRef.current('Continue', {
        conversationIdOverride: childSession,
        handoffResume: true,
        ...(fallbackModel ? { modelKey: fallbackModel } : {}),
      });
      return;
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      patchIamAgentStreamDebug({ abort_at: Date.now() });
      setThinkingState?.(null);
      const stoppedByUser = Boolean(streamFinalizedRef?.current);
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant') {
          const hadTokens = Boolean(last.content?.trim());
          next[next.length - 1] = {
            ...last,
            content: hadTokens
              ? `${last.content}\n\nStopped.`
              : stoppedByUser
                ? 'Stopped.'
                : 'Connection dropped before a reply (stream aborted). Send again — if it keeps happening, hard-refresh.',
          };
        }
        return next;
      });
    } else {
      console.error('Chat request failed:', error);
      streamFinalizedRef.current = true;
      const rawMsg = error instanceof Error ? error.message : String(error);
      const msg = synthesizeUserVisibleAgentFailure(rawMsg);
      patchIamAgentStreamDebug({ error_at: Date.now() });
      setMessages((prev) => [...stripEmptyAssistantTail(prev), { role: 'assistant', content: msg }]);
    }
  } finally {
    streamReaderRef.current?.cancel().catch(() => {});
    streamReaderRef.current = null;
    setIsLoading(false);
    setThinkingState?.(null);
    setPresenceState('idle');
    clearAttachments();
    setBrowserElementContext(null);
    abortControllerRef.current = null;

    const lastMsg = messagesRef.current[messagesRef.current.length - 1];
    if (lastMsg?.role === 'assistant' && typeof lastMsg.content === 'string') {
      const ds =
        databaseSurfaceRef.current?.datasource === 'supabase' ? 'supabase' : 'd1';
      const isSa = agentsamPolicy?.is_superadmin === true || agentsamPolicy?.is_superadmin === 1;
      const activeDatasourceBinding =
        databaseSurfaceRef.current?.datasource_binding != null
          ? String(databaseSurfaceRef.current.datasource_binding).trim()
          : null;
      parseAndDispatchDatabaseStudioActions(lastMsg.content, {
        datasource: ds,
        isSuperadmin: isSa,
        activeDatasourceBinding,
      });
      tryDispatchDbApplyFromAssistantMessage(lastMsg.content, {
        datasource: ds,
        isSuperadmin: isSa,
        activeDatasourceBinding,
      });
    }

    // Never auto-drain the queue after Stop/abort — that re-armed Working and made Stop look dead.
    if (!signal?.aborted && messageQueue.length > 0) {
      const next = messageQueue[0];
      setMessageQueue((prev) => prev.slice(1));
      void handleSendRef.current(next);
    }
  }
}
