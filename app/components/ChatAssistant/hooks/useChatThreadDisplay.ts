/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Message list display flags + thread header visibility.
 */

import { useMemo } from 'react';
import type { Message } from '../types';
import type { AgentSessionRow } from '../../../agentSessionsCatalog';
import { isAgentSamEmptyThreadGreeting } from '../composerLayout';
import { findSessionRow } from '../components/AgentChatThreadHeader';
import type { ThinkingCardState } from '../../../src/components/ThinkingCard';

export function useChatThreadDisplay(args: {
  messages: Message[];
  thinkingState: ThinkingCardState | null;
  heroThinking: ThinkingCardState | null;
  isLoading: boolean;
  pendingToolApproval: unknown;
  isNarrow: boolean;
  presence: { state: string };
  mobileHubTab: string;
  mobileThreadTab: string;
  conversationId: string;
  sessions: AgentSessionRow[];
}) {
  const {
    messages, thinkingState, heroThinking, isLoading, pendingToolApproval, isNarrow,
    presence, mobileHubTab, mobileThreadTab, conversationId, sessions,
  } = args;
  const displayMessages = useMemo(() => messages, [messages]);

  const assistantStreaming = useMemo(() => {
    const last = displayMessages[displayMessages.length - 1];
    return last?.role === 'assistant' && typeof last.content === 'string' && last.content.trim().length > 0;
  }, [displayMessages]);

  const effectiveThinking = thinkingState ?? heroThinking;

  const showInlinePresence = useMemo(() => {
    if (!isLoading || !effectiveThinking) return false;
    if (effectiveThinking.status === 'done' || effectiveThinking.status === 'error') return false;
    if (assistantStreaming) return false;
    if (pendingToolApproval) return false;
    return (
      effectiveThinking.status === 'thinking' ||
      effectiveThinking.status === 'working' ||
      effectiveThinking.status === 'blocked'
    );
  }, [isLoading, effectiveThinking, assistantStreaming, pendingToolApproval]);

  const showHeaderPresence =
    isLoading && !showInlinePresence && !isNarrow && presence.state !== 'idle';

  const showEmptyThreadPlaceholder = useMemo(() => {
    if (displayMessages.length === 0) return true;
    return displayMessages.every(
      (m) => m.role === 'assistant' && isAgentSamEmptyThreadGreeting(m.content)
    );
  }, [displayMessages]);

  /** Phone `/dashboard/agent` empty thread — exclusive chrome owner (not AgentHome hero). */
  const mobileAgentHomeMode =
    isNarrow &&
    mobileHubTab === 'agents' &&
    mobileThreadTab === 'chat' &&
    showEmptyThreadPlaceholder &&
    !conversationId.trim();

  const activeSessionRow = useMemo(
    () => findSessionRow(sessions, conversationId),
    [sessions, conversationId],
  );

  const showThreadHeader = useMemo(() => {
    if (mobileAgentHomeMode) return false;
    if (showEmptyThreadPlaceholder && !conversationId.trim()) return false;
    return true;
  }, [mobileAgentHomeMode, showEmptyThreadPlaceholder, conversationId]);

  return {
    displayMessages, assistantStreaming, effectiveThinking, showInlinePresence,
    showHeaderPresence, showEmptyThreadPlaceholder, mobileAgentHomeMode,
    activeSessionRow, showThreadHeader,
  };
}
