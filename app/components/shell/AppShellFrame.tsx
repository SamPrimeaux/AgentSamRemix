/** App shell JSX frame (Wave 2 E7/E8). */
import React, { Suspense, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { MeetProvider } from '../../src/MeetContext';
import { OfflineReconnectBanner } from '../../src/pwa/OfflineReconnectBanner';
import { InstallCoach } from '../../src/pwa/InstallCoach';
import { PwaUpdateBanner } from '../../src/pwa/PwaUpdateBanner';
import { SessionExpiredGate } from '../../src/pwa/SessionExpiredGate';
import { MobileNavShell } from './MobileNavShell';
import { MobileNavHamburger } from './MobileNavHamburger';
import { AgentSamChatHost } from './AgentSamChatHost';
import { DashboardSidebar } from './DashboardSidebar';
import { MobileMoreRow, Tab, QuickOpen } from './AppShellChromeBits';
import { UnifiedSearchBar } from '../UnifiedSearchBar';
import { WorkspaceLauncher } from '../WorkspaceLauncher';
import { StatusBar } from '../StatusBar';
import { SecurityShieldBanner } from '../SecurityShieldBanner';
import { EditorPreviewPane } from '../EditorPreviewPane';
import { DesignStudioProvider } from '../designstudio/DesignStudioContext';
import { AgentHome } from '../agent/AgentHome';
import { EditorWorkbenchLanes } from '../agent/EditorWorkbenchLanes';
import { AgentQuickstartPage } from '../AgentQuickstartPage';
import { MeetShellPanel } from '../MeetShellPanel';
import { ExtensionsPanel } from '../ExtensionsPanel';
import { WorkspaceDashboard } from '../WorkspaceDashboard';
import { WorkspaceDashboardV2 } from '../WorkspaceDashboardV2';
import { DashboardAppRoutes } from '../../DashboardAppRoutes';
import {
  MonacoEditorView, BrowserView, AgentSamFilesystem, GitHubExplorer, GoogleDriveExplorer,
  SourcePanel, MCPPanel, XTermShell, ActivityPanelFallback,
  DashboardRoutesFallback,
} from '../../lazyDashboardPages';
import { SetiFileIcon } from '../../src/components/SetiFileIcon';
import {
  Files, Search, GitBranch, Settings, PanelLeftClose, PanelRightClose, Terminal as TermIcon,
  Layers, Monitor, Bug, FolderCode, FolderTree, Globe, PenTool, Cloud, X as XIcon, Eye,
  MoreHorizontal, ChevronLeft, Link2, History, FileCode2, Rocket,
} from 'lucide-react';
import { isRenderablePreviewFilename, previewButtonTitle } from '../../lib/appShellPreview';
import { AGENT_RESIZER_HIT_PX, ACTIVITY_SIDEBAR_GRAB_PX, EDITOR_PREVIEW_PANEL_MIN_PX } from '../../lib/appShellLayout';
import { PRODUCT_NAME } from '../../lib/appShellConstants';
import { databaseStudioPathForWorkspace } from '../../src/lib/databaseStudioRoute';
import type { RecentFileEntry } from '../../src/ideWorkspace';
import { BREAKPOINTS, PHONE_MQ } from '../../lib/breakpoints';
import { openCommandPalette } from '../../src/lib/openCommandPalette';
import { SHELL_VERSION } from '../../src/shellVersion';
import { syncIamAppBadge } from '../../src/pwa/appBadge';
import {
  AGENT_HOME_PATH, AGENT_EDITOR_PATH, AGENT_WORKSPACE_PATH,
  AGENT_QUICKSTART_PATH, AGENT_NEW_CHAT_PATH,
  isAgentShellPath, isAgentEditorPath, isAgentHomePath, isAgentNewChatPath, isAgentQuickstartPath,
} from '../../lib/agentRoutes';

export type AppShellFrameProps = Record<string, any>;

type ShellActivity = 'files' | 'mcps' | 'git' | 'debug' | 'actions' | 'drive' | null;

export function AppShellFrame(_p: AppShellFrameProps) {
  const {
    setFocusNotificationId,
    setWorkspaceDisplayName,
    setAuthWorkspaceId,
    workspaceRows,
    authWorkspaceId,
    activeActivity,
    activeAgentConversationId,
    activeAgentRunId,
    activeFile,
    activeTab,
    activeWorkspaceRow,
    agentBrowserPresenceActive,
    agentChatLayout,
    agentHomeComposerHost,
    agentHomeGreetingName,
    agentHomeMessagesHost,
    agentHomeShowHero,
    agentNotifications,
    agentPosition,
    agentSamChatHostProps,
    agentW,
    agentWorkspaceContext,
    agentWorkspaceTab,
    beginEditorPreviewResize,
    beginMobileActivitySheetResize,
    beginPanelResize,
    beginQuickstartTemplate,
    beginTerminalResize,
    browserAddressDisplay,
    browserPreviewSource,
    browserTabTitle,
    browserUrl,
    closeEditorPreview,
    closeTab,
    cmsWorkbenchContext,
    consumeGithubExpandRepo,
    cursorPos,
    designStudioComposerHost,
    designStudioEntryAtmospheric,
    designStudioMessagesHost,
    drawComposerHost,
    drawEntryAtmospheric,
    drawMessagesHost,
    editorDevContext,
    editorMeta,
    editorPreviewEditorPct,
    editorPreviewLoading,
    editorPreviewMode,
    editorPreviewOpen,
    editorPreviewSplitRef,
    editorPreviewSrcDoc,
    editorPreviewStatus,
    editorPreviewUrl,
    engageAgentEditorWorkbench,
    errorCount,
    fetchGitAndProblems,
    focusCodeEditorFromChat,
    focusNotificationId,
    fullIdeTopbar,
    gitAhead,
    gitBehind,
    gitBranch,
    gitHash,
    gitRepoFullName,
    gitSyncBusy,
    gitTrackingBranch,
    githubExpandRepo,
    handleAgentHomeModeSelect,
    handleAgentTabChange,
    handleConnectionMenuAction,
    handleEditorCursorPosition,
    handleGitSyncPublish,
    handleMainDragOver,
    handleMainFileDrop,
    handleSaveFile,
    handleStatusBarBranchSelect,
    handleStatusBarWorkspacePick,
    handleTerminalOutputLine,
    handleUnifiedNavigate,
    healthOk,
    isAgentEditorWorkbench,
    isAgentWorkspaceBrowser,
    isCenterChatAtmospheric,
    isCmsFullscreen,
    isDirty,
    isNarrowViewport,
    isTerminalOpen,
    isWorkspaceLauncherOpen,
    location,
    mappedRecentFiles,
    markNotificationRead,
    mdViewMode,
    meetCtxValue,
    mobileActivityPanelVh,
    mobileEdgeSwipeHandlers,
    mobileHamburgerConversationBack,
    mobileMoreOpen,
    mobileNavOpen,
    narrowBackToAgentHome,
    narrowBackToCenter,
    narrowBlocksCenter,
    narrowNeedsBack,
    nativeFolderOpenSignal,
    navigate,
    onChatLayoutToggle,
    onExplorerWorkspaceRootChange,
    onUnifiedSearchOpenChange,
    openAgentQuickstart,
    openEditorPreview,
    openGitHubFromChat,
    openInEditorFromExplorer,
    openNewEditorFile,
    openNotificationDestination,
    openRecentEntry,
    openTab,
    openTabs,
    persistActiveWorkspace,
    platformHealthIssues,
    refreshWorkspaces,
    routeEntryAtmospheric,
    runVerificationInAgent,
    searchInitialFacets,
    searchInitialQuery,
    searchOpen,
    securityBannerDismissed,
    securityShieldAlert,
    sessionAvatarUrl,
    sessionUserId,
    sessionUserName,
    setActiveActivity,
    setActiveTab,
    setAgentHomeComposerHost,
    setAgentHomeMessagesHost,
    setBrowserAddressDisplay,
    setBrowserPreviewSource,
    setBrowserTabTitle,
    setBrowserUrl,
    setDesignStudioComposerHost,
    setDesignStudioEntryPhase,
    setDesignStudioMessagesHost,
    setDrawComposerHost,
    setDrawEntryPhase,
    setDrawMessagesHost,
    setEditorMeta,
    setEditorPreviewUrl,
    setIsTerminalOpen,
    setMdViewMode,
    setMeetCtxValue,
    setMobileMoreOpen,
    setMobileNavOpen,
    setNativeFolderOpenSignal,
    setSearchInitialQuery,
    setSearchOpen,
    setSecurityBannerDismissed,
    setSketchComposerHost,
    setSketchEntryPhase,
    setSketchMessagesHost,
    setToastMsg,
    setTopChromeMoreOpen,
    setWorkspaceLauncherOpen,
    shellDeleteActiveChat,
    shellNewChat,
    shellOpenChats,
    shellOpenDraw,
    shellOpenMovieMode,
    shellOutputLines,
    shellSelectChat,
    showAgentHomeScene,
    showMonacoWorkbench,
    showStatusBar,
    sidebarRailExpanded,
    sidebarW,
    sketchComposerHost,
    sketchEntryAtmospheric,
    sketchMessagesHost,
    statusBarWorkspaceItems,
    statusIndentLabel,
    switchWorkspace,
    systemProblems,
    termWs,
    terminalDrawerH,
    terminalOk,
    terminalRef,
    toastMsg,
    toggleActivity,
    toggleSidebarRail,
    topChromeMoreOpen,
    topChromeMoreRef,
    tunnelHealthy,
    tunnelLabel,
    userProfileLabel,
    warningCount,
    workspaceContextLabel,
    workspaceDashboardRecentFiles,
    workspaceDisplayLine,
    workspaceSamState,
  } = _p;

  useEffect(() => {
    syncIamAppBadge(agentNotifications.length);
  }, [agentNotifications.length]);

  return (

    <DesignStudioProvider>
    <div className="w-full h-[100dvh] bg-[var(--dashboard-canvas)] overflow-hidden text-[var(--dashboard-text)] font-sans flex flex-col">
      {!isCmsFullscreen ? <OfflineReconnectBanner /> : null}
      {!isCmsFullscreen ? <PwaUpdateBanner /> : null}
      {!isCmsFullscreen ? <SessionExpiredGate /> : null}
      {!isCmsFullscreen ? <InstallCoach /> : null}
      <div
        className="iam-agent-browser-live-vignette"
        data-active={agentBrowserPresenceActive ? 'true' : 'false'}
        aria-hidden="true"
      />
      {/* 1. TOP WINDOW BAR + mobile hamburger (sticky ≤430px) — hidden in fullscreen CMS editor */}
      {!isCmsFullscreen ? (
      <header
        className="iam-chrome-topbar shrink-0 z-[110] max-phone:sticky max-phone:top-0"
        data-agent-conversation={mobileHamburgerConversationBack ? 'true' : 'false'}
      >
      <div className="h-10 border-b border-[var(--dashboard-border)] flex items-center justify-between px-3 overflow-visible relative">
          <div className="flex items-center gap-1 pl-1 shrink-0 min-w-0">
              {/* Mobile: hamburger (MobileNavShell inline) then logo */}
              <div className="hidden max-phone:flex items-center shrink-0">
                <MobileNavHamburger
                  open={mobileNavOpen}
                  backMode={false}
                  onClick={() => setMobileNavOpen((v: boolean) => !v)}
                />
              </div>
              {/* IAM logo — tap to open workspace/store switcher (Shopify-style) */}
              <button
                type="button"
                title={`${workspaceDisplayLine} — tap to switch workspace`}
                onClick={() => setWorkspaceLauncherOpen(true)}
                className={`flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-[var(--bg-hover)] transition-colors group shrink-0 ${mobileHamburgerConversationBack ? 'max-phone:hidden' : ''}`}
                aria-label="Switch workspace"
              >
                <img
                  src="https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/ac515729-af6b-4ea5-8b10-e581a4d02100/thumbnail"
                  alt=""
                  className="w-7 h-7 object-contain drop-shadow shrink-0 opacity-80 group-hover:opacity-100 transition-opacity"
                />
                <ChevronLeft size={10} strokeWidth={2.5} className="rotate-[270deg] text-muted group-hover:text-main transition-colors shrink-0 hidden tablet-up:block" />
              </button>
          </div>

          {/* Unified search (Cmd+K) — agent/editor only; product pages use compact chrome */}
          {fullIdeTopbar ? (
          <div className="iam-topbar-desktop-only flex-1 flex justify-center items-center min-w-0 px-2 gap-2 overflow-visible max-phone:hidden">
              <UnifiedSearchBar
                workspaceLabel={editorDevContext ? workspaceDisplayLine : userProfileLabel}
                gitBranch={editorDevContext ? gitBranch : undefined}
                hideWorkspaceSegment={false}
                activeWorkspaceId={authWorkspaceId}
                workspaceRepoHint={activeWorkspaceRow?.github_repo ?? null}
                onGitBranchSelect={handleStatusBarBranchSelect}
                onOpenCommandPalette={openCommandPalette}
                onGitBranchPanelClick={() => {
                  setActiveActivity('git');
                  if (!isAgentShellPath(location.pathname)) navigate(AGENT_HOME_PATH);
                }}
                onWorkspacePickerClick={() => setWorkspaceLauncherOpen(true)}
                recentFiles={mappedRecentFiles}
                onNavigate={(nav, _q) => handleUnifiedNavigate(nav)}
                onRunCommand={(cmd) => terminalRef.current?.runCommand(cmd)}
                controlledOpen={searchOpen}
                onControlledOpenChange={onUnifiedSearchOpenChange}
                initialFacets={searchInitialFacets}
                initialQuery={searchInitialQuery}
                onInitialQueryConsumed={() => setSearchInitialQuery('')}
                shellDropdownHost={!isNarrowViewport}
                onConnectionMenuAction={handleConnectionMenuAction}
              />
          </div>
          ) : (
          <div className="flex-1 min-w-0" aria-hidden="true" />
          )}

          {/* Right layout cluster — product: agent toggle; editor: full IDE tools */}
          <div className="flex gap-0.5 items-center mr-1 shrink-0 max-phone:ml-auto">
              {fullIdeTopbar ? (
              <div className="iam-topbar-mobile-only hidden max-phone:block shrink-0">
                <UnifiedSearchBar
                  workspaceLabel={editorDevContext ? workspaceDisplayLine : userProfileLabel}
                  gitBranch={editorDevContext ? gitBranch : undefined}
                  activeWorkspaceId={authWorkspaceId}
                  workspaceRepoHint={activeWorkspaceRow?.github_repo ?? null}
                  onGitBranchSelect={handleStatusBarBranchSelect}
                  onOpenCommandPalette={openCommandPalette}
                  onGitBranchPanelClick={() => {
                    setActiveActivity('git');
                    if (!isAgentShellPath(location.pathname)) navigate(AGENT_HOME_PATH);
                  }}
                  onWorkspacePickerClick={() => setWorkspaceLauncherOpen(true)}
                  hideWorkspaceSegment
                  mobileToolbar
                  recentFiles={mappedRecentFiles}
                  onNavigate={(nav, _q) => handleUnifiedNavigate(nav)}
                  onRunCommand={(cmd) => terminalRef.current?.runCommand(cmd)}
                  controlledOpen={searchOpen}
                  onControlledOpenChange={onUnifiedSearchOpenChange}
                  initialFacets={searchInitialFacets}
                  initialQuery={searchInitialQuery}
                  onInitialQueryConsumed={() => setSearchInitialQuery('')}
                  shellDropdownHost={isNarrowViewport}
                  onConnectionMenuAction={handleConnectionMenuAction}
                />
              </div>
              ) : null}

              {fullIdeTopbar ? (
              <button
                  type="button"
                  title="Open Browser"
                  className="iam-topbar-desktop-only max-phone:hidden p-1.5 rounded transition-colors text-muted hover:text-white hover:bg-[var(--bg-hover)]"
                  onClick={() => {
                    openTab('browser');
                  }}
              >
                  <Globe size={15} strokeWidth={1.75} />
              </button>
              ) : null}
              <button
                  type="button"
                  title="Toggle agent panel"
                  className={`hidden tablet-up:flex p-1.5 rounded transition-colors ${agentPosition !== 'off' ? 'text-[var(--solar-cyan)] bg-[var(--bg-hover)]' : 'text-muted hover:text-white hover:bg-[var(--bg-hover)]'}`}
                  onClick={onChatLayoutToggle}
              >
                  {agentPosition === 'left' ? <PanelLeftClose size={15} strokeWidth={1.75} /> : <PanelRightClose size={15} strokeWidth={1.75} />}
              </button>
              <button
                  type="button"
                  title="More"
                  aria-label="More tools"
                  className={`hidden max-phone:flex p-1.5 rounded transition-colors ${mobileMoreOpen ? 'text-[var(--solar-cyan)] bg-[var(--bg-hover)]' : 'text-muted hover:text-white hover:bg-[var(--bg-hover)]'}`}
                  onClick={() => setMobileMoreOpen((v: boolean) => !v)}
              >
                  <MoreHorizontal size={15} strokeWidth={1.75} />
              </button>

              {fullIdeTopbar ? (
              <button
                  type="button"
                  title="Terminal (Cmd+J)"
                  className={`iam-topbar-desktop-only max-phone:hidden p-1.5 rounded transition-colors ${isTerminalOpen ? 'text-[var(--solar-cyan)] bg-[var(--bg-hover)]' : 'text-muted hover:text-white hover:bg-[var(--bg-hover)]'}`}
                  onClick={() =>
                    setIsTerminalOpen((p: boolean) => {
                      const next = !p;
                      if (next) setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
                      return next;
                    })
                  }
              >
                  <TermIcon size={15} strokeWidth={1.75} />
              </button>
              ) : null}
              {fullIdeTopbar ? (
              <div className="iam-topbar-desktop-only relative hidden tablet-up:block" ref={topChromeMoreRef}>
                  <button
                      type="button"
                      title="More tools"
                      className={`p-1.5 rounded transition-colors ${topChromeMoreOpen ? 'text-[var(--solar-cyan)] bg-[var(--bg-hover)]' : 'text-muted hover:text-white hover:bg-[var(--bg-hover)]'}`}
                      onClick={() => setTopChromeMoreOpen((v: boolean) => !v)}
                  >
                      <MoreHorizontal size={15} strokeWidth={1.75} />
                  </button>
                  {topChromeMoreOpen && (
                      <div className="absolute right-0 top-full mt-1 z-[120] min-w-[200px] rounded-lg border border-[var(--dashboard-border)] bg-[var(--bg-elevated)] shadow-xl py-1">
                          {location.pathname !== '/dashboard/meet' ? (
                          <button
                              type="button"
                              className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] text-main hover:bg-[var(--bg-hover)]"
                              onClick={() => {
                                  setTopChromeMoreOpen(false);
                                  shellOpenDraw();
                              }}
                          >
                              <PenTool size={14} className="text-muted" />
                              Draw
                          </button>
                          ) : null}
                          <button
                              type="button"
                              className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] text-main hover:bg-[var(--bg-hover)]"
                              onClick={() => {
                                  setTopChromeMoreOpen(false);
                                  navigate('/dashboard/chats');
                              }}
                          >
                              <Search size={14} className="text-muted" />
                              Chats
                          </button>
                          <button
                              type="button"
                              className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] text-main hover:bg-[var(--bg-hover)]"
                              onClick={() => {
                                  setTopChromeMoreOpen(false);
                                  navigate('/dashboard/overview');
                              }}
                          >
                              <History size={14} className="text-muted" />
                              History
                          </button>
                      </div>
                  )}
              </div>
              ) : null}
          </div>
      </div>
      </header>
      ) : null}

      {/* MobileNavDrawer — hamburger button moved into topbar left cluster */}
      {!isCmsFullscreen ? (
      <MobileNavShell
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        onNewChat={shellNewChat}
        onOpenChats={shellOpenChats}
        onOpenMovieMode={shellOpenMovieMode}
        onSelectChat={shellSelectChat}
        onDeleteActiveChat={shellDeleteActiveChat}
        activeConversationId={activeAgentConversationId}
        workspaceLabel={userProfileLabel}
        avatarUrl={sessionAvatarUrl}
        avatarInitial={
          sessionUserName?.trim()?.charAt(0)?.toUpperCase() ||
          sessionUserId?.charAt(0)?.toUpperCase() ||
          undefined
        }
        workspaceSubtitle={
          editorDevContext && gitBranch?.trim() ? gitBranch.trim() : undefined
        }
      />
      ) : null}

      {securityShieldAlert && !securityBannerDismissed && !isCmsFullscreen && (
        <SecurityShieldBanner
          message={securityShieldAlert.message}
          detailsUrl={securityShieldAlert.details_url}
          openFindingsCount={securityShieldAlert.open_findings_count}
          auditEvents24h={securityShieldAlert.audit_events_24h}
          onDismiss={() => setSecurityBannerDismissed(true)}
        />
      )}

      <div className={`flex flex-1 overflow-hidden ${isCmsFullscreen ? 'min-h-0 h-full' : ''}`}>
          {/* 2. ACTIVITY BAR (Extreme Left) — hidden ≤430px; use bottom tab bar + More */}
          {/* Activity bar: icon rail (width toggled via ☰ — localStorage iam_sidebar_expanded) */}
          {!isCmsFullscreen ? (
          <div
            className="iam-chrome-sidebar hidden tablet-up:flex flex-col h-full min-h-0 py-3 gap-1 px-1 border-r border-[var(--dashboard-border)] shrink-0 z-50 overflow-x-hidden overflow-y-auto transition-[width] duration-200 ease-in-out"
            style={{ width: sidebarRailExpanded ? 200 : 48 }}
          >
              <DashboardSidebar
                expanded={sidebarRailExpanded}
                onToggleExpanded={toggleSidebarRail}
                onNewChat={shellNewChat}
                onOpenChats={shellOpenChats}
                onOpenMovieMode={shellOpenMovieMode}
                onSelectChat={shellSelectChat}
                onDeleteActiveChat={shellDeleteActiveChat}
                activeConversationId={activeAgentConversationId}
                workspaceLabel={userProfileLabel}
                avatarUrl={sessionAvatarUrl}
                avatarInitial={
                  sessionUserName?.trim()?.charAt(0)?.toUpperCase() ||
                  sessionUserId?.charAt(0)?.toUpperCase() ||
                  undefined
                }
                workspaceSubtitle={
                  editorDevContext && gitBranch?.trim() ? gitBranch.trim() : undefined
                }
              />
          </div>
          ) : null}

          {/* Optional Left Agent Panel */}
          {agentChatLayout === 'left-rail' ? (
            <AgentSamChatHost
              {...agentSamChatHostProps}
              layout="left-rail"
              agentW={agentW}
              isNarrowViewport={isNarrowViewport}
              activeActivity={activeActivity}
              narrowNeedsBack={narrowNeedsBack}
              mobileEdgeSwipeHandlers={mobileEdgeSwipeHandlers}
              productLabel={PRODUCT_NAME}
              terminalOpen={isTerminalOpen}
              onResizePointerDown={(e) => beginPanelResize('agent', e)}
            />
          ) : null}

          <div className="flex flex-1 min-w-0 overflow-hidden">
          {/* Chat left ↔ Files right (opposite edges). Mobile sheet keeps overlay semantics. */}
          {activeActivity && isNarrowViewport ? (
            <button
              type="button"
              className="iam-mobile-activity-scrim max-phone:block hidden"
              onClick={() => setActiveActivity(null)}
              aria-label="Close panel"
            />
          ) : null}
          <div 
              className={`transition-all duration-75 shrink-0 bg-[var(--dashboard-sidebar)] flex flex-col z-40 overflow-hidden shadow-2xl tablet-up:shadow-none hover:border-[var(--solar-cyan)] relative group
              ${
                activeActivity
                  ? `tablet-up:relative tablet-up:left-0 ${
                      agentChatLayout === 'left-rail' && !isNarrowViewport
                        ? 'border-l'
                        : 'border-r'
                    } border-[var(--dashboard-border)] opacity-100 pointer-events-auto max-phone:iam-mobile-activity-sheet`
                  : 'border-none opacity-0 pointer-events-none max-phone:iam-mobile-activity-sheet'
              }`}
              data-open={activeActivity ? 'true' : 'false'}
              style={
                isNarrowViewport
                  ? activeActivity
                    ? {
                        width: 0,
                        ['--iam-mobile-activity-vh' as string]: `${mobileActivityPanelVh}dvh`,
                        order: 1,
                      }
                    : { width: 0, order: 1 }
                  : {
                      width: activeActivity ? sidebarW : 0,
                      order: agentChatLayout === 'left-rail' ? 3 : 1,
                    }
              }
              {...(narrowNeedsBack && !!activeActivity ? mobileEdgeSwipeHandlers : {})}
          >
              <div className="w-full h-full flex flex-col relative max-phone:iam-mobile-activity-sheet-body">
                  {isNarrowViewport && activeActivity ? (
                    <div
                      role="separator"
                      aria-orientation="horizontal"
                      aria-label="Resize panel height"
                      title="Drag to resize panel"
                      className="iam-mobile-activity-sheet-handle max-phone:flex hidden"
                      onPointerDown={beginMobileActivitySheetResize}
                    />
                  ) : null}
                  {location.pathname === '/dashboard/meet' && meetCtxValue ? (
                      <MeetProvider value={meetCtxValue}>
                        <MeetShellPanel />
                      </MeetProvider>
                  ) : activeActivity === 'files' && isAgentEditorPath(location.pathname) ? (
                      <Suspense fallback={<ActivityPanelFallback />}>
                        <AgentSamFilesystem
                          workspace_id={authWorkspaceId}
                          user_id={sessionUserId}
                          nativeFolderOpenSignal={nativeFolderOpenSignal}
                          onWorkspaceRootChange={onExplorerWorkspaceRootChange}
                          onFileSelect={openInEditorFromExplorer}
                          onOpenInEditor={openInEditorFromExplorer}
                          onClose={() => setActiveActivity(null)}
                          pinnedGithubRepo={gitRepoFullName || activeWorkspaceRow?.github_repo || null}
                        />
                      </Suspense>
                  ) : activeActivity === 'mcps' ? (
                      <Suspense fallback={<ActivityPanelFallback />}>
                        <MCPPanel />
                      </Suspense>
                  ) : activeActivity === 'actions' ? (
                      <Suspense fallback={<ActivityPanelFallback />}>
                        <GitHubExplorer
                          workspace_id={authWorkspaceId}
                          expandRepoFullName={githubExpandRepo}
                          onExpandRepoConsumed={consumeGithubExpandRepo}
                          onOpenInEditor={openInEditorFromExplorer}
                          onClose={() => setActiveActivity(null)}
                        />
                      </Suspense>
                  ) : activeActivity === 'drive' ? (
                      <Suspense fallback={<ActivityPanelFallback />}>
                        <GoogleDriveExplorer onOpenInEditor={openInEditorFromExplorer} />
                      </Suspense>
                  ) : activeActivity === 'debug' ? (
                      <div className="p-4 text-xs text-muted">Redirecting to terminal problems...</div>
                  ) : activeActivity === 'git' ? (
                      <Suspense fallback={<ActivityPanelFallback />}>
                        <SourcePanel />
                      </Suspense>
                  ) : activeActivity === 'files' ? (
                      <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-3">
                        <p className="text-[12px] text-muted">The file explorer lives in the Agent editor.</p>
                        <button
                          type="button"
                          className="text-[11px] px-3 py-2 rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-canvas)] text-[var(--solar-cyan)] hover:bg-[var(--bg-hover)] transition-colors"
                          onClick={() => navigate(AGENT_EDITOR_PATH)}
                        >
                          Open editor
                        </button>
                      </div>
                  ) : location.pathname !== '/dashboard/meet' ? (
                      <div className="p-4 text-xs text-muted">Panel empty.</div>
                  ) : null}
              </div>
          </div>

          {/* Sidebar Grab Bar — desktop (stays between editor and Files rail) */}
          {activeActivity && (
            <div
              role="separator"
              aria-orientation="vertical"
              title="Drag to resize · double-click to close"
              aria-label="Resize activity panel"
              className="hidden tablet-up:flex shrink-0 z-50 group relative cursor-col-resize touch-none select-none justify-center"
              style={{ width: ACTIVITY_SIDEBAR_GRAB_PX, order: 2 }}
              onPointerDown={(e) => beginPanelResize('sidebar', e)}
              onDoubleClick={() => setActiveActivity(null)}
            >
              <span
                className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--dashboard-border)] group-hover:bg-[var(--solar-cyan)] group-active:bg-[var(--solar-cyan)]"
                aria-hidden
              />
            </div>
          )}
          {/* Mobile activity sheet — vertical drag on handle inside panel (28–75vh, default 35) */}

          {/* 4. MAIN EDITOR AREA */}
          <main 
              className={`flex-1 flex flex-col min-w-0 min-h-0 relative max-phone:overflow-x-hidden ${narrowBlocksCenter && !isCmsFullscreen && !isTerminalOpen ? 'max-phone:hidden' : ''} ${isCmsFullscreen ? 'min-w-0 z-[10]' : ''} ${isCenterChatAtmospheric ? 'bg-transparent' : 'bg-[var(--dashboard-canvas)]'}`}
              style={{
                order:
                  agentChatLayout === 'left-rail' && !isNarrowViewport ? 1 : 3,
              }}
              onDrop={handleMainFileDrop}
              onDragOver={handleMainDragOver}
          >
              {isAgentHomePath(location.pathname) && !activeActivity && (
                <button
                  type="button"
                  className="hidden tablet-up:flex absolute left-0 top-1/2 -translate-y-1/2 z-20 flex-col items-center gap-1 py-3 px-1 rounded-r-md border border-l-0 border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] text-muted hover:text-[var(--solar-cyan)] hover:border-[var(--solar-cyan)]/40 shadow-md transition-colors"
                  title="Open editor explorer (⌘B)"
                  aria-label="Open editor explorer"
                  onClick={() => {
                    navigate(AGENT_EDITOR_PATH);
                    engageAgentEditorWorkbench();
                    setActiveActivity('files');
                  }}
                >
                  <Files size={16} strokeWidth={1.75} />
                </button>
              )}
              {/* Dashboard page routes — non-agent pages render here */}
              {!isAgentShellPath(location.pathname) ? (
                <div className="flex-1 min-h-0 min-w-0 overflow-hidden bg-[var(--dashboard-canvas)] flex flex-col">
                  <Suspense fallback={<DashboardRoutesFallback />}>
                    <div className="flex flex-1 flex-col min-h-0 min-w-0">
                    <DashboardAppRoutes
                      authWorkspaceId={authWorkspaceId}
                      meetCtxValue={meetCtxValue}
                      setMeetCtxValue={setMeetCtxValue}
                      setDrawEntryPhase={setDrawEntryPhase}
                      setDrawComposerHost={setDrawComposerHost}
                      setDrawMessagesHost={setDrawMessagesHost}
                      setSketchEntryPhase={setSketchEntryPhase}
                      setSketchComposerHost={setSketchComposerHost}
                      setSketchMessagesHost={setSketchMessagesHost}
                      setDesignStudioEntryPhase={setDesignStudioEntryPhase}
                      setDesignStudioComposerHost={setDesignStudioComposerHost}
                      setDesignStudioMessagesHost={setDesignStudioMessagesHost}
                    />
                    </div>
                  </Suspense>
                </div>
              ) : (
              <>
              {/* Editor Tabs — lazy, closeable (hidden on atmospheric /agent home) */}
              {!isCenterChatAtmospheric && (
              <div className="h-10 flex items-center shrink-0 pl-0 relative z-10 overflow-x-auto overflow-y-hidden no-scrollbar">
                  {openTabs.includes('Workspace') && (
                      <Tab
                          title="Workspace"
                          icon={<FolderCode size={13} className="text-[var(--solar-cyan)]"/>}
                          active={activeTab === 'Workspace'}
                          onClick={() => setActiveTab('Workspace')}
                          onClose={(e) => closeTab('Workspace', e)}
                      />
                  )}
                  {isAgentEditorWorkbench && (
                      <Tab
                          title="Files"
                          icon={<FolderTree size={13} className="text-[var(--solar-cyan)] opacity-80"/>}
                          active={activeActivity === 'files'}
                          onClick={() =>
                            setActiveActivity((prev: ShellActivity) => (prev === 'files' ? null : 'files'))
                          }
                      />
                  )}
                  {openTabs.includes('code') && (
                      <>
                      <Tab
                          title={
                              <span className="flex items-center gap-1">
                                  {activeFile ? activeFile.name : 'Code'}
                                  {isDirty && <span className="text-[var(--solar-yellow)] text-[10px] animate-pulse-dirty" title="Unsaved changes">●</span>}
                              </span>
                          }
                          icon={
                            activeFile ? (
                              <SetiFileIcon filename={activeFile.name} size={14} />
                            ) : (
                              <FileCode2 size={14} className="text-[var(--solar-cyan)] opacity-60" />
                            )
                          }
                          active={activeTab === 'code'}
                          onClick={() => setActiveTab('code')}
                          onClose={(e) => closeTab('code', e)}
                      />
                      {activeFile && isRenderablePreviewFilename(activeFile.name) && (
                          <button
                              type="button"
                              onClick={(e) => {
                                  e.stopPropagation();
                                  openEditorPreview();
                              }}
                              title={previewButtonTitle(activeFile.name)}
                              className="shrink-0 h-8 w-8 p-0 inline-flex items-center justify-center rounded-md border border-[var(--dashboard-border)] bg-[var(--bg-hover)] text-main hover:bg-[var(--dashboard-panel)] hover:border-[var(--solar-cyan)]"
                          >
                              <Eye size={15} className="text-[var(--solar-cyan)]" strokeWidth={1.75} aria-hidden />
                              <span className="sr-only">Preview file</span>
                          </button>
                      )}
                      {activeFile?.r2Key?.trim() && activeFile?.r2Bucket?.trim() && (
                          <button
                              type="button"
                              onClick={(e) => {
                                  e.stopPropagation();
                                  const path = `${activeFile.r2Bucket!.trim()}/${activeFile.r2Key!.trim()}`;
                                  void navigator.clipboard.writeText(path);
                                  setToastMsg('R2 path copied');
                              }}
                              title={`Copy R2 path: ${activeFile.r2Bucket!.trim()}/${activeFile.r2Key!.trim()}`}
                              className="shrink-0 h-8 w-8 p-0 inline-flex items-center justify-center rounded-md border border-[var(--dashboard-border)] bg-[var(--bg-hover)] text-main hover:bg-[var(--dashboard-panel)] hover:border-[var(--solar-cyan)]"
                          >
                              <Link2 size={14} className="text-muted" strokeWidth={1.75} aria-hidden />
                              <span className="sr-only">Copy R2 path</span>
                          </button>
                      )}
                      </>
                  )}
                  {openTabs.includes('browser') && (
                      <Tab
                          title={browserTabTitle ?? 'Browser'}
                          icon={<Globe size={13} className="text-[var(--solar-blue)]"/>}
                          active={activeTab === 'browser'}
                          onClick={() => setActiveTab('browser')}
                          onClose={(e) => closeTab('browser', e)}
                      />
                  )}
                  {activeTab === 'code' &&
                    activeFile?.name?.match(/\.(md|markdown)$/i) && (
                      <div
                        className="flex items-center rounded border border-[var(--dashboard-border)] overflow-hidden shrink-0 ml-1"
                        role="group"
                        aria-label="Markdown view mode"
                      >
                        {(['source', 'split', 'preview'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setMdViewMode(mode)}
                            className={`px-2 h-7 text-[10px] font-bold uppercase tracking-wider transition-all border-r border-[var(--dashboard-border)] last:border-r-0 ${
                              mdViewMode === mode
                                ? 'bg-[var(--solar-cyan)] text-black'
                                : 'text-muted hover:text-[var(--solar-cyan)] hover:bg-[var(--bg-hover)]'
                            }`}
                          >
                            {mode === 'source' ? 'Source' : mode === 'split' ? 'Split' : 'Preview'}
                          </button>
                        ))}
                      </div>
                    )}
                  {openTabs.includes('cms') && (
                      <Tab
                          title="CMS"
                          icon={<PenTool size={13} className="text-[var(--solar-orange)]"/>}
                          active={activeTab === 'cms'}
                          onClick={() => setActiveTab('cms')}
                          onClose={(e) => closeTab('cms', e)}
                      />
                  )}
                  {/* Tab row tools — Browser is opt-in (not opened by default) */}
                  <div className="ml-auto flex items-center gap-0.5 pr-2 shrink-0">
                      {!openTabs.includes('browser') && (
                        <>
                          <button
                            type="button"
                            title="Open Browser"
                            className="hidden max-phone:block p-1.5 rounded transition-colors text-muted hover:text-white hover:bg-[var(--bg-hover)]"
                            onClick={() => openTab('browser')}
                          >
                            <Globe size={15} strokeWidth={1.75} />
                          </button>
                          <span className="max-phone:hidden">
                            <QuickOpen label="Browser" onClick={() => openTab('browser')} />
                          </span>
                        </>
                      )}
                      <button
                        type="button"
                        title="Terminal (Cmd+J)"
                        className={`hidden max-phone:block p-1.5 rounded transition-colors ${isTerminalOpen ? 'text-[var(--solar-cyan)] bg-[var(--bg-hover)]' : 'text-muted hover:text-white hover:bg-[var(--bg-hover)]'}`}
                        onClick={() =>
                          setIsTerminalOpen((p: boolean) => {
                            const next = !p;
                            if (next) setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
                            return next;
                          })
                        }
                      >
                        <TermIcon size={15} strokeWidth={1.75} />
                      </button>
                  </div>

                  {/* Decorative line below tabs */}
                  <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-[var(--dashboard-border)] z-[-1]" />
              </div>
              )}

              {/* Editor + optional aux bottom + terminal — flex column so drawer respects drag height */}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
                  <div className="flex-1 min-h-0 relative flex flex-col">
                  {isAgentQuickstartPath(location.pathname) && (
                      <div className="absolute inset-0 z-10">
                          <AgentQuickstartPage
                            onBack={() => navigate(AGENT_HOME_PATH)}
                            onBegin={beginQuickstartTemplate}
                          />
                      </div>
                  )}

                  {showAgentHomeScene && (
                      <div className="absolute inset-0 z-10 flex flex-col items-stretch min-h-0 min-w-0 w-full">
                          <AgentHome
                            displayName={agentHomeGreetingName}
                            showHero={agentHomeShowHero}
                            terminalDocked={isTerminalOpen}
                            onComposerHost={setAgentHomeComposerHost}
                            onMessagesHost={setAgentHomeMessagesHost}
                            onModeSelect={handleAgentHomeModeSelect}
                          />
                      </div>
                  )}

                  {((isAgentWorkspaceBrowser || isAgentEditorWorkbench) &&
                    activeTab === 'Workspace' &&
                    !isCenterChatAtmospheric) && (
                      <div className="absolute inset-0 z-10">
                          <WorkspaceDashboardV2 
                            onOpenFolder={() => {
                              setActiveActivity('files');
                              setNativeFolderOpenSignal((n: number) => n + 1);
                            }}
                            onConnectWorkspace={() => setWorkspaceLauncherOpen(true)}
                            onGithubSync={() => openCommandPalette({ query: 'clone ' })}
                            recentFiles={workspaceDashboardRecentFiles}
                            onOpenRecent={openRecentEntry}
                            workspaceRows={workspaceRows}
                            authWorkspaceId={authWorkspaceId}
                            onSwitchWorkspace={persistActiveWorkspace}
                            onQuickstart={openAgentQuickstart}
                            activeAgentTab={agentWorkspaceTab}
                            onAgentTabChange={handleAgentTabChange}
                            onBeginTemplate={beginQuickstartTemplate}
                            onRunVerificationCommand={runVerificationInAgent}
                            onOpenEditor={focusCodeEditorFromChat}
                            workspacePlanTasks={Array.isArray(workspaceSamState?.next_tasks) ? (workspaceSamState!.next_tasks as unknown[]) : []}
                            activePlanId={(() => {
                              const st = workspaceSamState;
                              if (!st || typeof st !== 'object') return null;
                              const row = st as Record<string, unknown>;
                              const a = row.active_plan_id;
                              const b = row.activePlanId;
                              if (typeof a === 'string' && a.trim()) return a.trim();
                              if (typeof b === 'string' && b.trim()) return b.trim();
                              return null;
                            })()}
                            workspaceActivity={Array.isArray(workspaceSamState?.recent_adjustments) ? (workspaceSamState!.recent_adjustments as unknown[]) : []}
                            workspaceVerificationCommands={Array.isArray(workspaceSamState?.verification_commands) ? (workspaceSamState!.verification_commands as unknown[]) : []}
                            activeAgentSlug={typeof workspaceSamState?.active_agent_slug === 'string' ? workspaceSamState.active_agent_slug : null}
                            sessionUserId={sessionUserId}
                          />
                      </div>
                  )}

                  {/* Editor empty-canvas fallback: never leave charcoal with no surface */}
                  {isAgentEditorWorkbench &&
                    !activeFile &&
                    activeTab !== 'Workspace' &&
                    activeTab !== 'code' &&
                    activeTab !== 'browser' &&
                    activeTab !== 'cms' &&
                    activeTab !== 'glb' && (
                      <div className="absolute inset-0 z-10">
                        <EditorWorkbenchLanes
                          onOpenFileTree={() => setActiveActivity('files')}
                          onOpenFolder={() => {
                            setActiveActivity('files');
                            setNativeFolderOpenSignal((n: number) => n + 1);
                          }}
                          onBrowseWeb={() => openTab('browser')}
                          onNewFile={openNewEditorFile}
                          onOpenWorkspace={() => setActiveTab('Workspace')}
                          recentFiles={mappedRecentFiles}
                          onOpenRecent={(path) => {
                            const entry = workspaceDashboardRecentFiles.find(
                              (f: RecentFileEntry) =>
                                f.workspacePath === path ||
                                f.githubPath === path ||
                                f.r2Key === path ||
                                f.id === path,
                            );
                            if (entry) void openRecentEntry(entry);
                          }}
                        />
                      </div>
                  )}

                  {isAgentEditorWorkbench && activeTab === 'code' && !activeFile && (
                      <div className="absolute inset-0 z-10">
                        <EditorWorkbenchLanes
                          onOpenFileTree={() => setActiveActivity('files')}
                          onOpenFolder={() => {
                            setActiveActivity('files');
                            setNativeFolderOpenSignal((n: number) => n + 1);
                          }}
                          onBrowseWeb={() => openTab('browser')}
                          onNewFile={openNewEditorFile}
                          onOpenWorkspace={() => setActiveTab('Workspace')}
                          recentFiles={mappedRecentFiles}
                          onOpenRecent={(path) => {
                            const entry = workspaceDashboardRecentFiles.find(
                              (f: RecentFileEntry) =>
                                f.workspacePath === path ||
                                f.githubPath === path ||
                                f.r2Key === path ||
                                f.id === path,
                            );
                            if (entry) void openRecentEntry(entry);
                          }}
                        />
                      </div>
                  )}

                  {showMonacoWorkbench && (
                      <div ref={editorPreviewSplitRef} className="absolute inset-0 z-10 flex min-h-0 min-w-0">
                          <div
                            className="flex flex-col min-h-0 min-w-0 shrink-0"
                            style={
                              editorPreviewOpen
                                ? {
                                    flex: `0 0 ${editorPreviewEditorPct}%`,
                                    minWidth: EDITOR_PREVIEW_PANEL_MIN_PX,
                                  }
                                : { flex: '1 1 auto', width: '100%' }
                            }
                          >
                            <Suspense
                              fallback={
                                <div className="flex h-full items-center justify-center text-[12px] text-muted">
                                  Loading editor…
                                </div>
                              }
                            >
                              <MonacoEditorView
                                onSave={handleSaveFile}
                                onCursorPositionChange={handleEditorCursorPosition}
                                onEditorModelMeta={setEditorMeta}
                                workspaceContext={agentWorkspaceContext}
                                mdViewMode={mdViewMode}
                                onMdViewModeChange={setMdViewMode}
                                hideMdViewToggle
                              />
                            </Suspense>
                          </div>
                          {editorPreviewOpen && activeFile ? (
                            <>
                              <div
                                role="separator"
                                aria-orientation="vertical"
                                title="Drag to resize editor and preview"
                                aria-label="Resize editor and preview panels"
                                className="shrink-0 z-50 flex justify-center cursor-col-resize touch-none select-none group relative"
                                style={{ width: AGENT_RESIZER_HIT_PX }}
                                onPointerDown={beginEditorPreviewResize}
                              >
                                <span
                                  className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--dashboard-border)] group-hover:bg-[var(--solar-cyan)] group-active:bg-[var(--solar-cyan)] transition-colors"
                                  aria-hidden
                                />
                              </div>
                              <div
                                className="flex flex-col min-h-0 min-w-0 shrink-0"
                                style={{
                                  flex: `1 1 ${100 - editorPreviewEditorPct}%`,
                                  minWidth: EDITOR_PREVIEW_PANEL_MIN_PX,
                                }}
                              >
                                <EditorPreviewPane
                                  fileName={activeFile.name}
                                  mode={editorPreviewMode}
                                  srcDoc={editorPreviewSrcDoc}
                                  url={editorPreviewUrl}
                                  loading={editorPreviewLoading}
                                  statusMessage={editorPreviewStatus}
                                  onClose={closeEditorPreview}
                                  onRefresh={
                                    editorPreviewMode === 'devserver'
                                      ? () => {
                                          if (editorPreviewUrl) {
                                            setEditorPreviewUrl(`${editorPreviewUrl.split('?')[0]}?t=${Date.now()}`);
                                          }
                                        }
                                      : undefined
                                  }
                                />
                              </div>
                            </>
                          ) : null}
                      </div>
                  )}
                  {activeTab === 'browser' && (
                      <div className="absolute inset-0 z-10 overflow-hidden">
                          <Suspense
                            fallback={
                              <div className="flex items-center justify-center h-full text-muted text-sm">
                                Loading browser…
                              </div>
                            }
                          >
                            <BrowserView
                              url={browserUrl}
                              addressDisplay={browserAddressDisplay}
                              previewSource={browserPreviewSource}
                              onUrlCommitted={(url) => {
                                const n = url.trim();
                                if (!n || n === browserUrl) return;
                                setBrowserAddressDisplay(null);
                                setBrowserTabTitle(null);
                                setBrowserUrl(n);
                                setBrowserPreviewSource('agent');
                              }}
                              agentRunId={browserPreviewSource === 'editor' ? null : activeAgentRunId}
                              workspaceContext={agentWorkspaceContext}
                            />
                          </Suspense>
                      </div>
                  )}
                  {activeTab === 'cms' && (
                      <div className="absolute inset-0 z-10 overflow-hidden">
                          <Navigate
                            to={
                              cmsWorkbenchContext?.project_slug
                                ? `/dashboard/cms/pages?site=${encodeURIComponent(cmsWorkbenchContext.project_slug)}`
                                : '/dashboard/cms'
                            }
                            replace
                          />
                      </div>
                  )}

                  </div>

                  {/* Agent page keeps integrated terminal mount (existing behavior). */}
                  {isTerminalOpen && (
                      <Suspense
                        fallback={
                          <div className="flex flex-1 items-center justify-center text-[11px] text-muted">
                            Loading terminal…
                          </div>
                        }
                      >
                        <XTermShell
                          ref={terminalRef}
                          onClose={() => setIsTerminalOpen(false)}
                          problems={systemProblems ?? []}
                          onProblemsTabOpen={() => void fetchGitAndProblems()}
                          iamOrigin={typeof window !== 'undefined' ? window.location.origin : 'https://inneranimalmedia.com'}
                          workspaceLabel={workspaceDisplayLine}
                          workspaceId={termWs.activeWorkspaceId || undefined}
                          targetType={termWs.recommendedTargetType}
                          onTargetTypeChange={termWs.saveTargetType}
                          splashStatus={termWs.splashStatus}
                          splashStatusLoading={termWs.statusLoading}
                          onConnected={(cwd, target) => termWs.markConnected(cwd, target)}
                          productLabel={PRODUCT_NAME}
                          layout="page"
                          outputLines={shellOutputLines}
                          onOutputLine={handleTerminalOutputLine}
                          workspaceContext={agentWorkspaceContext}
                          sessionUserId={sessionUserId}
                          autoConnect={isNarrowViewport}
                        />
                      </Suspense>
                  )}
              </div>
          </>
              )}

              {/* Global terminal drawer — non-agent routes only (/dashboard/agent uses in-layout XTermShell) */}
              {!isAgentShellPath(location.pathname) && (
              <div
                className={isNarrowViewport ? 'iam-terminal-drawer-host' : undefined}
                style={{
                  display: isTerminalOpen ? 'flex' : 'none',
                  flexDirection: 'column',
                  height: `${terminalDrawerH}px`,
                  flexShrink: 0,
                  borderTop: '1px solid var(--dashboard-border)',
                  background: 'var(--dashboard-panel)',
                  position: 'relative',
                  zIndex: 60,
                  width: '100%',
                  maxWidth: '100%',
                  overflowX: 'hidden',
                }}
              >
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Drag to resize terminal"
                  title="Drag to resize terminal"
                  className="iam-terminal-drawer-resizer"
                  onPointerDown={beginTerminalResize}
                />
                <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                  <Suspense
                    fallback={
                      <div className="flex flex-1 items-center justify-center text-[11px] text-muted">
                        Loading terminal…
                      </div>
                    }
                  >
                    <XTermShell
                      ref={terminalRef}
                      iamOrigin={window.location.origin}
                      workspaceLabel={workspaceContextLabel || ''}
                      workspaceId={termWs.activeWorkspaceId || ''}
                      targetType={termWs.recommendedTargetType}
                      onTargetTypeChange={termWs.saveTargetType}
                      splashStatus={termWs.splashStatus}
                      splashStatusLoading={termWs.statusLoading}
                      onConnected={(cwd, target) => termWs.markConnected(cwd, target)}
                      productLabel="IAM"
                      layout="drawer"
                      outputLines={shellOutputLines}
                      onOutputLine={handleTerminalOutputLine}
                      problems={systemProblems ?? []}
                      onProblemsTabOpen={() => void fetchGitAndProblems()}
                      onClose={() => setIsTerminalOpen(false)}
                      sessionUserId={sessionUserId}
                      autoConnect={isNarrowViewport}
                    />
                  </Suspense>
                </div>
              </div>
              )}
              {!isCmsFullscreen && agentChatLayout === 'center' ? (
                <AgentSamChatHost
                  {...agentSamChatHostProps}
                  layout="center"
                  agentW={agentW}
                  isNarrowViewport={isNarrowViewport}
                  activeActivity={activeActivity}
                  narrowNeedsBack={narrowNeedsBack}
                  mobileEdgeSwipeHandlers={mobileEdgeSwipeHandlers}
                  productLabel={PRODUCT_NAME}
                  terminalOpen={isTerminalOpen}
                  atmosphericHomeMode={
                    routeEntryAtmospheric || (showAgentHomeScene && isCenterChatAtmospheric)
                  }
                  composerPortalTarget={
                    designStudioEntryAtmospheric
                      ? designStudioComposerHost
                      : drawEntryAtmospheric
                        ? drawComposerHost
                        : sketchEntryAtmospheric
                          ? sketchComposerHost
                          : showAgentHomeScene && isCenterChatAtmospheric
                            ? agentHomeComposerHost
                            : null
                  }
                  messagesPortalTarget={
                    designStudioEntryAtmospheric
                      ? designStudioMessagesHost
                      : drawEntryAtmospheric
                        ? drawMessagesHost
                        : sketchEntryAtmospheric
                          ? sketchMessagesHost
                          : showAgentHomeScene && isCenterChatAtmospheric
                            ? agentHomeMessagesHost
                            : null
                  }
                />
              ) : null}
          </main>
          </div>

          {/* 6. Optional Right Agent Panel */}
          {agentChatLayout === 'right-rail' ? (
            <AgentSamChatHost
              {...agentSamChatHostProps}
              layout="right-rail"
              agentW={agentW}
              isNarrowViewport={isNarrowViewport}
              activeActivity={activeActivity}
              narrowNeedsBack={narrowNeedsBack}
              mobileEdgeSwipeHandlers={mobileEdgeSwipeHandlers}
              productLabel={PRODUCT_NAME}
              terminalOpen={isTerminalOpen}
              onResizePointerDown={(e) => beginPanelResize('agent', e)}
            />
          ) : null}
      </div>
      {/* 8. STATUS BAR (FOOTER) */}
      {toastMsg && (
        <div
          className={`fixed bottom-4 left-1/2 z-[200] -translate-x-1/2 px-4 py-2 rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-canvas)] text-[11px] text-main shadow-lg max-w-md text-center ${
            showStatusBar
              ? 'max-phone:[bottom:calc(1.5rem+env(safe-area-inset-bottom,0px)+8px)]'
              : 'max-phone:[bottom:calc(env(safe-area-inset-bottom,0px)+8px)]'
          }`}
          role="status"
        >
          {toastMsg}
        </div>
      )}



      {mobileMoreOpen && (
        <>
          <button
            type="button"
            className="hidden max-phone:block fixed inset-0 z-[95] bg-[var(--text-main)]/25 backdrop-blur-[2px]"
            aria-label="Close more tools"
            onClick={() => setMobileMoreOpen(false)}
          />
          <div
            className="hidden max-phone:flex fixed left-2 right-2 z-[96] max-h-[min(72vh,calc(100dvh-10rem))] flex-col rounded-t-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] shadow-2xl overflow-hidden"
            style={{ bottom: `calc(${showStatusBar ? '1.5rem + ' : ''}env(safe-area-inset-bottom, 0px) + 8px)` }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--dashboard-border)] shrink-0">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">More</span>
              <button
                type="button"
                className="p-2 rounded-md text-muted hover:bg-[var(--bg-hover)] hover:text-main"
                title="Close"
                onClick={() => setMobileMoreOpen(false)}
              >
                <XIcon size={18} strokeWidth={1.75} />
              </button>
            </div>
            <div className="overflow-y-auto p-2 flex flex-col gap-0.5">
              {/*
                MOBILE SEARCH AUDIT (Round 4 — do not remove until approved):
                • Top-bar search icon → UnifiedSearchBar Cmd+K palette (commands, R2, D1, files, recent via /api/unified-search/recent).
                • More → "Chats" → /dashboard/chats (full session list; sidebar teaser uses the same useAgentChatSessions hook).
              */}
              <MobileMoreRow icon={Search} label="Chats" onClick={() => { setMobileMoreOpen(false); navigate('/dashboard/chats'); }} />
              <MobileMoreRow
                icon={TermIcon}
                label="Terminal"
                onClick={() => {
                  setMobileMoreOpen(false);
                  setIsTerminalOpen((p: boolean) => {
                    const next = !p;
                    if (next) setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
                    return next;
                  });
                }}
              />
              <MobileMoreRow icon={GitBranch} label="Source Control" onClick={() => { setMobileMoreOpen(false); toggleActivity('git'); }} />
              <MobileMoreRow icon={Bug} label="Run & Debug" onClick={() => { setMobileMoreOpen(false); toggleActivity('debug'); }} />
              <MobileMoreRow icon={Layers} label="Tools & MCP" onClick={() => { setMobileMoreOpen(false); toggleActivity('mcps'); }} />
              <MobileMoreRow icon={Cloud} label="Cloud Sync" onClick={() => { setMobileMoreOpen(false); toggleActivity('drive'); }} />
              <MobileMoreRow icon={Monitor} label="Engine View" onClick={() => { setMobileMoreOpen(false); navigate('/dashboard/designstudio'); }} />
              <MobileMoreRow icon={Rocket} label="Collaborate" onClick={() => { setMobileMoreOpen(false); navigate('/dashboard/collaborate'); }} />
            </div>
          </div>
        </>
      )}

      {showStatusBar ? (
      <StatusBar 
        branch={gitBranch}
        gitHash={gitHash}
        workspace={workspaceContextLabel}
        workspaceMenuItems={statusBarWorkspaceItems.length > 0 ? statusBarWorkspaceItems : undefined}
        activeWorkspaceId={authWorkspaceId}
        onWorkspaceMenuSelect={handleStatusBarWorkspacePick}
        onBranchSelect={handleStatusBarBranchSelect}
        aheadCount={gitAhead}
        behindCount={gitBehind}
        trackingBranch={gitTrackingBranch}
        syncBusy={gitSyncBusy}
        onSyncPublish={handleGitSyncPublish}
        onOpenCommandPalette={openCommandPalette}
        errorCount={errorCount}
        warningCount={warningCount}
        showCursor={activeTab === 'code'}
        line={cursorPos.line}
        col={cursorPos.col}
        version={SHELL_VERSION}
        healthOk={healthOk}
        platformHealthIssues={platformHealthIssues}
        tunnelHealthy={tunnelHealthy}
        tunnelLabel={tunnelLabel}
        terminalOk={terminalOk}
        indentLabel={statusIndentLabel}
        encodingLabel={editorMeta.encoding}
        eolLabel={editorMeta.eol}
        notifications={agentNotifications}
        notifUnreadCount={agentNotifications.length}
        onMarkNotificationRead={markNotificationRead}
        onOpenNotification={openNotificationDestination}
        focusNotificationId={focusNotificationId}
        canFormatDocument={activeTab === 'code' && !!activeFile}
        onBrandClick={() => {
          window.open('https://inneranimalmedia.com', '_blank', 'noopener,noreferrer');
        }}
        onGitBranchClick={() => {
          setActiveActivity('git');
          if (!isAgentShellPath(location.pathname)) navigate(AGENT_HOME_PATH);
        }}
        onWorkspaceClick={() => setWorkspaceLauncherOpen(true)}
        onRefreshGitStatus={() => void fetchGitAndProblems()}
        onErrorsClick={() => toggleActivity('debug')}
        onWarningsClick={() => toggleActivity('mcps')}
        onCursorClick={() => {
          if (isNarrowViewport) narrowBackToCenter();
          openTab('code');
        }}
        onVersionClick={() => {}}
        onFormatClick={() => {
          window.dispatchEvent(new CustomEvent('iam-format-document'));
        }}
      />
      ) : null}

      {isWorkspaceLauncherOpen && (
        <WorkspaceLauncher
          onClose={() => setWorkspaceLauncherOpen(false)}
          sessionUserId={sessionUserId}
          authWorkspaceId={authWorkspaceId}
          setAuthWorkspaceId={setAuthWorkspaceId}
          setWorkspaceDisplayName={setWorkspaceDisplayName}
          onWorkspaceActivated={(ws) => {
            void switchWorkspace(ws.id, {
              displayName: ws.display_name,
              slug: ws.slug,
              github_repo: ws.github_repo ?? null,
              sync: false,
            });
            void refreshWorkspaces({ force: true });
            if (location.pathname.startsWith('/dashboard/database')) {
              const nextPath = databaseStudioPathForWorkspace({
                slug: ws.slug,
                github_repo: ws.github_repo ?? null,
              });
              if (nextPath !== location.pathname) {
                navigate(nextPath, { replace: true });
              }
            }
          }}
          setToastMsg={setToastMsg}
          onOpenLocalFolder={() => {
            setWorkspaceLauncherOpen(false);
            setActiveActivity('files');
            setNativeFolderOpenSignal((n: number) => n + 1);
          }}
          onOpenSshSetup={() => {
            setWorkspaceLauncherOpen(false);
            handleConnectionMenuAction('pty_setup_wizard');
          }}
          onManageEnvironments={() => {
            setWorkspaceLauncherOpen(false);
            navigate('/dashboard/settings/workspace');
          }}
          onConnectWorkspace={() => setWorkspaceLauncherOpen(false)}
        />
      )}
    </div>
    </DesignStudioProvider>
  
  );
}
