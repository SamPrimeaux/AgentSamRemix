/** App shell agent chat tabs — hydrate / select / close (Wave 2 E4). */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { Message } from '../components/ChatAssistant/types';
import {
  IAM_AGENT_CHAT_CONVERSATION_CHANGE,
  IAM_AGENT_CHAT_UNBIND,
  IAM_AGENT_SYNC_CONVERSATION_URL,
  LS_AGENT_CHAT_CONVERSATION_ID,
} from '../agentChatConstants';
import {
  type AgentChatTabRow,
  newAgentChatTabId,
  freshAgentGreetingMessages,
} from '../lib/appAgentChatTabUtils';
import {
  agentConversationPath,
  isAgentAtmosphericHome,
  isAgentEditorPath,
  isAgentNewChatPath,
  isAgentShellPath,
  isContextPreservingAgentRailPath,
  normalizePath,
  parseAgentConversationIdFromPath,
} from '../lib/agentRoutes';
import {
  openAgentConversation,
  persistAgentConversationId,
} from '../lib/openAgentConversation';
import {
  agentTabMessagesNeedHydration,
  fetchAgentSessionMessages,
} from '../lib/mapAgentSessionMessages';
import { writeSessionProject } from '../src/lib/freshChatSession';
import { clearPendingProjectBind } from '../lib/pendingProjectBind';
import { SS_AGENT_CHAT_MESSAGES } from '../src/lib/sessionStorageKeys';
import { isCmsEditorFullscreenRoute } from '../pages/cms/cmsRoute';
import type { AgentPanelPosition } from './useAppPanelLayout';

export type { AgentChatTabRow } from '../lib/appAgentChatTabUtils';

