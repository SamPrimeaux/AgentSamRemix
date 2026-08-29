/**
 * Window-event bridge for ChatAssistant (conversation change, compose, abort, quickstart).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect } from 'react';
import {
  IAM_AGENT_CHAT_COMPOSE,
  IAM_AGENT_CHAT_CONVERSATION_CHANGE,
  IAM_AGENT_CHAT_NEW_THREAD,
  IAM_AGENT_CHAT_UNBIND,
  IAM_AGENT_MOBILE_CODE_FOCUS,
  IAM_AGENT_RUN_CONTEXT,
  LS_AGENT_CHAT_CONVERSATION_ID,
  type AgentChatComposeDetail,
  type QuickstartThreadDetail,
} from '../../../agentChatConstants';
import { cancelAgentChatRun, IAM_AGENT_ABORT_LIVE_STREAM } from '../../../lib/cancelAgentChatRun';
import { takeProjectChatFiles } from '../../../lib/projectChatHandoff';
import { syncComposerTextareaHeight } from '../composerLayout';
import {
  COMPOSER_TEXTAREA_MAX_PX_NARROW,
  COMPOSER_TEXTAREA_MAX_PX_WIDE,
  isImageAttachmentFile,
} from '../types';
import { routingSendOptsFromDetail } from '../lib/chatRoutingSendOpts';

export function useChatWindowBridge(d: any) {
  const {
    abortControllerRef,
    streamReaderRef,
    setIsLoading,
    setThinkingState,
    setPresenceState,
    streamAgentRunIdRef,
    onAgentRunContext,
    isLoadingRef,
    setMobileThreadTab,
    setThreadTitle,
    setConversationId,
    resetFreshChatContext,
    conversationIdRef,
    onOpenCodeTab,
    handleSendRef,
    setAttachments,
    setPythonDraftHint,
    setInput,
    textareaRef,
    isNarrow,
  } = d;

  useEffect(() => {
    const abortLiveStream = () => {
      abortControllerRef.current?.abort();
      streamReaderRef.current?.cancel().catch(() => {});
      abortControllerRef.current = null;
      streamReaderRef.current = null;
      setIsLoading(false);
      setThinkingState?.(null);
      setPresenceState?.('idle');
      streamAgentRunIdRef.current = null;
      onAgentRunContext?.(null);
    };
    const onAbortLive = () => {
      abortLiveStream();
    };
    const onRunContext = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string | null }>).detail?.id;
      streamAgentRunIdRef.current =
        typeof id === 'string' && id.trim() ? id.trim() : null;
    };
    window.addEventListener(IAM_AGENT_ABORT_LIVE_STREAM, onAbortLive);
    window.addEventListener(IAM_AGENT_RUN_CONTEXT, onRunContext);

    const onExternal = (e: Event) => {
      const detail = (e as CustomEvent<{ id?: string | null; force?: boolean }>).detail;
      // Only explicit null clears the thread. Missing `id` (e.g. legacy `{}`) must not
      // abort a live stream — that caused POST /api/agent/chat → Canceled mid-hydrate.
      if (!detail || !('id' in detail)) return;
      const raw = detail.id;
      if (raw === null) {
        if (isLoadingRef.current) {
          cancelAgentChatRun(streamAgentRunIdRef.current, {
            conversationId: conversationIdRef.current || null,
          });
          abortLiveStream();
        }
        setMobileThreadTab('chat');
        setThreadTitle('New Chat');
        if (typeof localStorage !== 'undefined') localStorage.removeItem(LS_AGENT_CHAT_CONVERSATION_ID);
        setConversationId('');
        if (conversationIdRef) conversationIdRef.current = '';
        resetFreshChatContext();
        return;
      }
      if (typeof raw === 'string' && raw.trim()) {
        const id = raw.trim();
        const prev = conversationIdRef.current?.trim() || '';
        if (prev && prev === id && isLoadingRef.current) {
          setMobileThreadTab('chat');
          return;
        }
        if (prev && prev !== id && isLoadingRef.current) {
          cancelAgentChatRun(streamAgentRunIdRef.current, {
            conversationId: prev,
          });
          abortLiveStream();
        }
        setMobileThreadTab('chat');
        try {
          localStorage.setItem(LS_AGENT_CHAT_CONVERSATION_ID, id);
        } catch {
          /* ignore */
        }
        setConversationId(id);
      }
    };
    window.addEventListener(IAM_AGENT_CHAT_CONVERSATION_CHANGE, onExternal);

    const onUnbind = () => {
      if (isLoadingRef.current) {
        cancelAgentChatRun(streamAgentRunIdRef.current, {
          conversationId: conversationIdRef.current || null,
        });
        abortLiveStream();
      }
      setMobileThreadTab('chat');
      setThreadTitle('New Chat');
      if (typeof localStorage !== 'undefined') localStorage.removeItem(LS_AGENT_CHAT_CONVERSATION_ID);
      setConversationId('');
      if (conversationIdRef) conversationIdRef.current = '';
      resetFreshChatContext();
    };
    window.addEventListener(IAM_AGENT_CHAT_UNBIND, onUnbind);

    const onMobileCodeFocus = () => {
      onOpenCodeTab?.();
    };
    window.addEventListener(IAM_AGENT_MOBILE_CODE_FOCUS, onMobileCodeFocus);

    const onExternalSend = (e: Event) => {
      const detail = (e as CustomEvent<QuickstartThreadDetail>).detail;
      const msg = detail?.message?.trim();
      if (!msg) return;
      void handleSendRef.current(msg, routingSendOptsFromDetail(detail));
    };
    window.addEventListener('iam-agent-external-send', onExternalSend);

    const onNewThreadMessage = (e: Event) => {
      const detail = (e as CustomEvent<QuickstartThreadDetail>).detail;
      const msg = detail?.message?.trim();
      if (!msg) return;
      if (detail.ensureAgentPanel !== false) return;
      const handoffFiles = takeProjectChatFiles();
      if (handoffFiles.length) {
        setAttachments(
          handoffFiles.map((file: File) => {
            const isImg = isImageAttachmentFile(file);
            return {
              id: crypto.randomUUID(),
              file,
              type: isImg ? ('image' as const) : ('file' as const),
              previewUrl: isImg ? URL.createObjectURL(file) : null,
              agentAttachmentId: null,
              stageStatus: undefined,
              stageError: null,
            };
          }),
        );
      }
      setMobileThreadTab('chat');
      setThreadTitle('New Chat');
      setPythonDraftHint(null);
      queueMicrotask(() => {
        void handleSendRef.current(msg, routingSendOptsFromDetail(detail));
      });
    };
    window.addEventListener(IAM_AGENT_CHAT_NEW_THREAD, onNewThreadMessage);

    const onCompose = (e: Event) => {
      const detail = (e as CustomEvent<AgentChatComposeDetail>).detail;
      const msg = detail?.message ?? '';
      if (!msg) return;
      if (detail?.send) {
        void handleSendRef.current(msg.trim(), routingSendOptsFromDetail(detail as QuickstartThreadDetail));
        return;
      }
      setMobileThreadTab('chat');
      setInput(msg);
      const selStart = detail.selectionStart ?? msg.length;
      const selEnd = detail.selectionEnd ?? selStart;
      queueMicrotask(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        try {
          el.setSelectionRange(selStart, selEnd);
        } catch {
          /* ignore */
        }
        syncComposerTextareaHeight(
          el,
          isNarrow ? COMPOSER_TEXTAREA_MAX_PX_NARROW : COMPOSER_TEXTAREA_MAX_PX_WIDE,
        );
      });
    };
    window.addEventListener(IAM_AGENT_CHAT_COMPOSE, onCompose);

    return () => {
      window.removeEventListener(IAM_AGENT_CHAT_CONVERSATION_CHANGE, onExternal);
      window.removeEventListener(IAM_AGENT_CHAT_UNBIND, onUnbind);
      window.removeEventListener(IAM_AGENT_ABORT_LIVE_STREAM, onAbortLive);
      window.removeEventListener(IAM_AGENT_RUN_CONTEXT, onRunContext);
      window.removeEventListener(IAM_AGENT_MOBILE_CODE_FOCUS, onMobileCodeFocus);
      window.removeEventListener('iam-agent-external-send', onExternalSend);
      window.removeEventListener(IAM_AGENT_CHAT_NEW_THREAD, onNewThreadMessage);
      window.removeEventListener(IAM_AGENT_CHAT_COMPOSE, onCompose);
    };
  }, [isNarrow, resetFreshChatContext, onOpenCodeTab, onAgentRunContext]);
}
