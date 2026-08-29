/** closeTab + agent home nav / narrow helpers (Wave 2). */
import React, { useCallback, useEffect, useMemo } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import {
  AGENT_HOME_PATH,
  AGENT_QUICKSTART_PATH,
  AGENT_WORKSPACE_PATH,
  AGENT_EXAMPLES_PATH,
  AGENT_TAB_QUERY,
  isAgentShellPath,
  type AgentHomeTab,
} from '../lib/agentRoutes';
import {
  IAM_AGENT_CHAT_CONVERSATION_CHANGE,
  LS_AGENT_CHAT_CONVERSATION_ID,
} from '../agentChatConstants';
import {
  IAM_AGENT_COLLAPSE_PANEL,
  IAM_AGENT_ENSURE_PANEL,
} from '../lib/openAgentConversation';
import {
  IAM_FILES_SOURCE_CONTEXT_EVENT,
  type AgentSamFsSourceContext,
} from '../src/lib/agentSamFilesystemTypes';
import type { IdeWorkspaceSnapshot } from '../src/ideWorkspace';
import type { Message } from '../components/ChatAssistant/types';
import type { AgentPanelPosition } from './useAppPanelLayout';

type ShellTabId = 'Workspace' | 'welcome' | 'code' | 'browser' | 'glb' | 'cms';

