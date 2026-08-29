
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from "react-router-dom";
import { isAgentNewChatPath, getAgentTabFromSearch, isAgentAtmosphericHome, isAgentCenterChatHome, isAgentEditorPath, isAgentWorkspaceBrowserPath, resolveAgentWorkspaceTab } from '../lib/agentRoutes';
import { shouldShowMonacoWorkbench } from '../lib/shellLayoutMeta';
import type { ActiveFile } from '../types';
import { BREAKPOINTS, PHONE_MQ } from '../lib/breakpoints';
import { useTerminalWorkspace } from '../hooks/useTerminalWorkspace';
import { mergeRecentFromActiveFile } from '../src/ideWorkspace';
import { DASHBOARD_STATUS_BAR_INSET, isAgentEditorDevContext, mobileTabBarBottomOffset, PREF_SHOW_STATUS_BAR, readShellBoolPref, showDashboardStatusBar, showFullIdeTopbar, SHELL_PREF_CHANGE_EVENT } from '../config/shellChrome';
import { isCmsEditorFullscreenRoute, isCmsStudioEditorRoute, parseCmsRoute } from '../pages/cms/cmsRoute';
import { useCmsWorkspaceContext } from '../hooks/useCmsWorkspaceContext';
import { useAppPanelLayout } from '../hooks/useAppPanelLayout';
import { useAppShellStatusPoll } from '../hooks/useAppShellStatusPoll';
import { useAppAgentChatTabs } from '../hooks/useAppAgentChatTabs';
import { useAppAgentChatCompose } from '../hooks/useAppAgentChatCompose';
import { useAppEditorPreview } from '../hooks/useAppEditorPreview';
import { useAppTerminalBridge } from '../hooks/useAppTerminalBridge';
import { useAppFileSave } from '../hooks/useAppFileSave';
import { useAppOpenHelpers } from '../hooks/useAppOpenHelpers';
import { useAppAgentSurfaceOpen } from '../hooks/useAppAgentSurfaceOpen';
import { useAppOpenRecentEntry } from '../hooks/useAppOpenRecentEntry';
import { useAppUnifiedNavigate } from '../hooks/useAppUnifiedNavigate';
import { useAgentSamChatHostProps } from '../hooks/useAgentSamChatHostProps';
import { useAppIdeCollabHydrate } from '../hooks/useAppIdeCollabHydrate';
import { useAppCmsAgentWorkspace } from '../hooks/useAppCmsAgentWorkspace';
import { useAppWorkspaceStatusChrome } from '../hooks/useAppWorkspaceStatusChrome';
import { useAppShellChatActions } from '../hooks/useAppShellChatActions';
import { useAppAgentNavHelpers } from '../hooks/useAppAgentNavHelpers';
import { useAppExplorerActivity } from '../hooks/useAppExplorerActivity';
import { useAppNotificationsChrome } from '../hooks/useAppNotificationsChrome';
import { AppShellFrame } from '../components/shell/AppShellFrame';
import { useAppIdeShellState, type AppShellTabId } from '../hooks/useAppIdeShellState';
import { useAppAgentPanelChrome } from '../hooks/useAppAgentPanelChrome';
import { useAppWorkspaceIdentityLabels } from '../hooks/useAppWorkspaceIdentityLabels';
import { useAppMonacoDeepLink } from '../hooks/useAppMonacoDeepLink';
import { useEditor, EditorProvider } from '../src/EditorContext';
import { useWorkspace, WorkspaceProvider } from '../src/context/WorkspaceContext';
import { persistLastSessionSnapshot } from '../src/pwa/OfflineReconnectBanner';
import { useAgentPolicy } from '../src/hooks/useAgentPolicy';
import { useAvailableConnectors } from '../src/hooks/useAvailableConnectors';

type TabId = AppShellTabId;

