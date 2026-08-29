/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sessions list, chat projects bind, fresh-thread reset / new chat.
 * Peel A1 — mechanical extract from ChatAssistant.tsx.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AgentSessionRow } from '../../../agentSessionsCatalog';
import type { AgentChatProjectOption } from '../../../hooks/useAgentChatSessions';
import {
  IAM_AGENT_CHAT_CONVERSATION_CHANGE,
  LS_AGENT_CHAT_CONVERSATION_ID,
} from '../../../agentChatConstants';
import { applyFreshChatSessionDefaults } from '../../../src/lib/freshChatSession';
import { clearPendingProjectBind } from '../../../lib/pendingProjectBind';
import { chatGithubContextStorageKey } from '../types';
import { readDockExecLane } from '../../../src/lib/execLane';
import { startNewAgentChat } from '../../../lib/openAgentConversation';
import {
  hostSyncShouldClearConversationId,
  isUnboundAgentChatPath,
  sendIdAfterUnboundHostSync,
} from '../../../lib/agentConversationBind';

export type UseChatSessionProjectArgs = {
  conversationId: string;
  setConversationId: Dispatch<SetStateAction<string>>;
  sessionUserId: string | null | undefined;
  effectiveWsId: string | null;
  composerSourcesKey: string;
  onAgentChatShellNewTab?: () => void;
  syncedHostConversationId?: string | null;
  clearGithubState: () => void;
  setAttachments: Dispatch<SetStateAction<any>>;
  setComposerSources: Dispatch<SetStateAction<any>>;
  setExecLane: Dispatch<SetStateAction<any>>;
  setMobileThreadTab: Dispatch<SetStateAction<'chat' | 'context'>>;
  setThreadTitle: Dispatch<SetStateAction<string>>;
  setPythonDraftHint: Dispatch<SetStateAction<string | null>>;
};

