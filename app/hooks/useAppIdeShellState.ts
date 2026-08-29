/** IDE shell local state + search palette + stream cancel (Wave 2). */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BREAKPOINTS } from '../lib/breakpoints';
import { isAgentCenterChatHome, isAgentEditorPath } from '../lib/agentRoutes';
import { LS_AGENT_CHAT_CONVERSATION_ID } from '../agentChatConstants';
import { cancelAgentChatRun } from '../lib/cancelAgentChatRun';
import { IAM_OPEN_COMMAND_PALETTE, type OpenCommandPaletteDetail } from '../src/lib/openCommandPalette';
import { readDashboardBootstrapCache } from '../src/loadDashboardBootstrap';
import type { EditorModelMeta } from '../types/editorModel';
import type { AgentNotificationRow } from '../components/StatusBar';
import { ProjectType } from '../types';
import type { IdeWorkspaceSnapshot, RecentFileEntry, DevServerState } from '../src/ideWorkspace';
import type { AgentSamFsSourceContext } from '../src/lib/agentSamFilesystemTypes';
import type { AgentPanelPosition } from './useAppPanelLayout';

export type AppShellTabId = 'Workspace' | 'welcome' | 'code' | 'browser' | 'glb' | 'cms';

export function useAppIdeShellState(opts: {
  termWs: {
    ptyReady: boolean;
    splashStatus: unknown;
    statusLoading: boolean;
  };
}) {
  const { termWs } = opts;

  const [activeProject] = useState<ProjectType>(ProjectType.SANDBOX);

  // IDE State
  const [activeActivity, setActiveActivity] = useState<'files' | 'mcps' | 'git' | 'debug' | 'actions' | 'drive' | null>(null);
  const LS_SIDEBAR_RAIL = 'iam_sidebar_expanded';
  /** User-chosen agent column side; survives reloads (not overwritten by workspace policy fetch). */
  const LS_AGENT_POSITION = 'iam_agent_position';
  const [sidebarRailExpanded, setSidebarRailExpanded] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      const v = localStorage.getItem(LS_SIDEBAR_RAIL);
      if (v === '0') return false;
      if (v === '1') return true;
    } catch {
      /* ignore */
    }
    return true;
  });
  const [agentPosition, setAgentPosition] = useState<'right' | 'left' | 'off'>(() => {
    if (typeof window === 'undefined') return 'off';
    if (window.innerWidth <= BREAKPOINTS.PHONE_MAX) return 'off';
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      const search = window.location.search;
      if (isAgentCenterChatHome(path, search) && !isAgentEditorPath(path)) return 'off';
      // Editor landing always starts with agentPosition='off' so center layout wins until a file opens.
      if (isAgentEditorPath(path)) return 'off';
    }
    try {
      const v = localStorage.getItem(LS_AGENT_POSITION);
      if (v === 'left' || v === 'right' || v === 'off') return v;
    } catch {
      /* ignore */
    }
    return 'off';
  });

  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  /** Mirrored from Lab shell for Output tab (build / r2 / help). */
  const [shellOutputLines, setShellOutputLines] = useState<string[]>([]);

  const [ideWorkspace, setIdeWorkspace] = useState<IdeWorkspaceSnapshot>(() => ({ source: 'none' }));
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>([]);
  const [recentFilesLsTick, setRecentFilesLsTick] = useState(0);
  const [gitBranch, setGitBranch] = useState(() => '');
  const [gitRepoFullName, setGitRepoFullName] = useState(() => '');
  /** Live Files-rail bind (SSOT for greeting / chrome — not D1 workspace.github_repo). */
  const [filesSourceContext, setFilesSourceContext] = useState<AgentSamFsSourceContext | null>(null);
  const [gitAhead, setGitAhead] = useState<number | null>(null);
  const [gitBehind, setGitBehind] = useState<number | null>(null);
  const [gitTrackingBranch, setGitTrackingBranch] = useState<string | null>(null);
  const [gitSyncBusy, setGitSyncBusy] = useState(false);
  const [devServer, setDevServer] = useState<DevServerState | null>(null);
  const [gitHash, setGitHash] = useState<string | null>(null);
  const [errorCount, setErrorCount] = useState(0);
  const [warningCount, setWarningCount] = useState(0);
  const [systemProblems, setSystemProblems] = useState<any>([]);
  const [securityShieldAlert, setSecurityShieldAlert] = useState<{
    message: string;
    details_url: string;
    open_findings_count: number;
    audit_events_24h: number;
  } | null>(null);
  const [securityBannerDismissed, setSecurityBannerDismissed] = useState(false);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [sandboxOk, setSandboxOk] = useState<boolean | null>(null);
  const [tunnelHealthy, setTunnelHealthy] = useState<boolean | null>(null);
  const [tunnelStale, setTunnelStale] = useState(false);
  const [tunnelLabel, setTunnelLabel] = useState<string | null>(null);
  const [terminalOk, setTerminalOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (termWs.ptyReady) {
      setTerminalOk(true);
      return;
    }
    const boot = readDashboardBootstrapCache();
    if (boot?.status?.terminal?.ready === true) return;
    if (termWs.splashStatus == null && !termWs.statusLoading) return;
    if (!termWs.statusLoading) setTerminalOk(false);
  }, [termWs.splashStatus, termWs.ptyReady, termWs.statusLoading]);
  const [editorMeta, setEditorMeta] = useState<EditorModelMeta>({
    tabSize: 2,
    insertSpaces: true,
    eol: 'LF',
    encoding: 'UTF-8',
  });
  const [agentNotifications, setAgentNotifications] = useState<AgentNotificationRow[]>([]);
  const [focusNotificationId, setFocusNotificationId] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const handleEditorCursorPosition = useCallback((line: number, col: number) => {
    setCursorPos((prev) => (prev.line === line && prev.col === col ? prev : { line, col }));
  }, []);
  /** Increment to trigger File System Access picker from Welcome "Open Folder" after files panel mounts. */
  const [nativeFolderOpenSignal, setNativeFolderOpenSignal] = useState(0);
  /** ≤430px: secondary rail actions (sheet above bottom tab bar). */
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  /** ≤430px: glass hamburger → left nav drawer (same destinations as desktop rail). */
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [agentIsStreaming, setAgentIsStreaming] = useState(false);
  const agentIsStreamingRef = useRef(false);
  const [agentBrowserPresenceActive, setAgentBrowserPresenceActive] = useState(false);
  const [activeCommandRunId, setActiveCommandRunId] = useState<string | null>(null);
  /** `agentsam_agent_run.id` from chat SSE context — separate from command_run approval id. */
  const [activeAgentRunId, setActiveAgentRunId] = useState<string | null>(null);
  const activeAgentRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    agentIsStreamingRef.current = agentIsStreaming;
  }, [agentIsStreaming]);
  useEffect(() => {
    activeAgentRunIdRef.current = activeAgentRunId;
  }, [activeAgentRunId]);
  /** Sync streaming ref immediately — useEffect lag let path/hydrate cancel mid-send. */
  const setAgentIsStreamingSafe = useCallback((next: boolean) => {
    agentIsStreamingRef.current = next;
    setAgentIsStreaming(next);
    if (!next) {
      setActiveCommandRunId(null);
      setActiveAgentRunId(null);
      activeAgentRunIdRef.current = null;
    }
  }, []);
  /** Deliberate leave / force-hydrate away from a live stream — cancel server + abort SSE. */
  const cancelLiveAgentStreamIfAny = useCallback(() => {
    // Always dispatch abort — hang can leave isLoading true before run id / streaming flag lands.
    let conversationId: string | null = null;
    try {
      conversationId = localStorage.getItem(LS_AGENT_CHAT_CONVERSATION_ID)?.trim() || null;
    } catch {
      conversationId = null;
    }
    cancelAgentChatRun(activeAgentRunIdRef.current, { conversationId });
    agentIsStreamingRef.current = false;
    setAgentIsStreaming(false);
    setActiveCommandRunId(null);
    setActiveAgentRunId(null);
    activeAgentRunIdRef.current = null;
  }, []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInitialFacets, setSearchInitialFacets] = useState<string[]>([]);
  const [searchInitialQuery, setSearchInitialQuery] = useState('');
  const onUnifiedSearchOpenChange = useCallback((next: boolean) => {
    setSearchOpen(next);
    if (!next) {
      setSearchInitialFacets([]);
      setSearchInitialQuery('');
    }
  }, []);

  useEffect(() => {
    const onPalette = (e: Event) => {
      const detail = (e as CustomEvent<OpenCommandPaletteDetail>).detail ?? {};
      if (detail.query) setSearchInitialQuery(detail.query);
      if (detail.facets?.length) setSearchInitialFacets(detail.facets);
      else if (detail.chip === 'commands') setSearchInitialFacets(['commands']);
      else if (detail.chip === 'd1') setSearchInitialFacets(['d1']);
      else if (detail.chip === 'files') setSearchInitialFacets(['files']);
      setSearchOpen(true);
    };
    window.addEventListener(IAM_OPEN_COMMAND_PALETTE, onPalette as EventListener);
    return () => window.removeEventListener(IAM_OPEN_COMMAND_PALETTE, onPalette as EventListener);
  }, []);

  return {
    activeProject,
    activeActivity, setActiveActivity,
    LS_SIDEBAR_RAIL,
    LS_AGENT_POSITION,
    sidebarRailExpanded, setSidebarRailExpanded,
    agentPosition, setAgentPosition,
    isTerminalOpen, setIsTerminalOpen,
    shellOutputLines, setShellOutputLines,
    ideWorkspace, setIdeWorkspace,
    recentFiles, setRecentFiles,
    recentFilesLsTick, setRecentFilesLsTick,
    gitBranch, setGitBranch,
    gitRepoFullName, setGitRepoFullName,
    filesSourceContext, setFilesSourceContext,
    gitAhead, setGitAhead,
    gitBehind, setGitBehind,
    gitTrackingBranch, setGitTrackingBranch,
    gitSyncBusy, setGitSyncBusy,
    devServer, setDevServer,
    gitHash, setGitHash,
    errorCount, setErrorCount,
    warningCount, setWarningCount,
    systemProblems, setSystemProblems,
    securityShieldAlert, setSecurityShieldAlert,
    securityBannerDismissed, setSecurityBannerDismissed,
    healthOk, setHealthOk,
    sandboxOk, setSandboxOk,
    tunnelHealthy, setTunnelHealthy,
    tunnelStale, setTunnelStale,
    tunnelLabel, setTunnelLabel,
    terminalOk, setTerminalOk,
    editorMeta, setEditorMeta,
    agentNotifications, setAgentNotifications,
    focusNotificationId, setFocusNotificationId,
    cursorPos,
    handleEditorCursorPosition,
    nativeFolderOpenSignal, setNativeFolderOpenSignal,
    mobileMoreOpen, setMobileMoreOpen,
    mobileNavOpen, setMobileNavOpen,
    agentIsStreaming, setAgentIsStreaming: setAgentIsStreamingSafe,
    agentIsStreamingRef,
    agentBrowserPresenceActive, setAgentBrowserPresenceActive,
    activeCommandRunId, setActiveCommandRunId,
    activeAgentRunId, setActiveAgentRunId,
    activeAgentRunIdRef,
    cancelLiveAgentStreamIfAny,
    searchOpen, setSearchOpen,
    searchInitialFacets, setSearchInitialFacets,
    searchInitialQuery, setSearchInitialQuery,
    onUnifiedSearchOpenChange,
  };
}