const DashboardRuntime: React.FC = () => {
  const { tabs, activeTabId, openFile, updateActiveContent, saveActiveFile } = useEditor();
  const activeFile = tabs.find((t) => t.id === activeTabId) || null;
  const [openTabs, setOpenTabs] = useState<TabId[]>(['Workspace']);
  const [activeTab, setActiveTab] = useState<TabId>('Workspace');
  const {
    sessionUserId,
    sessionUserName,
    sessionAvatarUrl,
    workspaceId: authWorkspaceId,
    setWorkspaceId: setAuthWorkspaceId,
    workspaces: workspaceRows,
    displayName: workspaceDisplayName,
    setDisplayName: setWorkspaceDisplayName,
    switchWorkspace,
    refreshWorkspaces,
    workspaceDrift,
  } = useWorkspace();
  const location = useLocation();
  const [isNarrowViewport, setIsNarrowViewport] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= BREAKPOINTS.PHONE_MAX,
  );
  useEffect(() => {
    const mq = window.matchMedia(PHONE_MQ);
    const fn = () => setIsNarrowViewport(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  const agentHomeTab = useMemo(
    () => getAgentTabFromSearch(location.search),
    [location.search],
  );
  const agentWorkspaceTab = useMemo(
    () => resolveAgentWorkspaceTab(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const isAgentWorkspaceBrowser = useMemo(
    () => isAgentWorkspaceBrowserPath(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const [agentHomeComposerHost, setAgentHomeComposerHost] = useState<HTMLDivElement | null>(null);
  const [agentHomeMessagesHost, setAgentHomeMessagesHost] = useState<HTMLDivElement | null>(null);
  const [designStudioComposerHost, setDesignStudioComposerHost] = useState<HTMLDivElement | null>(null);
  const [designStudioMessagesHost, setDesignStudioMessagesHost] = useState<HTMLDivElement | null>(null);
  const [designStudioEntryPhase, setDesignStudioEntryPhase] = useState(true);
  const [drawComposerHost, setDrawComposerHost] = useState<HTMLDivElement | null>(null);
  const [drawMessagesHost, setDrawMessagesHost] = useState<HTMLDivElement | null>(null);
  const [drawEntryPhase, setDrawEntryPhase] = useState(true);
  const [sketchComposerHost, setSketchComposerHost] = useState<HTMLDivElement | null>(null);
  const [sketchMessagesHost, setSketchMessagesHost] = useState<HTMLDivElement | null>(null);
  const [sketchEntryPhase, setSketchEntryPhase] = useState(true);
  const isAgentHomeAtmospheric = useMemo(
    () => isAgentCenterChatHome(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const isAgentBareHeroHome = useMemo(
    () => isAgentAtmosphericHome(location.pathname, location.search) || isAgentNewChatPath(location.pathname),
    [location.pathname, location.search],
  );
  const isAgentEditorWorkbench = useMemo(
    () => isAgentEditorPath(location.pathname),
    [location.pathname],
  );
  const fullIdeTopbar = useMemo(
    () => showFullIdeTopbar(location.pathname),
    [location.pathname],
  );
  const editorDevContext = useMemo(
    () => isAgentEditorDevContext(location.pathname, !!activeFile),
    [location.pathname, activeFile],
  );
  const [prefShowStatusBar, setPrefShowStatusBar] = useState(() =>
    readShellBoolPref(PREF_SHOW_STATUS_BAR, false),
  );
  useEffect(() => {
    const syncPref = () => setPrefShowStatusBar(readShellBoolPref(PREF_SHOW_STATUS_BAR, false));
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREF_SHOW_STATUS_BAR) syncPref();
    };
    const onShellPref = (e: Event) => {
      const key = (e as CustomEvent<{ key?: string }>).detail?.key;
      if (!key || key === PREF_SHOW_STATUS_BAR) syncPref();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(SHELL_PREF_CHANGE_EVENT, onShellPref);
    window.addEventListener('focus', syncPref);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(SHELL_PREF_CHANGE_EVENT, onShellPref);
      window.removeEventListener('focus', syncPref);
    };
  }, []);
  const showStatusBar = showDashboardStatusBar(location.pathname, {
    editorDevContext,
    userPrefShow: prefShowStatusBar,
  });
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--iam-status-bar-inset',
      showStatusBar ? DASHBOARD_STATUS_BAR_INSET : '0px',
    );
  }, [showStatusBar]);
  const isMovieModeRoute = location.pathname.startsWith('/dashboard/moviemode');
  const mobileTabBarBottom = mobileTabBarBottomOffset(showStatusBar);
  /** TODO: Movie Mode right rail — split Media bin + ChatAssistant (dual panel). */
  const isDrawRoute = location.pathname.startsWith('/dashboard/draw');
  const isSketchRoute = location.pathname.startsWith('/dashboard/sketch');
  const isCmsRoute = location.pathname.startsWith('/dashboard/cms');
  const cmsRouteParsed = useMemo(() => {
    if (!isCmsRoute) return null;
    return parseCmsRoute(location.pathname, new URLSearchParams(location.search));
  }, [isCmsRoute, location.pathname, location.search]);
  const isCmsFullscreen = isCmsEditorFullscreenRoute(
    location.pathname,
    new URLSearchParams(location.search),
  );
  const isCmsStudioEditor = isCmsStudioEditorRoute(
    location.pathname,
    new URLSearchParams(location.search),
  );

  const { context: cmsWorkspaceContext } = useCmsWorkspaceContext({
    workspaceId: authWorkspaceId,
    siteSlug: cmsRouteParsed?.siteSlug || null,
    enabled: Boolean(authWorkspaceId?.trim()),
  });
  const movieModeProjectId = useMemo(() => {
    const m = location.pathname.match(/^\/dashboard\/moviemode\/([^/?#]+)/);
    if (m?.[1]) return decodeURIComponent(m[1]);
    try {
      return new URLSearchParams(location.search).get('project_id');
    } catch {
      return null;
    }
  }, [location.pathname, location.search]);
  const navigate = useNavigate();
  const onDevServerUrlRef = useRef<((url: string) => void) | null>(null);
  const runInTerminalRef = useRef<(cmd: string) => void>(() => {});
  const termWs = useTerminalWorkspace({
    authWorkspaceId,
  });

  useEffect(() => {
    if (!sessionUserId) return;
    persistLastSessionSnapshot({
      workspaceId: authWorkspaceId,
      displayName: workspaceDisplayName,
    });
  }, [sessionUserId, authWorkspaceId, workspaceDisplayName]);

  useAppMonacoDeepLink({
    locationPathname: location.pathname,
    locationSearch: location.search,
    navigate,
    openFile,
  });

  const {
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
    agentIsStreaming, setAgentIsStreaming,
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
  } = useAppIdeShellState({ termWs });

  const {
    handleConnectionMenuAction,
    topChromeMoreOpen, setTopChromeMoreOpen,
    topChromeMoreRef,
    isWorkspaceLauncherOpen, setWorkspaceLauncherOpen,
    meetCtxValue, setMeetCtxValue,
    mobileSwipeStartRef,
    githubExpandRepo, setGithubExpandRepo,
    agentChatLayout,
    isCenterChatAtmospheric,
    isCenterAgentDesktop,
    ensureAgentSidePanel,
    showAgentWorkbenchTabs,
  } = useAppAgentPanelChrome({
    navigate,
    setIsTerminalOpen,
    setAgentBrowserPresenceActive,
    isNarrowViewport,
    agentPosition,
    setAgentPosition,
    LS_AGENT_POSITION,
    locationPathname: location.pathname,
    locationSearch: location.search,
    designStudioEntryPhase,
    drawEntryPhase,
    sketchEntryPhase,
    isCmsFullscreen,
    activeFile,
    activeTab,
    setActiveTab,
    isAgentEditorWorkbench,
    isAgentHomeAtmospheric,
    isCmsStudioEditor,
  });

  const { policy: agentsamChatPolicy } = useAgentPolicy(authWorkspaceId);
  const { connectors: availableConnectors, loading: availableConnectorsLoading } =
    useAvailableConnectors(authWorkspaceId);
  const maxTabsPolicyRef = useRef(24);
  const [workspaceSamState, setWorkspaceSamState] = useState<Record<string, unknown> | null>(null);

  const {
    workspaceDisplayFallback,
    activeWorkspaceRow,
    databaseStudioPath,
    workspaceContextLabel,
    userProfileLabel,
    toastMsg,
    setToastMsg,
    workspaceDisplayLine,
  } = useAppWorkspaceIdentityLabels({
    authWorkspaceId,
    workspaceRows,
    ideWorkspace,
    filesSourceContext,
    gitRepoFullName,
    sessionUserName,
    sessionUserId,
  });

  const {
    agentChatTabs,
    activeAgentChatTabId,
    activeAgentConversationId,
    chatMessages,
    setChatMessages,
    createNewAgentChatTab,
    createNewAgentChatTabRef,
    selectAgentChatTab,
    closeAgentChatTab,
  } = useAppAgentChatTabs({
    workspaceDisplayLine,
    pathname: location.pathname,
    search: location.search,
    navigate,
    maxTabsPolicyRef,
    agentIsStreamingRef,
    cancelLiveAgentStreamIfAny,
    setToastMsg,
    setAgentPosition,
  });

  const {
    mappedRecentFiles,
    workspaceDashboardRecentFiles,
    showAgentHomeScene,
    activePlanIdForChat,
    handleActivePlanChange,
    agentWorkbenchOpenFiles,
  } = useAppIdeCollabHydrate({
    authWorkspaceId,
    locationPathname: location.pathname,
    workspaceDisplayLine,
    activeAgentConversationId,
    openFile,
    setOpenTabs,
    setActiveTab,
    ideWorkspace,
    setIdeWorkspace,
    gitBranch,
    setGitBranch,
    recentFiles,
    setRecentFiles,
    recentFilesLsTick,
    devServer,
    setDevServer,
    workspaceSamState,
    setWorkspaceSamState,
    isAgentBareHeroHome,
    activeTab,
    agentChatLayout,
    tabs,
    isNarrowViewport,
  });

  const [browserUrl, setBrowserUrl] = useState<string>('https://inneranimalmedia.com');

  const {
    cmsAgentPageId, setCmsAgentPageId,
    cmsAgentPanel, setCmsAgentPanel,
    cmsLiveSessionId, setCmsLiveSessionId,
    cmsWorkbenchContext,
    isDesignStudioRoute,
    designStudioEntryAtmospheric,
    drawEntryAtmospheric,
    sketchEntryAtmospheric,
    routeEntryAtmospheric,
    agentWorkspaceContext,
    routeAgentMeta,
  } = useAppCmsAgentWorkspace({
    browserUrl,
    cmsWorkspaceContext,
    cmsRouteParsed,
    isCmsRoute,
    authWorkspaceId,
    activeTab,
    agentWorkbenchOpenFiles,
    activePlanIdForChat,
    locationPathname: location.pathname,
    locationSearch: location.search,
    isDrawRoute,
    isSketchRoute,
    designStudioEntryPhase,
    drawEntryPhase,
    sketchEntryPhase,
    setDesignStudioEntryPhase,
    setDesignStudioComposerHost,
    setDesignStudioMessagesHost,
    setDrawEntryPhase,
    setDrawComposerHost,
    setDrawMessagesHost,
    setSketchEntryPhase,
    setSketchComposerHost,
    setSketchMessagesHost,
    isNarrowViewport,
    ensureAgentSidePanel,
    setAgentPosition,
    activeFile,
    activeWorkspaceRow,
    ideWorkspace,
    devServer,
    shellOutputLines,
  });

  const showMonacoWorkbench = useMemo(
    () =>
      shouldShowMonacoWorkbench({
        pathname: location.pathname,
        search: location.search,
        activeTab,
        hasActiveFile: !!activeFile,
      }),
    [location.pathname, location.search, activeTab, activeFile],
  );

  const { updateActiveFile } = useEditor();
  const setActiveFile = useCallback((updates: Partial<ActiveFile> | ((prev: ActiveFile | null) => ActiveFile | null)) => {
    if (typeof updates === 'object' && updates !== null && 'content' in updates && 'name' in updates) {
      openFile(updates as ActiveFile);
    } else {
      updateActiveFile(updates);
    }
  }, [openFile, updateActiveFile]);


  const [glbViewerUrl, setGlbViewerUrl] = useState<string>(
    'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/6454d6fa-d4f1-43ec-33fd-628d0e7cdb00/public'
  );
  const [glbViewerFilename, setGlbViewerFilename] = useState('Meshy_AI_Jet.glb');

  const {
    focusAgentChat,
    runVerificationInAgent,
    persistActiveWorkspace,
    statusBarWorkspaceItems,
    handleStatusBarWorkspacePick,
    handleStatusBarBranchSelect,
    openTab,
    toggleSidebarRail,
    agentHomeGreetingName,
  } = useAppWorkspaceStatusChrome({
    ensureAgentSidePanel,
    workspaceRows,
    switchWorkspace,
    refreshWorkspaces,
    locationPathname: location.pathname,
    locationSearch: location.search,
    navigate,
    setToastMsg,
    setGitBranch,
    authWorkspaceId,
    activeAgentConversationId,
    activeTab,
    setActiveTab,
    setOpenTabs,
    ideWorkspace,
    gitBranch,
    recentFiles,
    glbViewerUrl,
    toastMsg,
    topChromeMoreOpen,
    setTopChromeMoreOpen,
    topChromeMoreRef,
    maxTabsPolicyRef,
    isNarrowViewport,
    setAgentPosition,
    setSidebarRailExpanded,
    sessionUserName,
    workspaceDisplayName,
    LS_SIDEBAR_RAIL,
  });

  const {
    shellNewChat,
    shellOpenChats,
    shellOpenChatHistory,
    shellSelectChat,
    shellDeleteActiveChat,
    shellOpenMovieMode,
    shellOpenDraw,
    shellOpenSketch,
  } = useAppShellChatActions({
    createNewAgentChatTabRef,
    locationPathname: location.pathname,
    navigate,
    isAgentHomeAtmospheric,
    isNarrowViewport,
    ensureAgentSidePanel,
    agentPosition,
    setAgentPosition,
    activeAgentConversationId,
  });

  const {
    handleAgentHomeModeSelect,
    beginQuickstartTemplate,
  } = useAppAgentChatCompose({
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
  });

  const {
    sidebarW,
    setSidebarW,
    mobileActivityPanelVh,
    setMobileActivityPanelVh,
    agentW,
    setAgentW,
    editorPreviewSplitRef,
    editorPreviewEditorPct,
    setEditorPreviewEditorPct,
    terminalDrawerH,
    setTerminalDrawerH,
    beginPanelResize,
    beginEditorPreviewResize,
    beginMobileActivitySheetResize,
    beginTerminalResize,
    clampTerminalH,
  } = useAppPanelLayout({
    activeActivity,
    sidebarRailExpanded,
    agentPosition,
  });

  const revealMainWorkspaceIfNarrow = useCallback(() => {
    if (!isNarrowViewport) return;
    if (agentPosition !== 'off') setAgentPosition('off');
  }, [isNarrowViewport, agentPosition]);

  const {
    terminalRef,
    runInTerminal,
    handleTerminalOutputLine,
  } = useAppTerminalBridge({
    terminalDrawerH,
    setDevServer,
    onDevServerUrlRef,
    isTerminalOpen,
    setIsTerminalOpen,
    setShellOutputLines,
  });
  runInTerminalRef.current = runInTerminal;

  const {
    browserAddressDisplay,
    setBrowserAddressDisplay,
    browserTabTitle,
    setBrowserTabTitle,
    browserPreviewSource,
    setBrowserPreviewSource,
    editorPreviewOpen,
    setEditorPreviewOpen,
    mdViewMode,
    setMdViewMode,
    editorPreviewMode,
    setEditorPreviewMode,
    editorPreviewSrcDoc,
    editorPreviewUrl,
    setEditorPreviewUrl,
    editorPreviewLoading,
    editorPreviewStatus,
    handleBrowserNavigateFromAgent,
    openBrowserTab,
    closeEditorPreview,
    openEditorPreview,
  } = useAppEditorPreview({
    activeFile,
    ideWorkspace,
    devServer,
    runInTerminalRef,
    setToastMsg,
    setOpenTabs,
    setActiveTab,
    revealMainWorkspaceIfNarrow,
    isNarrowViewport,
    activeAgentRunId,
    onDevServerUrlRef,
    setBrowserUrl,
  });


  const {
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
  } = useAppAgentNavHelpers({
    openTabs,
    setOpenTabs,
    activeTab,
    setActiveTab,
    setBrowserAddressDisplay,
    setBrowserTabTitle,
    isAgentBareHeroHome,
    chatMessages,
    isAgentHomeAtmospheric,
    isNarrowViewport,
    setAgentPosition,
    setFilesSourceContext,
    setIdeWorkspace,
    setGitRepoFullName,
    navigate,
    setActiveActivity,
    agentChatLayout,
    agentPosition,
    activeAgentConversationId,
    locationPathname: location.pathname,
    locationSearch: location.search,
    setGithubExpandRepo,
  });

  const { isDirty, handleSaveFile, handleR2FileUpdatedFromAgent } = useAppFileSave({
    activeFile,
    setActiveFile,
    setToastMsg,
    setOpenTabs,
    setActiveTab,
    revealMainWorkspaceIfNarrow,
    isNarrowViewport,
  });


  const {
    openInMonacoFromChat,
    focusMobileCodeContext,
    engageAgentEditorWorkbench,
    openNewEditorFile,
    focusCodeEditorFromChat,
    openEditorFromChat,
    openInEditorFromExplorer,
    onExplorerWorkspaceRootChange,
  } = useAppOpenHelpers({
    agentPosition,
    setAgentPosition,
    setActiveFile,
    setRecentFiles,
    mergeRecentFromActiveFile,
    revealMainWorkspaceIfNarrow,
    setOpenTabs,
    setActiveTab,
    setActiveActivity,
    setToastMsg,
    setNativeFolderOpenSignal,
    isNarrowViewport,
    openFile,
    openTab,
    navigate,
    locationPathname: location.pathname,
    isAgentEditorWorkbench,
    activeFile,
    setIdeWorkspace,
    authWorkspaceId,
    workspaceRows,
    switchWorkspace,
  });


  const { consumeGithubExpandRepo } = useAppAgentSurfaceOpen({
    revealMainWorkspaceIfNarrow,
    isNarrowViewport,
    setCmsAgentPageId,
    setCmsAgentPanel,
    openTab,
    setToastMsg,
    shellOpenDraw,
    shellOpenSketch,
    navigate,
    locationPathname: location.pathname,
    devServer,
    setBrowserPreviewSource,
    setBrowserAddressDisplay,
    setBrowserTabTitle,
    setBrowserUrl,
    openFile,
    setIsTerminalOpen,
    setActiveActivity,
    setGithubExpandRepo,
  });


  const { openRecentEntry } = useAppOpenRecentEntry({
    activeFile,
    setActiveFile,
    setRecentFiles,
    setRecentFilesLsTick,
    setToastMsg,
    revealMainWorkspaceIfNarrow,
    setOpenTabs,
    setActiveTab,
  });

  const { toggleExplorer, toggleActivity, openAgentThreadFromProblems } = useAppExplorerActivity({
    locationPathname: location.pathname,
    navigate,
    isNarrowViewport,
    focusMobileCodeContext,
    engageAgentEditorWorkbench,
    setActiveActivity,
    activeActivity,
    setIsTerminalOpen,
    terminalRef,
    setAgentPosition,
    hasActiveFile: Boolean(activeFile),
  });

  const { handleUnifiedNavigate } = useAppUnifiedNavigate({
    navigate,
    gitRepoFullName,
    activeWorkspaceRow,
    revealMainWorkspaceIfNarrow,
    setActiveFile,
    setAgentPosition,
    setBrowserPreviewSource,
    setBrowserAddressDisplay,
    setBrowserTabTitle,
    setBrowserUrl,
    setOpenTabs,
    setActiveTab,
    setActiveActivity,
  });

  const {
    fetchLiveStatus,
    fetchGitAndProblems,
    handleGitSyncPublish,
    fetchSecurityShieldPulse,
  } = useAppShellStatusPoll({
    sessionUserId,
    authWorkspaceId,
    agentsamChatPolicy,
    maxTabsPolicyRef,
    setHealthOk,
    setSandboxOk,
    setTunnelHealthy,
    setTunnelLabel,
    setTunnelStale,
    setTerminalOk,
    setAgentNotifications,
    setGitBranch,
    setGitRepoFullName,
    setGitAhead,
    setGitBehind,
    setGitTrackingBranch,
    setGitHash,
    setGitSyncBusy,
    setSystemProblems,
    setErrorCount,
    setWarningCount,
    setSecurityShieldAlert,
    setSecurityBannerDismissed,
    setToastMsg,
  });

  const {
    markNotificationRead,
    openNotificationDestination,
    cycleAgentPosition,
    onChatLayoutToggle,
    onMobileBottomChatTab,
    mobileEdgeSwipeHandlers,
    handleMainFileDrop,
    handleMainDragOver,
    narrowBlocksCenter,
    narrowNeedsBack,
    mobileBackLabel,
    statusIndentLabel,
    platformHealthIssues,
  } = useAppNotificationsChrome({
    navigate,
    locationPathname: location.pathname,
    locationSearch: location.search,
    setAgentNotifications,
    setFocusNotificationId,
    isNarrowViewport,
    activeActivity,
    setActiveActivity,
    setAgentPosition,
    engageAgentEditorWorkbench,
    agentChatLayout,
    agentPosition,
    isDesignStudioRoute,
    mobileSwipeStartRef,
    narrowBackToCenter,
    editorMeta,
    healthOk,
    tunnelHealthy,
    tunnelStale,
    terminalOk,
    sandboxOk,
    workspaceDrift,
  });

  const { agentSamChatHostProps } = useAgentSamChatHostProps({
    showAgentWorkbenchTabs,
    agentChatTabs,
    navigate,
    setGlbViewerUrl,
    setGlbViewerFilename,
    activeProject,
    activeFile,
    cursorPos,
    agentsamChatPolicy,
    authWorkspaceId,
    isCmsRoute,
    designStudioEntryAtmospheric,
    drawEntryAtmospheric,
    sketchEntryAtmospheric,
    chatMessages,
    setChatMessages,
    shellOpenChatHistory,
    shellDeleteActiveChat,
    openInMonacoFromChat,
    runInTerminal,
    handleR2FileUpdatedFromAgent,
    handleBrowserNavigateFromAgent,
    openGitHubFromChat,
    openDashboardFromChat,
    openAgentQuickstart,
    focusCodeEditorFromChat,
    openEditorFromChat,
    setAgentIsStreaming,
    setActiveCommandRunId,
    activeCommandRunId,
    activeAgentConversationId,
    activeAgentChatTabId,
    selectAgentChatTab,
    closeAgentChatTab,
    createNewAgentChatTab,
    setActiveAgentRunId,
    isMovieModeRoute,
    isDesignStudioRoute,
    activeTab,
    isDrawRoute,
    isSketchRoute,
    browserUrl,
    agentWorkbenchOpenFiles,
    activePlanIdForChat,
    handleActivePlanChange,
    cmsWorkbenchContext,
    agentWorkspaceContext,
    routeAgentMeta,
    availableConnectors,
    availableConnectorsLoading,
  });

  return (
    <AppShellFrame
      {...{
        activeActivity, activeAgentConversationId, activeAgentRunId, activeFile, activeTab, activeWorkspaceRow, agentBrowserPresenceActive, agentChatLayout, agentHomeComposerHost, agentHomeGreetingName, agentHomeMessagesHost, agentHomeShowHero, agentNotifications, agentPosition,
        agentSamChatHostProps, agentW, agentWorkspaceContext, agentWorkspaceTab, beginEditorPreviewResize, beginMobileActivitySheetResize, beginPanelResize, beginQuickstartTemplate, beginTerminalResize, browserAddressDisplay, browserPreviewSource, browserTabTitle,
        browserUrl, closeEditorPreview, closeTab, cmsWorkbenchContext, consumeGithubExpandRepo, cursorPos, designStudioComposerHost, designStudioEntryAtmospheric, designStudioMessagesHost, drawComposerHost, drawEntryAtmospheric, drawMessagesHost,
        editorDevContext, editorMeta, editorPreviewEditorPct, editorPreviewLoading, editorPreviewMode, editorPreviewOpen, editorPreviewSplitRef, editorPreviewSrcDoc, editorPreviewStatus, editorPreviewUrl, engageAgentEditorWorkbench, errorCount,
        fetchGitAndProblems, focusCodeEditorFromChat, focusNotificationId, fullIdeTopbar, gitAhead, gitBehind, gitBranch, gitHash, gitRepoFullName, gitSyncBusy, gitTrackingBranch, githubExpandRepo,
        handleAgentHomeModeSelect, handleAgentTabChange, handleConnectionMenuAction, handleEditorCursorPosition, handleGitSyncPublish, handleMainDragOver, handleMainFileDrop, handleSaveFile, handleStatusBarBranchSelect, handleStatusBarWorkspacePick, handleTerminalOutputLine, handleUnifiedNavigate,
        healthOk, isAgentEditorWorkbench, isAgentWorkspaceBrowser, isCenterChatAtmospheric, isCmsFullscreen, isDirty, isNarrowViewport, isTerminalOpen, isWorkspaceLauncherOpen, location, mappedRecentFiles, markNotificationRead,
        mdViewMode, meetCtxValue, mobileActivityPanelVh, mobileBackLabel, mobileEdgeSwipeHandlers, mobileHamburgerConversationBack, mobileMoreOpen, mobileNavOpen, narrowBackToAgentHome, narrowBackToCenter, narrowBlocksCenter, narrowNeedsBack,
        nativeFolderOpenSignal, navigate, onChatLayoutToggle, onExplorerWorkspaceRootChange, onUnifiedSearchOpenChange, openAgentQuickstart, openEditorPreview, openGitHubFromChat, openInEditorFromExplorer, openNewEditorFile, openNotificationDestination, openRecentEntry,
        openTab, openTabs, persistActiveWorkspace, platformHealthIssues, refreshWorkspaces, routeEntryAtmospheric, runVerificationInAgent, searchInitialFacets, searchInitialQuery, searchOpen, securityBannerDismissed, securityShieldAlert,
        sessionAvatarUrl, sessionUserId, sessionUserName, setActiveActivity, setActiveTab, setAgentHomeComposerHost, setAgentHomeMessagesHost, setBrowserAddressDisplay, setBrowserPreviewSource, setBrowserTabTitle, setBrowserUrl, setDesignStudioComposerHost,
        setDesignStudioEntryPhase, setDesignStudioMessagesHost, setDrawComposerHost, setDrawEntryPhase, setDrawMessagesHost, setEditorMeta, setEditorPreviewUrl, setIsTerminalOpen, setMdViewMode, setMeetCtxValue, setMobileMoreOpen, setMobileNavOpen,
        setNativeFolderOpenSignal, setSearchInitialQuery, setSearchOpen, setSecurityBannerDismissed, setSketchComposerHost, setSketchEntryPhase, setSketchMessagesHost, setToastMsg, setTopChromeMoreOpen, setWorkspaceLauncherOpen, shellDeleteActiveChat, shellNewChat,
        shellOpenChats, shellOpenDraw, shellOpenMovieMode, shellOutputLines, shellSelectChat, showAgentHomeScene, showMonacoWorkbench, showStatusBar, sidebarRailExpanded, sidebarW, sketchComposerHost, sketchEntryAtmospheric,
        sketchMessagesHost, statusBarWorkspaceItems, statusIndentLabel, switchWorkspace, systemProblems, termWs, terminalDrawerH, terminalOk, terminalRef, toastMsg, toggleActivity, toggleSidebarRail,
        topChromeMoreOpen, topChromeMoreRef, tunnelHealthy, tunnelLabel, userProfileLabel, warningCount, workspaceContextLabel, workspaceDashboardRecentFiles, workspaceDisplayLine, workspaceSamState,
        authWorkspaceId, workspaceRows, mobileTabBarBottom, setAuthWorkspaceId, setFocusNotificationId, setWorkspaceDisplayName,
      }}
    />
  );

};

export function DashboardApp() {
  return (
    <EditorProvider>
      <WorkspaceProvider>
        <DashboardRuntime />
      </WorkspaceProvider>
    </EditorProvider>
  );
}

export default DashboardApp;
