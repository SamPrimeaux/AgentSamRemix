/** App shell agent chat compose / new-thread bridge (Wave 2 E4 companion). */
import React, { useCallback, useEffect, useRef } from 'react';
import { useLocation, type NavigateFunction } from 'react-router-dom';
import type { QuickstartTemplate } from '../components/AgentQuickstartPage';
import type { AgentModeId } from '../types/agentHomeScene';
import {
  AGENT_HOME_PATH,
  AGENT_NEW_CHAT_PATH,
  agentConversationPath,
  isAgentNewChatPath,
} from '../lib/agentRoutes';
import {
  IAM_AGENT_CHAT_COMPOSE,
  IAM_AGENT_CHAT_NEW_THREAD,
  IAM_AGENT_CHAT_READY,
  QUICKSTART_BATCH_LABEL,
  type AgentChatComposeDetail,
  type QuickstartThreadDetail,
} from '../agentChatConstants';
import {
  IAM_AGENT_OPEN_THREAD,
  IAM_AGENT_START_NEW_CHAT,
  buildProjectChatFirstMessage,
  openAgentConversation,
  persistAgentConversationId,
  type OpenAgentThreadDetail,
  type StartNewAgentChatDetail,
} from '../lib/openAgentConversation';
import { writeSessionProject } from '../src/lib/freshChatSession';
import { setPendingProjectBind } from '../lib/pendingProjectBind';
import type { AgentPanelPosition } from './useAppPanelLayout';

type ShellTabId = 'Workspace' | 'welcome' | 'code' | 'browser' | 'glb' | 'cms';

