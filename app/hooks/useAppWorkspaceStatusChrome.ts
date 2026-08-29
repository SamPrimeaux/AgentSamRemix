/** Focus/verify/workspace status bar + openTab/sidebar rail (Wave 2). */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { databaseStudioPathForWorkspace } from '../src/lib/databaseStudioRoute';
import { persistIdeToApi, IDE_PERSIST_VERSION, type IdeWorkspaceSnapshot, type RecentFileEntry } from '../src/ideWorkspace';
import {
  isAgentCenterChatHome,
  isAgentEditorPath,
} from '../lib/agentRoutes';
import { warmAgentChunksForTab } from '../src/pwa/warmAgentChunks';
import { coalesceLabel } from '../src/lib/coalesceLabel';
import type { AgentPanelPosition } from './useAppPanelLayout';
import { useClickOutsideToClose } from './useClickOutsideToClose';

type ShellTabId = 'Workspace' | 'welcome' | 'code' | 'browser' | 'glb' | 'cms';

export function useAppWorkspaceStatusChrome(opts: {
  ensureAgentSidePanel: () => void;
  workspaceRows: any[];
  switchWorkspace: (id: string, o?: any) => Promise<void>;
  refreshWorkspaces: (o?: any) => void;
  locationPathname: string;
  locationSearch: string;
  navigate: NavigateFunction;
  setToastMsg: React.Dispatch<React.SetStateAction<string | null>>;
  setGitBranch: React.Dispatch<React.SetStateAction<string>>;
  authWorkspaceId: string | null | undefined;
  activeAgentConversationId: string | null | undefined;
  activeTab: ShellTabId;
  setActiveTab: React.Dispatch<React.SetStateAction<ShellTabId>>;
  setOpenTabs: React.Dispatch<React.SetStateAction<ShellTabId[]>>;
  ideWorkspace: IdeWorkspaceSnapshot;
  gitBranch: string;
  recentFiles: RecentFileEntry[];
  glbViewerUrl: string;
  toastMsg: string | null;
  topChromeMoreOpen: boolean;
  setTopChromeMoreOpen: React.Dispatch<React.SetStateAction<boolean>>;
  topChromeMoreRef: React.RefObject<HTMLDivElement | null>;
  maxTabsPolicyRef: React.MutableRefObject<number>;
  isNarrowViewport: boolean;
  setAgentPosition: React.Dispatch<React.SetStateAction<AgentPanelPosition>>;
  setSidebarRailExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  sessionUserName: string | null | undefined;
  workspaceDisplayName: string | null | undefined;
  LS_SIDEBAR_RAIL: string;
}) {
  const {
    ensureAgentSidePanel, workspaceRows, switchWorkspace, refreshWorkspaces,
    locationPathname, locationSearch, navigate, setToastMsg, setGitBranch, authWorkspaceId,
    activeAgentConversationId, activeTab, setActiveTab, setOpenTabs, ideWorkspace, gitBranch,
    recentFiles, glbViewerUrl, toastMsg, topChromeMoreOpen, setTopChromeMoreOpen, topChromeMoreRef,
    maxTabsPolicyRef, isNarrowViewport, setAgentPosition, setSidebarRailExpanded,
    sessionUserName, workspaceDisplayName, LS_SIDEBAR_RAIL,
  } = opts;

  const focusAgentChat = useCallback(() => {
    ensureAgentSidePanel();
  }, [ensureAgentSidePanel]);

  const runVerificationInAgent = useCallback(
    (command: string) => {
      const trimmed = command.trim();
      if (!trimmed) return;
      focusAgentChat();
      window.dispatchEvent(
        new CustomEvent('iam-agent-external-send', {
          detail: { message: trimmed },
        }),
      );
    },
    [focusAgentChat],
  );

  const persistActiveWorkspace = useCallback(
    async (id: string) => {
      const row = workspaceRows.find((w) => w.id === id);
      try {
        await switchWorkspace(id, {
          displayName: row?.name,
          slug: row?.slug,
          github_repo: row?.github_repo,
          sync: true,
        });
        void refreshWorkspaces({ force: true });
        if (locationPathname.startsWith('/dashboard/database')) {
          const nextPath = databaseStudioPathForWorkspace(row ?? null);
          if (nextPath !== locationPathname) {
            navigate(nextPath, { replace: true });
          }
        }
      } catch {
        setToastMsg('Workspace saved locally — sync failed.');
      }
    },
    [switchWorkspace, refreshWorkspaces, workspaceRows, locationPathname, navigate],
  );

  const statusBarWorkspaceItems = useMemo(
    () =>
      workspaceRows.map((w) => ({
        id: w.id,
        label: w.github_repo?.trim() || w.slug || w.name,
        slug: w.slug,
        status: w.status,
        github_repo: w.github_repo,
      })),
    [workspaceRows],
  );

  const handleStatusBarWorkspacePick = useCallback(
    (id: string) => {
      void persistActiveWorkspace(id);
    },
    [persistActiveWorkspace],
  );

  const handleStatusBarBranchSelect = useCallback(
    async (branchName: string) => {
      const b = branchName.trim();
      if (!b) return;
      const ws = authWorkspaceId?.trim();
      try {
        const res = await fetch('/api/agent/git/branch', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch: b, workspace_id: ws || undefined }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          branch?: string;
          branch_source?: string;
          error?: string;
          message?: string;
        };
        // HTTP 404 branch_not_found is a normal Response — never treat as network failure.
        if (!res.ok || json.ok !== true || json.branch_source !== 'user') {
          const code = String(json.error || '').trim();
          if (code === 'branch_not_found') {
            setToastMsg(`Branch "${b}" not found on GitHub — pick one from the list.`);
          } else if (json.message?.trim()) {
            setToastMsg(json.message.trim());
          } else if (code) {
            setToastMsg(code.replace(/_/g, ' '));
          } else {
            setToastMsg(`Could not switch branch (${res.status})`);
          }
          return;
        }
        setGitBranch(String(json.branch || b).trim() || b);
      } catch {
        setToastMsg('Network error switching branch');
      }
    },
    [authWorkspaceId, setGitBranch, setToastMsg],
  );

  const lastPersistedTabRef = useRef<ShellTabId | null>(null);
  useEffect(() => {
    lastPersistedTabRef.current = null;
  }, [activeAgentConversationId]);

  useEffect(() => {
    const id = activeAgentConversationId?.trim();
    if (!id) return;
    const prev = lastPersistedTabRef.current;
    lastPersistedTabRef.current = activeTab;
    if (prev === null) return;
    if (prev === activeTab) return;
    void persistIdeToApi(id, {
      v: IDE_PERSIST_VERSION,
      ideWorkspace,
      gitBranch,
      recentFiles,
    });
  }, [activeTab, activeAgentConversationId, ideWorkspace, gitBranch, recentFiles]);

  useEffect(() => {
    return () => {
      if (glbViewerUrl.startsWith('blob:')) URL.revokeObjectURL(glbViewerUrl);
    };
  }, [glbViewerUrl]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = window.setTimeout(() => setToastMsg(null), 4500);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const closeTopChromeMore = useCallback(() => setTopChromeMoreOpen(false), [setTopChromeMoreOpen]);
  useClickOutsideToClose(topChromeMoreRef, topChromeMoreOpen, closeTopChromeMore);

  const openTab = useCallback((tab: ShellTabId) => {
    setOpenTabs((prev) => {
      if (prev.includes(tab)) return prev;
      const cap = maxTabsPolicyRef.current;
      if (prev.length >= cap) {
        setToastMsg(`Max ${cap} tabs — close one to open another.`);
        return prev;
      }
      return [...prev, tab];
    });
    setActiveTab(tab);
    warmAgentChunksForTab(tab);
    if (
      !isNarrowViewport &&
      (tab === 'browser' || tab === 'cms' || tab === 'code') &&
      (isAgentEditorPath(locationPathname) ||
        isAgentCenterChatHome(locationPathname, locationSearch))
    ) {
      setAgentPosition((p) => (p === 'off' ? 'right' : p));
    }
  }, [isNarrowViewport, locationPathname, locationSearch]);

  const toggleSidebarRail = useCallback(() => {
    setSidebarRailExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LS_SIDEBAR_RAIL, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const agentHomeGreetingName = useMemo(() => {
    const user = coalesceLabel(sessionUserName, '');
    if (user) return user;
    return coalesceLabel(workspaceDisplayName, 'there');
  }, [sessionUserName, workspaceDisplayName]);

  return {
    focusAgentChat,
    runVerificationInAgent,
    persistActiveWorkspace,
    statusBarWorkspaceItems,
    handleStatusBarWorkspacePick,
    handleStatusBarBranchSelect,
    openTab,
    toggleSidebarRail,
    agentHomeGreetingName,
  };
}