export function useAppAgentNavHelpers(opts: {
  openTabs: ShellTabId[];
  setOpenTabs: React.Dispatch<React.SetStateAction<ShellTabId[]>>;
  activeTab: ShellTabId;
  setActiveTab: React.Dispatch<React.SetStateAction<ShellTabId>>;
  setBrowserAddressDisplay: React.Dispatch<React.SetStateAction<any>>;
  setBrowserTabTitle: React.Dispatch<React.SetStateAction<any>>;
  isAgentBareHeroHome: boolean;
  chatMessages: Message[];
  isAgentHomeAtmospheric: boolean;
  isNarrowViewport: boolean;
  setAgentPosition: React.Dispatch<React.SetStateAction<AgentPanelPosition>>;
  setFilesSourceContext: React.Dispatch<React.SetStateAction<AgentSamFsSourceContext | null>>;
  setIdeWorkspace: React.Dispatch<React.SetStateAction<IdeWorkspaceSnapshot>>;
  setGitRepoFullName: React.Dispatch<React.SetStateAction<string>>;
  navigate: NavigateFunction;
  setActiveActivity: React.Dispatch<React.SetStateAction<any>>;
  agentChatLayout: string;
  agentPosition: AgentPanelPosition;
  activeAgentConversationId: string | null | undefined;
  locationPathname: string;
  locationSearch: string;
  setGithubExpandRepo: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const {
    openTabs, setOpenTabs, activeTab, setActiveTab, setBrowserAddressDisplay, setBrowserTabTitle,
    isAgentBareHeroHome, chatMessages, isAgentHomeAtmospheric, isNarrowViewport, setAgentPosition,
    setFilesSourceContext, setIdeWorkspace, setGitRepoFullName, navigate, setActiveActivity,
    agentChatLayout, agentPosition, activeAgentConversationId, locationPathname, locationSearch,
    setGithubExpandRepo,
  } = opts;

  const closeTab = (tab: ShellTabId, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tab === 'browser') {
      setBrowserAddressDisplay(null);
      setBrowserTabTitle(null);
    }
    const next = openTabs.filter(t => t !== tab);
    setOpenTabs(next);
    if (activeTab === tab) {
      setActiveTab(next.length > 0 ? next[next.length - 1] : 'Workspace');
    }
  };


  /** Desktop empty bare-home only — phone uses AgentMobileHomePanel exclusively. */
  const agentHomeShowHero = useMemo(
    () =>
      isAgentBareHeroHome &&
      !isNarrowViewport &&
      !chatMessages.some((m) => m.role === 'user'),
    [chatMessages, isAgentBareHeroHome, isNarrowViewport],
  );

  useEffect(() => {
    const ensurePanel = () => {
      if (isAgentHomeAtmospheric && !isNarrowViewport) return;
      setAgentPosition((p) => (p === 'off' ? 'right' : p));
    };
    const collapsePanel = () => {
      setAgentPosition('off');
    };
    window.addEventListener(IAM_AGENT_ENSURE_PANEL, ensurePanel);
    window.addEventListener(IAM_AGENT_COLLAPSE_PANEL, collapsePanel);
    return () => {
      window.removeEventListener(IAM_AGENT_ENSURE_PANEL, ensurePanel);
      window.removeEventListener(IAM_AGENT_COLLAPSE_PANEL, collapsePanel);
    };
  }, [isAgentHomeAtmospheric, isNarrowViewport]);

  // Greeting / chrome follow Files-rail source_path (published by AgentSamFilesystemView).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onFilesContext = (ev: Event) => {
      const detail = (ev as CustomEvent<AgentSamFsSourceContext>).detail;
      if (!detail?.source) return;
      setFilesSourceContext(detail);
      if (detail.source === 'local' && detail.local_folder) {
        setIdeWorkspace({ source: 'local', folderName: detail.local_folder });
        setGitRepoFullName('');
      } else if (
        detail.source === 'github' &&
        detail.github_repo
      ) {
        setGitRepoFullName(detail.github_repo);
      } else {
        setGitRepoFullName('');
      }
    };
    window.addEventListener(IAM_FILES_SOURCE_CONTEXT_EVENT, onFilesContext);
    return () => window.removeEventListener(IAM_FILES_SOURCE_CONTEXT_EVENT, onFilesContext);
  }, []);

  const openAgentQuickstart = useCallback(() => {
    navigate(AGENT_QUICKSTART_PATH);
  }, [navigate]);

  const handleAgentTabChange = useCallback(
    (tab: AgentHomeTab) => {
      const pathByTab: Record<AgentHomeTab, string> = {
        recent: AGENT_WORKSPACE_PATH,
        workspaces: `${AGENT_WORKSPACE_PATH}?${AGENT_TAB_QUERY}=workspaces`,
        examples: AGENT_EXAMPLES_PATH,
      };
      navigate(pathByTab[tab], { replace: true });
    },
    [navigate],
  );

  const narrowBackToCenter = useCallback(() => {
    setActiveActivity(null);
    setAgentPosition('off');
  }, []);

  const urlAgentSessionId = useMemo(() => {
    try {
      return new URLSearchParams(locationSearch).get('session')?.trim() || '';
    } catch {
      return '';
    }
  }, [locationSearch]);

  const mobileHamburgerConversationBack =
    isNarrowViewport &&
    (agentChatLayout === 'center' || agentPosition !== 'off') &&
    !!(activeAgentConversationId?.trim() || urlAgentSessionId);

  const narrowBackToAgentHome = useCallback(() => {
    try {
      localStorage.removeItem(LS_AGENT_CHAT_CONVERSATION_ID);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent(IAM_AGENT_CHAT_CONVERSATION_CHANGE, { detail: { id: null } }));
    if (urlAgentSessionId && isAgentShellPath(locationPathname)) {
      navigate(AGENT_HOME_PATH, { replace: true });
    }
  }, [locationPathname, navigate, urlAgentSessionId]);

  const openGitHubFromChat = useCallback((opts?: { expandRepoFullName?: string }) => {
    const fn = opts?.expandRepoFullName?.trim();
    if (fn) setGithubExpandRepo(fn);
    setActiveActivity('actions');
  }, []);

  const openDashboardFromChat = useCallback(() => {
    narrowBackToCenter();
    setActiveTab('Workspace');
    setOpenTabs((prev) => (prev.includes('Workspace') ? prev : [...prev, 'Workspace']));
  }, [narrowBackToCenter]);


  return {
    closeTab,
    agentHomeShowHero,
    openAgentQuickstart,
    handleAgentTabChange,
    narrowBackToCenter,
    urlAgentSessionId,
    mobileHamburgerConversationBack,
    narrowBackToAgentHome,
    openGitHubFromChat,
    openDashboardFromChat,
  };
}