export function useAppAgentChatTabs(opts: {
  workspaceDisplayLine: string;
  pathname: string;
  search: string;
  navigate: NavigateFunction;
  maxTabsPolicyRef: React.MutableRefObject<number>;
  agentIsStreamingRef: React.MutableRefObject<boolean>;
  cancelLiveAgentStreamIfAny: () => void;
  setToastMsg: React.Dispatch<React.SetStateAction<string | null>>;
  setAgentPosition: React.Dispatch<React.SetStateAction<AgentPanelPosition>>;
}) {
  const {
    workspaceDisplayLine,
    pathname,
    search,
    navigate,
    maxTabsPolicyRef,
    agentIsStreamingRef,
    cancelLiveAgentStreamIfAny,
    setToastMsg,
    setAgentPosition,
  } = opts;

  const stableAgentChatTabId = useMemo(() => newAgentChatTabId(), []);

  /**
   * Bare `/dashboard/agent` and `/new` must open unbound (atmospheric home).
   * Sticky LS conversation restore is editor-only; deep links use `/agent/:id`.
   */
  const [agentChatTabs, setAgentChatTabs] = useState<AgentChatTabRow[]>(() => {
    let persisted = '';
    if (typeof window !== 'undefined') {
      const fromPath = parseAgentConversationIdFromPath(window.location.pathname);
      if (fromPath) {
        persisted = fromPath;
      } else if (isAgentEditorPath(window.location.pathname)) {
        try {
          persisted = localStorage.getItem(LS_AGENT_CHAT_CONVERSATION_ID)?.trim() || '';
        } catch {
          /* ignore */
        }
      }
    }
    return [
      {
        id: stableAgentChatTabId,
        conversationId: persisted,
        title: persisted ? 'Chat' : 'New chat',
      },
    ];
  });
  const [activeAgentChatTabId, setActiveAgentChatTabId] = useState(() => stableAgentChatTabId);
  const [messagesByTabId, setMessagesByTabId] = useState<Record<string, Message[]>>(() => {
    const allowSessionRestore =
      typeof window !== 'undefined' &&
      (Boolean(parseAgentConversationIdFromPath(window.location.pathname)) ||
        isAgentEditorPath(window.location.pathname));
    if (allowSessionRestore) {
      try {
        const raw =
          typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(SS_AGENT_CHAT_MESSAGES) : null;
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, Message[]>;
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) return parsed;
        }
      } catch {
        /* ignore */
      }
    }
    return { [stableAgentChatTabId]: freshAgentGreetingMessages() };
  });

  const activeAgentConversationId = useMemo(
    () => agentChatTabs.find((t) => t.id === activeAgentChatTabId)?.conversationId?.trim() ?? '',
    [agentChatTabs, activeAgentChatTabId],
  );

  const agentChatTabsRef = useRef(agentChatTabs);
  const activeAgentChatTabIdRef = useRef(activeAgentChatTabId);
  const messagesByTabIdRef = useRef(messagesByTabId);
  agentChatTabsRef.current = agentChatTabs;
  activeAgentChatTabIdRef.current = activeAgentChatTabId;
  messagesByTabIdRef.current = messagesByTabId;

  const messageHydrateGenRef = useRef(0);
  const pathHydratedConvRef = useRef<string | null>(null);
  const createNewAgentChatTabRef = useRef<(() => void) | null>(null);

  const chatMessages = useMemo(() => {
    return (
      messagesByTabId[activeAgentChatTabId] ?? freshAgentGreetingMessages(workspaceDisplayLine)
    );
  }, [messagesByTabId, activeAgentChatTabId, workspaceDisplayLine]);

  const setChatMessages = useCallback(
    (updater: React.SetStateAction<Message[]>) => {
      setMessagesByTabId((prev) => {
        const cur =
          prev[activeAgentChatTabId] ?? freshAgentGreetingMessages(workspaceDisplayLine);
        const next = typeof updater === 'function' ? updater(cur as Message[]) : updater;
        return { ...prev, [activeAgentChatTabId]: next };
      });
    },
    [activeAgentChatTabId, workspaceDisplayLine],
  );

  useEffect(() => {
    setMessagesByTabId((prev) => {
      const cur = prev[activeAgentChatTabId];
      if (!cur || cur.length !== 1 || cur[0].role !== 'assistant') return prev;
      const next = freshAgentGreetingMessages(workspaceDisplayLine)[0].content;
      if (cur[0].content === next) return prev;
      return { ...prev, [activeAgentChatTabId]: freshAgentGreetingMessages(workspaceDisplayLine) };
    });
  }, [workspaceDisplayLine, activeAgentChatTabId]);

  useEffect(() => {
    try {
      const TRIM_THRESHOLD = 200;
      const trimmed = Object.fromEntries(
        Object.entries(messagesByTabId).map(([k, v]) => [k, v.slice(-TRIM_THRESHOLD)]),
      );
      sessionStorage.setItem(SS_AGENT_CHAT_MESSAGES, JSON.stringify(trimmed));
    } catch {
      /* quota or SSR — ignore */
    }
  }, [messagesByTabId]);

  const hydrateAgentTabMessages = useCallback(
    async (tabId: string, convId: string, force = false) => {
      const tid = String(tabId || '').trim();
      const cid = String(convId || '').trim();
      if (!tid || !cid) return;

      const existing = messagesByTabIdRef.current[tid];
      if (!force && !agentTabMessagesNeedHydration(existing, { hasConversationId: true })) return;

      const gen = ++messageHydrateGenRef.current;
      setMessagesByTabId((prev) => ({
        ...prev,
        [tid]: [{ role: 'assistant' as const, content: 'Loading conversation…' }],
      }));

      try {
        const mapped = await fetchAgentSessionMessages(cid);
        if (messageHydrateGenRef.current !== gen) return;
        if (!mapped.length) {
          // Allow a later force-open / path revisit to retry (do not sticky-lock empty).
          if (pathHydratedConvRef.current === cid) pathHydratedConvRef.current = null;
          setMessagesByTabId((prev) => ({
            ...prev,
            [tid]: freshAgentGreetingMessages(workspaceDisplayLine),
          }));
          return;
        }
        setMessagesByTabId((prev) => ({ ...prev, [tid]: mapped }));
      } catch {
        if (messageHydrateGenRef.current !== gen) return;
        if (pathHydratedConvRef.current === cid) pathHydratedConvRef.current = null;
        setMessagesByTabId((prev) => ({
          ...prev,
          [tid]: freshAgentGreetingMessages(workspaceDisplayLine),
        }));
      }
    },
    [workspaceDisplayLine],
  );

  useEffect(() => {
    const convId = parseAgentConversationIdFromPath(pathname);
    if (!convId || !isAgentShellPath(pathname)) {
      pathHydratedConvRef.current = null;
      return;
    }
    if (pathHydratedConvRef.current === convId) return;

    const act = activeAgentChatTabIdRef.current;
    const activeConv =
      agentChatTabsRef.current.find((t) => t.id === act)?.conversationId?.trim() || '';
    const activeMsgs = messagesByTabIdRef.current[act] || [];

    // First-send URL sync: tab is still unbound (or already this id) while SSE is live.
    // openAgentConversation({ force: true }) used to cancel the POST and replace the
    // optimistic user bubble with "Loading conversation…".
    if (agentIsStreamingRef.current && (!activeConv || activeConv === convId)) {
      pathHydratedConvRef.current = convId;
      persistAgentConversationId(convId);
      if (!activeConv) {
        setAgentChatTabs((prev) =>
          prev.map((t) => (t.id === act ? { ...t, conversationId: convId, title: t.title || 'Chat' } : t)),
        );
      }
      return;
    }

    pathHydratedConvRef.current = convId;
    setAgentPosition('off');
    persistAgentConversationId(convId);
    // Deep-link / refresh: never leave the shell tab stuck on placeholder "Chat".
    void fetch(`/api/agent/sessions/${encodeURIComponent(convId)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        const title =
          row && typeof row.title === 'string'
            ? String(row.title).replace(/\s+/g, ' ').trim()
            : '';
        if (!title || title.toLowerCase() === 'chat' || title.toLowerCase() === 'new chat') return;
        setAgentChatTabs((prev) =>
          prev.map((t) =>
            t.conversationId === convId || (!t.conversationId && t.id === activeAgentChatTabIdRef.current)
              ? { ...t, conversationId: convId, title }
              : t,
          ),
        );
      })
      .catch(() => {});
    if (activeConv === convId) {
      if (agentIsStreamingRef.current) return;
      if (!agentTabMessagesNeedHydration(activeMsgs, { hasConversationId: true })) return;
    } else if (agentIsStreamingRef.current) {
      cancelLiveAgentStreamIfAny();
    }
    openAgentConversation({ id: convId, force: true, ensureAgentPanel: false });
  }, [pathname, cancelLiveAgentStreamIfAny, agentIsStreamingRef, setAgentPosition]);

  // Bare `/dashboard/agent` (+ `/new`) is atmospheric home — never keep a sticky past thread.
  // Path/search only: do not re-run on workspaceDisplayLine (would race first-send before URL sync).
  useEffect(() => {
    if (!isAgentAtmosphericHome(pathname, search) && !isAgentNewChatPath(pathname)) return;
    try {
      localStorage.removeItem(LS_AGENT_CHAT_CONVERSATION_ID);
    } catch {
      /* ignore */
    }
    // First send on /new: tab conversationId is still empty while ChatAssistant has a minted
    // UUID and SSE is live. Do not abort that turn or replace the optimistic bubble.
    if (agentIsStreamingRef.current) return;
    // Tab may already be empty while ChatAssistant still holds the prior send id
    // (Code → Agent navigates here without createNewAgentChatTab). Always unbind.
    window.dispatchEvent(new CustomEvent(IAM_AGENT_CHAT_UNBIND));
    const tid = activeAgentChatTabIdRef.current;
    const cur =
      agentChatTabsRef.current.find((t) => t.id === tid)?.conversationId?.trim() || '';
    cancelLiveAgentStreamIfAny();
    if (!cur) return;
    setAgentChatTabs((prev) =>
      prev.map((t) => (t.id === tid ? { ...t, conversationId: '', title: 'New chat' } : t)),
    );
    setMessagesByTabId((prev) => ({
      ...prev,
      [tid]: freshAgentGreetingMessages(workspaceDisplayLine),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- path entry only
  }, [pathname, search, cancelLiveAgentStreamIfAny, agentIsStreamingRef]);

  useEffect(() => {
    if (!isAgentEditorPath(pathname)) return;
    let lsId = '';
    try {
      lsId = localStorage.getItem(LS_AGENT_CHAT_CONVERSATION_ID)?.trim() || '';
    } catch {
      lsId = '';
    }
    if (!lsId) return;
    const activeConv =
      agentChatTabsRef.current
        .find((t) => t.id === activeAgentChatTabIdRef.current)
        ?.conversationId?.trim() || '';
    const activeMsgs = messagesByTabIdRef.current[activeAgentChatTabIdRef.current] || [];
    if (agentIsStreamingRef.current) return;
    if (
      activeConv === lsId &&
      !agentTabMessagesNeedHydration(activeMsgs, { hasConversationId: true })
    ) {
      return;
    }
    if (pathHydratedConvRef.current === `editor:${lsId}`) return;
    pathHydratedConvRef.current = `editor:${lsId}`;
    openAgentConversation({ id: lsId, force: true, ensureAgentPanel: false });
  }, [pathname, agentIsStreamingRef]);

  useEffect(() => {
    const onSyncUrl = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id?.trim();
      if (!id) return;
      if (isCmsEditorFullscreenRoute(pathname, new URLSearchParams(search))) {
        return;
      }
      if (isAgentEditorPath(pathname) || isContextPreservingAgentRailPath(pathname)) {
        try {
          localStorage.setItem(LS_AGENT_CHAT_CONVERSATION_ID, id);
        } catch {
          /* ignore */
        }
        return;
      }
      const next = agentConversationPath(id);
      if (normalizePath(pathname) === normalizePath(next)) return;
      navigate(next, { replace: true });
    };
    window.addEventListener(IAM_AGENT_SYNC_CONVERSATION_URL, onSyncUrl);
    return () => window.removeEventListener(IAM_AGENT_SYNC_CONVERSATION_URL, onSyncUrl);
  }, [navigate, pathname, search]);

  useEffect(() => {
    const onConv = (e: Event) => {
      const detail = (e as CustomEvent<{ id?: string | null; force?: boolean; title?: string }>)
        .detail;
      // Explicit null only — ignore events without an `id` key (sessions-refresh used to
      // fire `{}` here and wipe the tab + cancel the live SSE).
      if (!detail || !('id' in detail)) return;
      const raw = detail.id;

      if (raw === null) {
        cancelLiveAgentStreamIfAny();
        const tid = activeAgentChatTabIdRef.current;
        setAgentChatTabs((prev) =>
          prev.map((t) => (t.id === tid ? { ...t, conversationId: '', title: 'New chat' } : t)),
        );
        try {
          localStorage.removeItem(LS_AGENT_CHAT_CONVERSATION_ID);
        } catch {
          /* ignore */
        }
        setMessagesByTabId((prev) => ({
          ...prev,
          [tid]: freshAgentGreetingMessages(workspaceDisplayLine),
        }));
        return;
      }

      const convId = typeof raw === 'string' ? raw.trim() : '';
      if (!convId) return;

      try {
        localStorage.setItem(LS_AGENT_CHAT_CONVERSATION_ID, convId);
      } catch {
        /* ignore */
      }

      const sessionTitle = typeof detail?.title === 'string' ? detail.title.trim() : '';
      let forceReload = detail?.force === true;

      const prevTabs = agentChatTabsRef.current;
      const act = activeAgentChatTabIdRef.current;
      const activeConv = prevTabs.find((t) => t.id === act)?.conversationId?.trim() || '';
      const byConv = prevTabs.find((t) => t.conversationId === convId);
      let targetTabId = '';

      if (forceReload && activeConv === convId && agentIsStreamingRef.current) {
        forceReload = false;
        if (
          !agentTabMessagesNeedHydration(messagesByTabIdRef.current[act] || [], {
            hasConversationId: true,
          })
        ) {
          return;
        }
      } else if (agentIsStreamingRef.current && activeConv && activeConv !== convId) {
        cancelLiveAgentStreamIfAny();
      }

      if (byConv) {
        targetTabId = byConv.id;
        if (byConv.id !== act) setActiveAgentChatTabId(byConv.id);
        if (sessionTitle) {
          setAgentChatTabs((prev) =>
            prev.map((t) => (t.id === byConv.id ? { ...t, title: sessionTitle } : t)),
          );
        }
      } else {
        const activeRow = prevTabs.find((t) => t.id === act);
        if (activeRow && !activeRow.conversationId.trim()) {
          targetTabId = act;
          setAgentChatTabs((prev) =>
            prev.map((t) =>
              t.id === act
                ? { ...t, conversationId: convId, title: sessionTitle || 'Chat' }
                : t,
            ),
          );
          // Live first send already painted the user bubble — do not force-hydrate.
          if (agentIsStreamingRef.current) {
            forceReload = false;
            if (
              !agentTabMessagesNeedHydration(messagesByTabIdRef.current[act] || [], {
                hasConversationId: true,
              })
            ) {
              return;
            }
          }
        } else {
          const nid = newAgentChatTabId();
          targetTabId = nid;
          setAgentChatTabs((prev) => [
            ...prev,
            { id: nid, conversationId: convId, title: sessionTitle || 'Chat' },
          ]);
          setActiveAgentChatTabId(nid);
        }
      }

      if (!targetTabId) return;
      void hydrateAgentTabMessages(targetTabId, convId, forceReload);
    };
    window.addEventListener(IAM_AGENT_CHAT_CONVERSATION_CHANGE, onConv);
    return () => window.removeEventListener(IAM_AGENT_CHAT_CONVERSATION_CHANGE, onConv);
  }, [
    workspaceDisplayLine,
    hydrateAgentTabMessages,
    cancelLiveAgentStreamIfAny,
    agentIsStreamingRef,
  ]);

  useEffect(() => {
    const conv = activeAgentConversationId.trim();
    if (!conv) return;
    void hydrateAgentTabMessages(activeAgentChatTabId, conv, false);
  }, [activeAgentChatTabId, activeAgentConversationId, hydrateAgentTabMessages]);

  const createNewAgentChatTab = useCallback(() => {
    const unbindChatAssistantSendId = () => {
      try {
        localStorage.removeItem(LS_AGENT_CHAT_CONVERSATION_ID);
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new CustomEvent(IAM_AGENT_CHAT_UNBIND));
      clearPendingProjectBind();
      try {
        writeSessionProject(null);
      } catch {
        /* ignore */
      }
    };

    const cap = maxTabsPolicyRef.current;
    cancelLiveAgentStreamIfAny();
    if (agentChatTabs.length >= cap) {
      const tid = activeAgentChatTabIdRef.current;
      setAgentChatTabs((prev) =>
        prev.map((t) => (t.id === tid ? { ...t, conversationId: '', title: 'New chat' } : t)),
      );
      setMessagesByTabId((prev) => ({
        ...prev,
        [tid]: freshAgentGreetingMessages(workspaceDisplayLine),
      }));
      unbindChatAssistantSendId();
      setToastMsg(`Maximum chat tabs reached (${cap}). Started a new chat in this tab.`);
      return;
    }
    const nid = newAgentChatTabId();
    const row: AgentChatTabRow = { id: nid, conversationId: '', title: 'New chat' };
    setAgentChatTabs((prev) => [...prev, row]);
    setActiveAgentChatTabId(nid);
    // Sync refs before /agent/new atmospheric effect, or it will unbind the previous tab.
    activeAgentChatTabIdRef.current = nid;
    agentChatTabsRef.current = [...agentChatTabsRef.current, row];
    setMessagesByTabId((prev) => ({
      ...prev,
      [nid]: freshAgentGreetingMessages(workspaceDisplayLine),
    }));
    unbindChatAssistantSendId();
  }, [
    agentChatTabs.length,
    workspaceDisplayLine,
    cancelLiveAgentStreamIfAny,
    maxTabsPolicyRef,
    setToastMsg,
  ]);

  createNewAgentChatTabRef.current = createNewAgentChatTab;

  const selectAgentChatTab = useCallback(
    (tabId: string) => {
      if (tabId !== activeAgentChatTabIdRef.current && agentIsStreamingRef.current) {
        cancelLiveAgentStreamIfAny();
      }
      setActiveAgentChatTabId(tabId);
      const row = agentChatTabs.find((t) => t.id === tabId);
      const conv = row?.conversationId?.trim() ?? '';
      try {
        if (conv) localStorage.setItem(LS_AGENT_CHAT_CONVERSATION_ID, conv);
        else localStorage.removeItem(LS_AGENT_CHAT_CONVERSATION_ID);
      } catch {
        /* ignore */
      }
      if (conv) {
        void hydrateAgentTabMessages(tabId, conv, false);
      }
    },
    [agentChatTabs, hydrateAgentTabMessages, cancelLiveAgentStreamIfAny, agentIsStreamingRef],
  );

  const closeAgentChatTab = useCallback(
    (tabId: string) => {
      const id = String(tabId || '').trim();
      if (!id) return;
      if (id === activeAgentChatTabIdRef.current && agentIsStreamingRef.current) {
        cancelLiveAgentStreamIfAny();
      }

      setAgentChatTabs((prev) => {
        if (prev.length <= 1) {
          setActiveAgentChatTabId(prev[0]?.id ?? id);
          setMessagesByTabId((mPrev) => ({
            ...mPrev,
            [prev[0]?.id ?? id]: freshAgentGreetingMessages(workspaceDisplayLine),
          }));
          try {
            localStorage.removeItem(LS_AGENT_CHAT_CONVERSATION_ID);
          } catch {
            /* ignore */
          }
          return prev.map((t) => ({ ...t, conversationId: '', title: 'New chat' }));
        }

        const idx = prev.findIndex((t) => t.id === id);
        const nextTabs = prev.filter((t) => t.id !== id);
        if (activeAgentChatTabId === id) {
          const neighbor = nextTabs[Math.max(0, idx - 1)] ?? nextTabs[0];
          if (neighbor) {
            setActiveAgentChatTabId(neighbor.id);
            const conv = neighbor.conversationId.trim();
            try {
              if (conv) localStorage.setItem(LS_AGENT_CHAT_CONVERSATION_ID, conv);
              else localStorage.removeItem(LS_AGENT_CHAT_CONVERSATION_ID);
            } catch {
              /* ignore */
            }
            if (conv) void hydrateAgentTabMessages(neighbor.id, conv, false);
          }
        }
        return nextTabs;
      });

      setMessagesByTabId((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [
      activeAgentChatTabId,
      hydrateAgentTabMessages,
      workspaceDisplayLine,
      cancelLiveAgentStreamIfAny,
      agentIsStreamingRef,
    ],
  );

  return {
    agentChatTabs,
    activeAgentChatTabId,
    activeAgentConversationId,
    chatMessages,
    setChatMessages,
    createNewAgentChatTab,
    createNewAgentChatTabRef,
    selectAgentChatTab,
    closeAgentChatTab,
    hydrateAgentTabMessages,
    pathHydratedConvRef,
  };
}
