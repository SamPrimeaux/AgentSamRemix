/** Collab WS + IDE hydrate/persist + plan/workbench memos (Wave 2). */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  applyCmsThemeToDocument,
  logDashboardThemeDebug,
} from '../src/applyCmsTheme';
import {
  hydrateIdeFromApi,
  persistIdeToApi,
  IDE_PERSIST_VERSION,
  type IdeWorkspaceSnapshot,
  type RecentFileEntry,
  type DevServerState,
} from '../src/ideWorkspace';
import { prepareActiveFileForEditor } from '../src/lib/prepareActiveFileForEditor';
import { isAgentHomePath } from '../lib/agentRoutes';
import { PRODUCT_NAME } from '../lib/appShellConstants';
import { readRecentFilesFromLocalStorage } from '../lib/appShellRecentFiles';
import type { ActiveFile } from '../types';

type ShellTabId = 'Workspace' | 'welcome' | 'code' | 'browser' | 'glb' | 'cms';

export function useAppIdeCollabHydrate(opts: {
  authWorkspaceId: string | null | undefined;
  locationPathname: string;
  workspaceDisplayLine: string;
  activeAgentConversationId: string | null | undefined;
  openFile: (f: ActiveFile) => void;
  setOpenTabs: React.Dispatch<React.SetStateAction<ShellTabId[]>>;
  setActiveTab: React.Dispatch<React.SetStateAction<ShellTabId>>;
  ideWorkspace: IdeWorkspaceSnapshot;
  setIdeWorkspace: React.Dispatch<React.SetStateAction<IdeWorkspaceSnapshot>>;
  gitBranch: string;
  setGitBranch: React.Dispatch<React.SetStateAction<string>>;
  recentFiles: RecentFileEntry[];
  setRecentFiles: React.Dispatch<React.SetStateAction<RecentFileEntry[]>>;
  recentFilesLsTick: number;
  devServer: DevServerState | null;
  setDevServer: React.Dispatch<React.SetStateAction<DevServerState | null>>;
  workspaceSamState: Record<string, unknown> | null;
  setWorkspaceSamState: React.Dispatch<React.SetStateAction<Record<string, unknown> | null>>;
  isAgentBareHeroHome: boolean;
  activeTab: ShellTabId;
  agentChatLayout: string;
  tabs: Array<{ name?: string }>;
  /** Phone empty-thread chrome is AgentMobileHomePanel — do not mount AgentHome scene/hero. */
  isNarrowViewport: boolean;
}) {
  const {
    authWorkspaceId, locationPathname, workspaceDisplayLine, activeAgentConversationId,
    openFile, setOpenTabs, setActiveTab, ideWorkspace, setIdeWorkspace, gitBranch, setGitBranch,
    recentFiles, setRecentFiles, recentFilesLsTick, devServer, setDevServer,
    workspaceSamState, setWorkspaceSamState, isAgentBareHeroHome, activeTab, agentChatLayout, tabs,
    isNarrowViewport,
  } = opts;

  const collabWsRef = useRef<WebSocket | null>(null);

  // IAM_COLLAB — same workspace DO room as canvas (`canvas:{workspaceId}`): realtime theme + canvas (D1 is authority).
  useEffect(() => {
    const wsId = authWorkspaceId?.trim();
    if (!wsId) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const room = encodeURIComponent(`canvas:${wsId}`);
    const wsUrl = `${proto}//${window.location.host}/api/collab/room/${room}`;
    const ws = new WebSocket(wsUrl);
    collabWsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as Record<string, unknown>;
        if (
          msg.type === 'theme_update' &&
          msg.cssVars &&
          typeof msg.cssVars === 'object' &&
          !Array.isArray(msg.cssVars) &&
          Object.keys(msg.cssVars as object).length > 0
        ) {
          applyCmsThemeToDocument({
            slug: typeof msg.theme_slug === 'string' ? msg.theme_slug : undefined,
            data: msg.cssVars as Record<string, string>,
            monaco_theme: typeof msg.monaco_theme === 'string' ? msg.monaco_theme : undefined,
            monaco_bg: typeof msg.monaco_bg === 'string' ? msg.monaco_bg : undefined,
            monaco_theme_data:
              msg.monaco_theme_data != null && typeof msg.monaco_theme_data === 'string'
                ? msg.monaco_theme_data
                : undefined,
            agent_home:
              msg.agent_home && typeof msg.agent_home === 'object' && !Array.isArray(msg.agent_home)
                ? (msg.agent_home as import('../types/agentHomeScene').AgentHomeCmsConfig)
                : undefined,
            workspace_id: wsId,
            theme_channel: 'live',
          });
          logDashboardThemeDebug();
        }
        if (msg.type === 'canvas_update') {
          window.dispatchEvent(new CustomEvent('iam:canvas_update', { detail: msg.elements }));
        }
        if (msg.type === 'iam_excalidraw') {
          window.dispatchEvent(
            new CustomEvent('iam:excalidraw_action', { detail: { action: msg.action, params: msg.params } }),
          );
        }
        if (msg.type === 'iam_designstudio') {
          window.dispatchEvent(
            new CustomEvent('iam:designstudio_action', {
              detail: { action: msg.action, params: msg.params },
            }),
          );
        }
        if (msg.type === 'iam_monaco_patch') {
          window.dispatchEvent(
            new CustomEvent('iam:monaco_patch', {
              detail: {
                filePath: typeof msg.filePath === 'string' ? msg.filePath : '',
                patch: typeof msg.patch === 'string' ? msg.patch : '',
              },
            }),
          );
        }
      } catch (_) {}
    };
    ws.onerror = () => {};
    return () => {
      try {
        ws.close();
      } catch (_) {}
    };
  }, [authWorkspaceId]);

  useEffect(() => {
    if (!isAgentHomePath(locationPathname)) return;
    const ws = authWorkspaceId?.trim();
    if (!ws) {
      setWorkspaceSamState(null);
      return;
    }
    void fetch(`/api/agent/workspace/${encodeURIComponent(ws)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row: { state?: Record<string, unknown> } | null) => {
        const st = row?.state && typeof row.state === 'object' ? row.state : null;
        setWorkspaceSamState(st);
      })
      .catch(() => setWorkspaceSamState(null));
  }, [locationPathname, authWorkspaceId]);

  useEffect(() => {
    document.title = `${workspaceDisplayLine} — ${PRODUCT_NAME}`;
  }, [workspaceDisplayLine]);

  const idePersistRef = useRef({
    ideWorkspace: { source: 'none' } as IdeWorkspaceSnapshot,
    gitBranch: '',
    recentFiles: [] as RecentFileEntry[],
    devServer: null as DevServerState | null,
  });
  useEffect(() => {
    idePersistRef.current = { ideWorkspace, gitBranch, recentFiles, devServer };
  }, [ideWorkspace, gitBranch, recentFiles, devServer]);

  const hydrateGenRef = useRef(0);
  const prevAgentConvRef = useRef<string>('');
  useEffect(() => {
    const id = activeAgentConversationId?.trim() || '';
    const prev = prevAgentConvRef.current;
    prevAgentConvRef.current = id;

    if (prev && prev !== id) {
      const s = idePersistRef.current;
      void persistIdeToApi(prev, {
        v: IDE_PERSIST_VERSION,
        ideWorkspace: s.ideWorkspace,
        gitBranch: s.gitBranch,
        recentFiles: s.recentFiles,
        devServer: s.devServer ?? null,
      });
    }

    if (!id) return;
    const gen = ++hydrateGenRef.current;
    let cancelled = false;
    void hydrateIdeFromApi(id).then((b) => {
      if (cancelled || hydrateGenRef.current !== gen) return;
      setIdeWorkspace(b.ideWorkspace);
      setGitBranch(b.gitBranch);
      setRecentFiles(b.recentFiles);
      setDevServer(b.devServer ?? null);
      const buffers = b.recentFiles.filter(
        (e) =>
          e.source === 'buffer' &&
          typeof e.snapshotWorking === 'string' &&
          e.snapshotWorking.length > 0 &&
          /\.(html?|css|mjs|cjs|js|tsx?|md|json|svg)$/i.test(e.name),
      );
      for (const e of buffers.slice(0, 8)) {
        openFile(
          prepareActiveFileForEditor({
            name: e.name,
            workspacePath: e.workspacePath || e.name,
            content: e.snapshotWorking,
            originalContent: e.snapshotOriginal ?? '',
            source_type: 'local',
          }),
        );
      }
      if (buffers.length) {
        setOpenTabs((prev) => (prev.includes('code') ? prev : [...prev, 'code']));
        setActiveTab('code');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeAgentConversationId, openFile]);

  useEffect(() => {
    const id = activeAgentConversationId?.trim();
    if (!id) return;
    const t = window.setTimeout(() => {
      void persistIdeToApi(id, {
        v: IDE_PERSIST_VERSION,
        ideWorkspace,
        gitBranch,
        recentFiles,
        devServer,
      });
    }, 650);
    return () => clearTimeout(t);
  }, [activeAgentConversationId, ideWorkspace, gitBranch, recentFiles, devServer]);
  
  const mappedRecentFiles = useMemo(() => {
    return recentFiles.map(f => ({
      name: f.name,
      path: f.workspacePath || f.githubPath || f.r2Key || f.id,
      label: f.label
    }));
  }, [recentFiles]);

  const workspaceDashboardRecentFiles = useMemo(() => {
    if (recentFiles.length > 0) return recentFiles;
    return readRecentFilesFromLocalStorage();
  }, [recentFiles, recentFilesLsTick]);

  // Tabs: Workspace matches default activeTab (welcome had no panel — stranded tab id removed from defaults).

  /**
   * Bare agent home — desktop scene hosts composer/messages portals.
   * Phone ≤430px: exclusive owner is AgentMobileHomePanel (opaque chat surface).
   */
  const showAgentHomeScene = useMemo(
    () => isAgentBareHeroHome && activeTab === 'Workspace' && !isNarrowViewport,
    [isAgentBareHeroHome, activeTab, isNarrowViewport],
  );
  
  const activePlanIdForChat = useMemo(() => {
    const st = workspaceSamState;
    if (!st || typeof st !== 'object') return null;
    const row = st as Record<string, unknown>;
    const a = row.active_plan_id;
    const b = row.activePlanId;
    if (typeof a === 'string' && a.trim()) return a.trim();
    if (typeof b === 'string' && b.trim()) return b.trim();
    return null;
  }, [workspaceSamState]);

  const handleActivePlanChange = useCallback((planId: string | null) => {
    setWorkspaceSamState((prev) => ({
      ...(prev && typeof prev === 'object' ? prev : {}),
      active_plan_id: planId,
    }));
  }, []);

  const agentWorkbenchOpenFiles = useMemo(
    () => tabs.map((t) => t.name).filter((n) => Boolean(n && String(n).trim())).slice(0, 32),
    [tabs],
  );

  return {
    mappedRecentFiles,
    workspaceDashboardRecentFiles,
    showAgentHomeScene,
    activePlanIdForChat,
    handleActivePlanChange,
    agentWorkbenchOpenFiles,
  };
}