export function useChatSessionProject(args: UseChatSessionProjectArgs) {
  const {
    conversationId,
    setConversationId,
    sessionUserId,
    effectiveWsId,
    composerSourcesKey,
    onAgentChatShellNewTab,
    syncedHostConversationId,
    clearGithubState,
    setAttachments,
    setComposerSources,
    setExecLane,
    setMobileThreadTab,
    setThreadTitle,
    setPythonDraftHint,
  } = args;

  const [chatProjects, setChatProjects] = useState<AgentChatProjectOption[]>([]);
  const projectsLoadInFlightRef = useRef<Promise<void> | null>(null);
  const projectsLoadedWorkspaceRef = useRef<string | null>(null);

  const [sessions, setSessions] = useState<AgentSessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const hydratedFromLsRef = useRef(false);
  const sessionsLoadInFlightRef = useRef<Promise<void> | null>(null);
  const prevHostConversationIdRef = useRef<string | null>(null);
  const conversationPinRef = useRef(conversationId);
  conversationPinRef.current = conversationId;

  const loadSessions = useCallback(async () => {
    if (sessionsLoadInFlightRef.current) return sessionsLoadInFlightRef.current;
    const run = (async () => {
      setSessionsLoading(true);
      try {
        const pin = String(conversationPinRef.current || '').trim();
        const q = new URLSearchParams({ limit: '40' });
        if (pin) q.set('pin', pin);
        const r = await fetch(`/api/agent/sessions?${q}`, { credentials: 'same-origin' });
        const data = r.ok ? await r.json() : [];
        setSessions(Array.isArray(data) ? (data as AgentSessionRow[]) : []);
      } catch {
        setSessions([]);
      } finally {
        setSessionsLoading(false);
      }
    })();
    sessionsLoadInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (sessionsLoadInFlightRef.current === run) sessionsLoadInFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // D1 sticky project_id is server truth for an existing conversation.
  // Do not mirror it into sessionStorage — that re-armed ambient pins across New chat.

  useEffect(() => {
    const wsKey = String(effectiveWsId || '').trim() || '__default__';
    if (projectsLoadedWorkspaceRef.current === wsKey) return;
    if (projectsLoadInFlightRef.current) return;
    const run = (async () => {
      try {
        const r = await fetch('/api/projects', { credentials: 'same-origin' });
        const rows = r.ok ? await r.json() : [];
        const list = Array.isArray(rows) ? rows : rows?.projects || [];
        setChatProjects(
          list
            .map((p: { id?: string; name?: string; chat_project_id?: string | null }) => ({
              id: String(p.id || '').trim(),
              name: String(p.name || 'Project').trim(),
              chat_project_id: p.chat_project_id ?? null,
            }))
            .filter((p: AgentChatProjectOption) => p.id),
        );
        projectsLoadedWorkspaceRef.current = wsKey;
      } catch {
        setChatProjects([]);
      }
    })();
    projectsLoadInFlightRef.current = run;
    void run.finally(() => {
      if (projectsLoadInFlightRef.current === run) projectsLoadInFlightRef.current = null;
    });
  }, [effectiveWsId]);


  useEffect(() => {
    if (typeof window === 'undefined' || hydratedFromLsRef.current) return;
    hydratedFromLsRef.current = true;
    if (onAgentChatShellNewTab) {
      return;
    }
    const id = localStorage.getItem(LS_AGENT_CHAT_CONVERSATION_ID)?.trim();
    if (id) {
      queueMicrotask(() => {
        window.dispatchEvent(
          new CustomEvent(IAM_AGENT_CHAT_CONVERSATION_CHANGE, { detail: { id } })
        );
      });
    }
  }, [onAgentChatShellNewTab]);

  useEffect(() => {
    if (typeof syncedHostConversationId !== 'string') return;
    const nextId = syncedHostConversationId.trim();
    const prevHost = prevHostConversationIdRef.current;
    prevHostConversationIdRef.current = nextId;
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    const search = typeof window !== 'undefined' ? window.location.search : '';

    // URL is unbound (/agent/new or atmospheric home): never re-read the still-active
    // host conversation. Child effects run before the parent tab-clear; that re-attach
    // is why New Agent kept POSTing the prior conversation_id.
    if (isUnboundAgentChatPath(pathname, search)) {
      if (nextId) {
        setConversationId((cur) => sendIdAfterUnboundHostSync(nextId, String(cur || '')));
        setThreadTitle('New Chat');
        try {
          const ls = localStorage.getItem(LS_AGENT_CHAT_CONVERSATION_ID)?.trim() || '';
          if (!ls || ls === nextId) localStorage.removeItem(LS_AGENT_CHAT_CONVERSATION_ID);
        } catch {
          /* ignore */
        }
      }
      return;
    }

    if (nextId) {
      setConversationId(nextId);
      try {
        localStorage.setItem(LS_AGENT_CHAT_CONVERSATION_ID, nextId);
      } catch {
        /* ignore */
      }
      return;
    }
    // Empty host is a no-op unless we just left a bound thread (New Agent / unbound tab).
    // Empty→empty must not wipe a UUID ChatAssistant minted on first send before the tab catches up.
    if (hostSyncShouldClearConversationId(prevHost, nextId)) {
      setConversationId('');
      setThreadTitle('New Chat');
      try {
        localStorage.removeItem(LS_AGENT_CHAT_CONVERSATION_ID);
      } catch {
        /* ignore */
      }
    }
  }, [syncedHostConversationId, setConversationId, setThreadTitle]);

  const resetFreshChatContext = useCallback(() => {
    applyFreshChatSessionDefaults({
      composerSourcesKey,
      githubContextStorageKey: chatGithubContextStorageKey(sessionUserId, effectiveWsId, ''),
      onClearGithubState: clearGithubState,
      onClearAttachments: () => setAttachments([]),
    });
    clearPendingProjectBind();
    setComposerSources([]);
    const wid = String(effectiveWsId || '').trim();
    if (wid) {
      try {
        setExecLane(readDockExecLane(wid));
      } catch {
        setExecLane(null);
      }
    } else {
      setExecLane(null);
    }
  }, [composerSourcesKey, sessionUserId, effectiveWsId, clearGithubState, setAttachments, setComposerSources, setExecLane]);

  const handleNewChat = useCallback(() => {
    setMobileThreadTab('chat');
    setThreadTitle('New Chat');
    setPythonDraftHint(null);
    setConversationId('');
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LS_AGENT_CHAT_CONVERSATION_ID);
    resetFreshChatContext();
    // Same path as sidebar "New chat": create unbound tab + navigate to /agent/new.
    // Calling onAgentChatShellNewTab alone left the URL on /agent/{oldUuid} so the
    // path hydrator / host sync re-read the active conversation after reset.
    startNewAgentChat();
    if (!onAgentChatShellNewTab) {
      window.dispatchEvent(new CustomEvent(IAM_AGENT_CHAT_CONVERSATION_CHANGE, { detail: { id: null } }));
    }
  }, [onAgentChatShellNewTab, resetFreshChatContext, setConversationId]);

  return {
    chatProjects,
    sessions,
    sessionsLoading,
    loadSessions,
    setSessions,
    resetFreshChatContext,
    handleNewChat,
  };
}
