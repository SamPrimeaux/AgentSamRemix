/** AgentSamChatHost props bag (Wave 2 E8). */
import React, { useCallback, useMemo } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { ActiveFile, ProjectType } from '../types';
import type { Message } from '../components/ChatAssistant/types';
import type { AgentWorkspaceContextPacket } from '../src/ideWorkspace';

export function useAgentSamChatHostProps(opts: Record<string, any>) {
  const {
    showAgentWorkbenchTabs, agentChatTabs, navigate, setGlbViewerUrl, setGlbViewerFilename,
    activeProject, activeFile, cursorPos, agentsamChatPolicy, authWorkspaceId, isCmsRoute,
    designStudioEntryAtmospheric, drawEntryAtmospheric, sketchEntryAtmospheric, chatMessages,
    setChatMessages, shellOpenChatHistory, shellDeleteActiveChat, openInMonacoFromChat,
    runInTerminal, handleR2FileUpdatedFromAgent, handleBrowserNavigateFromAgent,
    openGitHubFromChat, openDashboardFromChat, openAgentQuickstart, focusCodeEditorFromChat,
    openEditorFromChat, setAgentIsStreaming, setActiveCommandRunId, activeCommandRunId,
    activeAgentConversationId, activeAgentChatTabId, selectAgentChatTab, closeAgentChatTab,
    createNewAgentChatTab, setActiveAgentRunId, isMovieModeRoute, isDesignStudioRoute,
    activeTab, isDrawRoute, isSketchRoute, browserUrl, agentWorkbenchOpenFiles,
    activePlanIdForChat, handleActivePlanChange, cmsWorkbenchContext, agentWorkspaceContext,
    routeAgentMeta, availableConnectors, availableConnectorsLoading,
  } = opts;

  const agentSamChatShellTabs = useMemo(
    () => (showAgentWorkbenchTabs ? agentChatTabs.map((t) => ({ id: t.id, title: t.title })) : undefined),
    [showAgentWorkbenchTabs, agentChatTabs],
  );

  const handleGlbFileSelectFromChat = useCallback(
    (file: File) => {
      const glbUrl = URL.createObjectURL(file);
      setGlbViewerUrl((prev) => {
        if (prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        return glbUrl;
      });
      setGlbViewerFilename(file.name);
      navigate('/dashboard/designstudio', {
        state: { pendingGlb: { url: glbUrl, name: file.name.replace(/\.glb$/i, '') } },
      });
    },
    [navigate],
  );

  const agentSamChatHostProps = useMemo(
    () => ({
      fallbackProject: activeProject,
      activeFileContent: activeFile?.content,
      activeFileName: activeFile?.name,
      activeFile,
      editorCursorLine: cursorPos.line,
      editorCursorColumn: cursorPos.col,
      agentsamPolicy: agentsamChatPolicy,
      workspaceId: authWorkspaceId,
      // No route-preset subagent — only an explicit client choice is sent.
      composerPlaceholder:
        isCmsRoute
          ? 'Update a page, publish changes, or ask Agent Sam to edit this CMS site…'
          : designStudioEntryAtmospheric
          ? 'Describe a 3D model, import a GLB, or ask Agent Sam to create…'
          : drawEntryAtmospheric
            ? 'Sketch a diagram or flowchart with Agent Sam on Excalidraw…'
            : sketchEntryAtmospheric
              ? 'Concept, layout, or blueprint — describe what to sketch with Agent Sam…'
            : undefined,
      messages: chatMessages,
      setMessages: setChatMessages,
      onOpenChatHistory: shellOpenChatHistory,
      onDeleteActiveChat: shellDeleteActiveChat,
      onFileSelect: openInMonacoFromChat,
      onGlbFileSelect: handleGlbFileSelectFromChat,
      onRunInTerminal: runInTerminal,
      onR2FileUpdated: handleR2FileUpdatedFromAgent,
      onBrowserNavigate: handleBrowserNavigateFromAgent,
      onOpenGitHubIntegration: openGitHubFromChat,
      onMobileOpenDashboard: openDashboardFromChat,
      onOpenQuickstart: openAgentQuickstart,
      onOpenCodeTab: focusCodeEditorFromChat,
      onOpenEditor: openEditorFromChat,
      onLoadingChange: setAgentIsStreaming,
      onApprovalRequired: setActiveCommandRunId,
      agentRunId: activeCommandRunId,
      syncedHostConversationId: activeAgentConversationId,
      showAgentWorkbenchTabs,
      agentChatShellTabs: agentSamChatShellTabs,
      activeAgentChatShellTabId: activeAgentChatTabId,
      onAgentChatShellTabSelect: selectAgentChatTab,
      onAgentChatShellTabClose: closeAgentChatTab,
      onAgentChatShellNewTab: createNewAgentChatTab,
      onAgentRunContext: setActiveAgentRunId,
      activeWorkbenchTab: isMovieModeRoute
        ? 'moviemode'
        : isDesignStudioRoute
          ? 'designstudio'
        : isCmsRoute
          ? 'cms'
          : activeTab === 'cms'
            ? 'cms'
            : isDrawRoute
              ? 'draw'
              : isSketchRoute
                ? 'sketch'
              : activeTab,
      browserUrl,
      openFilePaths: agentWorkbenchOpenFiles,
      activePlanId: activePlanIdForChat,
      onActivePlanChange: handleActivePlanChange,
      cmsContext: cmsWorkbenchContext,
      hostWorkspaceContext: agentWorkspaceContext,
      dashboardRouteKey: routeAgentMeta.route_key,
      dashboardTaskType: routeAgentMeta.task_type || null,
      dashboardRouteLabel: routeAgentMeta.context_label,
      routeQuickActions: routeAgentMeta.quickActions,
      availableConnectors,
      availableConnectorsLoading,
    }),
    [
      activeProject,
      activeFile,
      cursorPos.line,
      cursorPos.col,
      agentsamChatPolicy,
      authWorkspaceId,
      isDesignStudioRoute,
      designStudioEntryAtmospheric,
      drawEntryAtmospheric,
      sketchEntryAtmospheric,
      chatMessages,
      setChatMessages,
      shellOpenChatHistory,
      shellDeleteActiveChat,
      openInMonacoFromChat,
      handleGlbFileSelectFromChat,
      runInTerminal,
      handleR2FileUpdatedFromAgent,
      handleBrowserNavigateFromAgent,
      openGitHubFromChat,
      openDashboardFromChat,
      openAgentQuickstart,
      focusCodeEditorFromChat,
      openEditorFromChat,
      activeCommandRunId,
      activeAgentConversationId,
      showAgentWorkbenchTabs,
      agentSamChatShellTabs,
      activeAgentChatTabId,
      selectAgentChatTab,
      closeAgentChatTab,
      createNewAgentChatTab,
      isMovieModeRoute,
      isCmsRoute,
      activeTab,
      isDrawRoute,
      isSketchRoute,
      browserUrl,
      agentWorkbenchOpenFiles,
      activePlanIdForChat,
      handleActivePlanChange,
      cmsWorkbenchContext,
      agentWorkspaceContext,
      routeAgentMeta.route_key,
      routeAgentMeta.task_type,
      routeAgentMeta.context_label,
      routeAgentMeta.quickActions,
      availableConnectors,
      availableConnectorsLoading,
    ],
  );


  return { agentSamChatHostProps, handleGlbFileSelectFromChat, agentSamChatShellTabs };
}
