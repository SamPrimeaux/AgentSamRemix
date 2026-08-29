/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Thread title sync, autoscroll, composer input change.
 */

import {
  useEffect, type ChangeEvent, type Dispatch, type RefObject, type SetStateAction,
} from 'react';
import type { AgentSessionRow } from '../../../agentSessionsCatalog';
import {
  deriveAgentChatTitleFromMessage,
  isPlaceholderAgentChatTitle,
  sessionDisplayTitle,
} from '../../../agentSessionsCatalog';
import { isUnboundAgentChatPath } from '../../../lib/agentConversationBind';
import { syncComposerTextareaHeight } from '../composerLayout';
import { COMPOSER_TEXTAREA_MAX_PX_NARROW, COMPOSER_TEXTAREA_MAX_PX_WIDE } from '../types';
import type { Message } from '../types';

function firstUserMessageTitle(messages: Message[]): string {
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const raw = String(m.content || '').trim();
    if (!raw) continue;
    const derived = deriveAgentChatTitleFromMessage(raw);
    if (derived && !isPlaceholderAgentChatTitle(derived)) return derived;
  }
  return '';
}

export function useChatComposerInput(args: {
  conversationId: string;
  sessions: AgentSessionRow[];
  setThreadTitle: Dispatch<SetStateAction<string>>;
  scrollRef: RefObject<HTMLDivElement | null>;
  displayMessages: Message[];
  setInput: Dispatch<SetStateAction<string>>;
  isNarrow: boolean;
  syncPickers: (value: string, cursor: number) => void;
}) {
  const {
    conversationId, sessions, setThreadTitle, scrollRef, displayMessages,
    setInput, isNarrow, syncPickers,
  } = args;

  // D1 list / single-session hydrate — SSOT for durable titles (not DO/R2).
  useEffect(() => {
    if (!conversationId.trim()) return;
    if (
      typeof window !== 'undefined' &&
      isUnboundAgentChatPath(window.location.pathname, window.location.search)
    ) {
      return;
    }
    const row = sessions.find((s) => s.id === conversationId || s.conversation_id === conversationId);
    const fromList = row ? sessionDisplayTitle(row) : '';
    if (fromList && !isPlaceholderAgentChatTitle(fromList)) {
      setThreadTitle(fromList);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/agent/sessions/${encodeURIComponent(conversationId)}`, {
          credentials: 'same-origin',
        });
        if (!r.ok || cancelled) return;
        const data = (await r.json()) as AgentSessionRow;
        const n = sessionDisplayTitle(data);
        if (!n || isPlaceholderAgentChatTitle(n) || cancelled) return;
        setThreadTitle(n);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, sessions, setThreadTitle]);

  // First user bubble — optimistic fallback while D1 list/GET catches up.
  useEffect(() => {
    if (!conversationId.trim()) return;
    const fromMsg = firstUserMessageTitle(displayMessages);
    if (!fromMsg) return;
    setThreadTitle((prev) => {
      const cur = String(prev || '').trim();
      if (cur && !isPlaceholderAgentChatTitle(cur)) return prev;
      return fromMsg;
    });
  }, [conversationId, displayMessages, setThreadTitle]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displayMessages]);

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setInput(v);
    const el = e.target;
    const maxPx = isNarrow ? COMPOSER_TEXTAREA_MAX_PX_NARROW : COMPOSER_TEXTAREA_MAX_PX_WIDE;
    syncComposerTextareaHeight(el, maxPx);
    syncPickers(v, el.selectionStart);
  };

  return { handleInputChange };
}