export function useAppAgentChatCompose(opts: {
  navigate: NavigateFunction;
  agentPosition: AgentPanelPosition;
  setAgentPosition: React.Dispatch<React.SetStateAction<AgentPanelPosition>>;
  setActiveTab: React.Dispatch<React.SetStateAction<ShellTabId>>;
  setOpenTabs: React.Dispatch<React.SetStateAction<ShellTabId[]>>;
  isAgentHomeAtmospheric: boolean;
  isNarrowViewport: boolean;
  authWorkspaceId: string | null | undefined;
  createNewAgentChatTab: () => void;
  createNewAgentChatTabRef: React.MutableRefObject<(() => void) | null>;
  shellNewChat: () => void;
  shellOpenDraw: (detail?: { load_url?: string | null; artifact_id?: string | null }) => void;
  shellOpenSketch: (detail?: {
    elements?: unknown[];
    mode?: 'sketch' | 'layout' | 'blueprint';
    name?: string;
  }) => void;
}) {
  const {
    navigate,
    agentPosition,
    setAgentPosition,
    setActiveTab,
    setOpenTabs,
    isAgentHomeAtmospheric,
    isNarrowViewport,
    authWorkspaceId,
    createNewAgentChatTab,
    createNewAgentChatTabRef,
    shellNewChat,
    shellOpenDraw,
    shellOpenSketch,
  } = opts;

  const location = useLocation();
  const chatAssistantReadyRef = useRef(false);
  const pendingNewThreadMessageRef = useRef<QuickstartThreadDetail | null>(null);
  const flushPendingNewThreadRef = useRef<(() => void) | null>(null);
  const pendingAgentChatComposeRef = useRef<AgentChatComposeDetail | null>(null);
  /** Avoid double-apply when event navigate lands on the same /agent/new?project_id= URL. */
  const consumedNewChatProjectRef = useRef<string | null>(null);

  const applyOpenThreadDetail = useCallback(
    (detail: OpenAgentThreadDetail | null | undefined, opts?: { fromUrl?: boolean }) => {
      const projectId = detail?.projectId?.trim();
      const conversationId = detail?.conversationId?.trim();

      setAgentPosition('off');
      setActiveTab('Workspace');
      setOpenTabs((prev) => (prev.includes('Workspace') ? prev : [...prev, 'Workspace']));

      const message = buildProjectChatFirstMessage(
        detail?.firstMessage,
        detail?.memory,
        detail?.instructions,
      );

      if (conversationId) {
        if (projectId) {
          writeSessionProject({ id: projectId, name: detail?.projectName?.trim() || 'Project' });
          setPendingProjectBind({
            kind: 'set',
            projectId,
            source: opts?.fromUrl ? 'agent_new_url' : 'project_surface',
          });
        }
        persistAgentConversationId(conversationId);
        navigate(agentConversationPath(conversationId));
        requestAnimationFrame(() => {
          openAgentConversation({
            id: conversationId,
            title: detail?.title,
            force: detail?.force !== false,
            ensureAgentPanel: false,
          });
        });
        return;
      }

      // Stale true from a previous ChatAssistant mount flushes the first message
      // into a dying instance (message eaten). Invalidate before any navigate/remount.
      chatAssistantReadyRef.current = false;

      const alreadyOnNew = isAgentNewChatPath(location.pathname);
      if (!alreadyOnNew) {
        navigate(
          projectId
            ? `${AGENT_NEW_CHAT_PATH}?project_id=${encodeURIComponent(projectId)}`
            : AGENT_NEW_CHAT_PATH,
        );
      } else if (opts?.fromUrl && projectId) {
        // Hard nav / bookmark: keep shell on /agent/new, drop query after consume.
        navigate(AGENT_NEW_CHAT_PATH, { replace: true });
      }
      if (projectId) consumedNewChatProjectRef.current = projectId;
      // Prefer direct fn — ref can still be null on first paint of a hard nav.
      createNewAgentChatTab();
      createNewAgentChatTabRef.current = createNewAgentChatTab;
      // UI label + one-shot wire bind AFTER new-tab reset (tab clear wipes session label).
      if (projectId) {
        writeSessionProject({ id: projectId, name: detail?.projectName?.trim() || 'Project' });
        setPendingProjectBind({
          kind: 'set',
          projectId,
          source: opts?.fromUrl ? 'agent_new_url' : 'project_surface',
        });
      }
      if (message) {
        pendingNewThreadMessageRef.current = { message, ensureAgentPanel: false };
        // No-op while ready=false; IAM_AGENT_CHAT_READY on the new mount flushes.
        flushPendingNewThreadRef.current?.();
      }
    },
    [
      location.pathname,
      navigate,
      setAgentPosition,
      setActiveTab,
      setOpenTabs,
      createNewAgentChatTab,
      createNewAgentChatTabRef,
    ],
  );

  useEffect(() => {
    const onOpenThread = (e: Event) => {
      applyOpenThreadDetail((e as CustomEvent<OpenAgentThreadDetail>).detail);
    };
    window.addEventListener(IAM_AGENT_OPEN_THREAD, onOpenThread);
    return () => window.removeEventListener(IAM_AGENT_OPEN_THREAD, onOpenThread);
  }, [applyOpenThreadDetail]);

  // Direct URL / hard navigation: /dashboard/agent/new?project_id=<projects.id>
  useEffect(() => {
    if (!isAgentNewChatPath(location.pathname)) {
      consumedNewChatProjectRef.current = null;
      return;
    }
    const params = new URLSearchParams(location.search || '');
    const projectId = (params.get('project_id') || params.get('projectId') || '').trim();
    if (!projectId) return;
    if (consumedNewChatProjectRef.current === projectId) return;
    applyOpenThreadDetail({ projectId }, { fromUrl: true });
  }, [location.pathname, location.search, applyOpenThreadDetail]);

  useEffect(() => {
    const onStartNewChat = (e: Event) => {
      const stayOnPage = (e as CustomEvent<StartNewAgentChatDetail>).detail?.stayOnPage === true;
      if (stayOnPage) {
        createNewAgentChatTabRef.current?.();
        // Atmospheric product entry (Draw / Sketch / Design Studio) keeps center
        // composer — do not yank open the side rail.
        const path =
          typeof window !== 'undefined' ? String(window.location.pathname || '') : '';
        const atmosphericEntry =
          path.startsWith('/dashboard/draw') ||
          path.startsWith('/dashboard/sketch') ||
          path.startsWith('/dashboard/designstudio');
        if (!atmosphericEntry && agentPosition === 'off') setAgentPosition('right');
        return;
      }
      shellNewChat();
    };
    window.addEventListener(IAM_AGENT_START_NEW_CHAT, onStartNewChat);
    return () => window.removeEventListener(IAM_AGENT_START_NEW_CHAT, onStartNewChat);
  }, [shellNewChat, agentPosition, setAgentPosition, createNewAgentChatTabRef]);

  const dispatchAgentChatCompose = useCallback((detail: AgentChatComposeDetail) => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent(IAM_AGENT_CHAT_COMPOSE, { detail }));
    });
  }, []);

  const dispatchNewThreadMessage = useCallback((detail: QuickstartThreadDetail) => {
    const message = detail.message?.trim();
    if (!message) return;
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent(IAM_AGENT_CHAT_NEW_THREAD, {
          detail: { ...detail, message, ensureAgentPanel: false },
        }),
      );
    });
  }, []);

  const flushPendingNewThread = useCallback(() => {
    if (!chatAssistantReadyRef.current) return;
    const pending = pendingNewThreadMessageRef.current;
    if (!pending?.message?.trim()) return;
    pendingNewThreadMessageRef.current = null;
    dispatchNewThreadMessage(pending);
  }, [dispatchNewThreadMessage]);

  flushPendingNewThreadRef.current = flushPendingNewThread;

  useEffect(() => {
    const onReady = () => {
      chatAssistantReadyRef.current = true;
      flushPendingNewThread();
    };
    const onUnmount = () => {
      chatAssistantReadyRef.current = false;
    };
    window.addEventListener(IAM_AGENT_CHAT_READY, onReady);
    window.addEventListener('iam-agent-chat-unmount', onUnmount);
    return () => {
      window.removeEventListener(IAM_AGENT_CHAT_READY, onReady);
      window.removeEventListener('iam-agent-chat-unmount', onUnmount);
    };
  }, [flushPendingNewThread]);

  const startAgentNewThreadWithMessage = useCallback(
    (detail: QuickstartThreadDetail | string) => {
      const normalized: QuickstartThreadDetail =
        typeof detail === 'string'
          ? { message: detail.trim() }
          : { ...detail, message: detail.message?.trim() ?? '' };
      if (!normalized.message) return;

      const openPanelAndSend = () => {
        createNewAgentChatTab();
        dispatchNewThreadMessage(normalized);
      };

      if (isAgentHomeAtmospheric && !isNarrowViewport) {
        openPanelAndSend();
        return;
      }

      if (agentPosition === 'off') {
        pendingNewThreadMessageRef.current = normalized;
        setAgentPosition('right');
        return;
      }
      openPanelAndSend();
    },
    [
      agentPosition,
      createNewAgentChatTab,
      dispatchNewThreadMessage,
      isAgentHomeAtmospheric,
      isNarrowViewport,
      setAgentPosition,
    ],
  );

  useEffect(() => {
    const onNewThreadRequest = (e: Event) => {
      const detail = (e as CustomEvent<QuickstartThreadDetail>).detail;
      if (!detail?.message?.trim()) return;
      if (detail.ensureAgentPanel === false) return;
      e.stopImmediatePropagation();
      startAgentNewThreadWithMessage(detail);
    };
    window.addEventListener(IAM_AGENT_CHAT_NEW_THREAD, onNewThreadRequest, true);
    return () => window.removeEventListener(IAM_AGENT_CHAT_NEW_THREAD, onNewThreadRequest, true);
  }, [startAgentNewThreadWithMessage]);

  useEffect(() => {
    const onComposeRequest = (e: Event) => {
      const detail = (e as CustomEvent<AgentChatComposeDetail>).detail;
      if (detail?.closePanel) {
        setAgentPosition('off');
        return;
      }
      if (detail?.ensureAgentPanel !== false && agentPosition === 'off') {
        setAgentPosition('right');
      }
      if (!detail?.message?.trim()) return;
      if (detail.ensureAgentPanel === false) return;
      if (isAgentHomeAtmospheric && !isNarrowViewport) return;
      if (agentPosition !== 'off') return;
      pendingAgentChatComposeRef.current = detail;
      setAgentPosition('right');
    };
    window.addEventListener(IAM_AGENT_CHAT_COMPOSE, onComposeRequest);
    return () => window.removeEventListener(IAM_AGENT_CHAT_COMPOSE, onComposeRequest);
  }, [agentPosition, isAgentHomeAtmospheric, isNarrowViewport, setAgentPosition]);

  useEffect(() => {
    const pending = pendingAgentChatComposeRef.current;
    if (!pending || agentPosition === 'off') return;
    pendingAgentChatComposeRef.current = null;
    dispatchAgentChatCompose(pending);
  }, [agentPosition, dispatchAgentChatCompose]);

  useEffect(() => {
    if (!isAgentHomeAtmospheric) return;
    setAgentPosition('off');
  }, [isAgentHomeAtmospheric, setAgentPosition]);

  const handleAgentHomeModeSelect = useCallback(
    (mode: AgentModeId) => {
      const MODE_PREFIX: Record<Exclude<AgentModeId, 'code'>, string> = {
        write: 'Help me write: ',
        create: 'Help me create: ',
        learn: 'I want to learn about: ',
        life: 'Life stuff — ',
      };
      if (mode === 'code') return;
      const prefix = MODE_PREFIX[mode];
      dispatchAgentChatCompose({ message: prefix, ensureAgentPanel: false });
    },
    [dispatchAgentChatCompose],
  );

  const beginExamplesPrompt = useCallback(
    ({
      prompt,
      recipeId,
      source: _source,
    }: {
      prompt: string;
      recipeId?: string;
      source?: string;
    }) => {
      startAgentNewThreadWithMessage({
        message: prompt,
        task_type: 'design_intake',
        route_key: 'design_intake',
        quickstart_batch: QUICKSTART_BATCH_LABEL,
        apply_eto_after_run: true,
        workspace_id: authWorkspaceId?.trim() || undefined,
        modelKey: 'auto',
      });
      if (recipeId) {
        fetch(`/api/cookbook/${encodeURIComponent(recipeId)}/use`, {
          method: 'POST',
          credentials: 'include',
        }).catch(() => {});
      }
    },
    [startAgentNewThreadWithMessage, authWorkspaceId],
  );

  useEffect(() => {
    window.iamStartWorkspaceWithPrompt = beginExamplesPrompt;
    return () => {
      delete window.iamStartWorkspaceWithPrompt;
    };
  }, [beginExamplesPrompt]);

  const beginQuickstartTemplate = useCallback(
    (template: QuickstartTemplate) => {
      const surface = (template.openSurface ?? null) as string | null;
      const openExcalidraw =
        surface === 'excalidraw' || template.slug === 'card-flowchart';
      const openSketch =
        surface === 'sketch' ||
        surface === 'wireframe' ||
        template.slug === 'card-wireframe' ||
        template.slug === 'card-blank-canvas';
      if (openExcalidraw) {
        shellOpenDraw();
      } else if (openSketch) {
        shellOpenSketch();
      } else {
        navigate(AGENT_HOME_PATH);
      }
      startAgentNewThreadWithMessage({
        message: template.seedMessage,
        task_type: template.task_type,
        route_key: template.route_key,
        quickstart_batch: QUICKSTART_BATCH_LABEL,
        quickstart_card: template.slug,
        apply_eto_after_run: true,
        workspace_id: authWorkspaceId?.trim() || undefined,
        modelKey: 'auto',
        surface: openExcalidraw ? 'excalidraw' : openSketch ? 'sketch' : undefined,
        ensureAgentPanel: true,
      });
    },
    [navigate, shellOpenDraw, shellOpenSketch, startAgentNewThreadWithMessage, authWorkspaceId],
  );

  return {
    dispatchAgentChatCompose,
    startAgentNewThreadWithMessage,
    handleAgentHomeModeSelect,
    beginExamplesPrompt,
    beginQuickstartTemplate,
  };
}
