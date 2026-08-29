/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Drawers / portals / toast (peel A7).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { createPortal } from 'react-dom';
import { Bug, Infinity, ListTodo, MessageCircle, RefreshCw } from 'lucide-react';
import { ComposerConnectorSheet } from './components/ComposerConnectorSheet';
import { ContextHubDrawer } from './ContextHubDrawer';
import { RepoPickerBottomSheet } from './RepoPickerBottomSheet';
import { WEB_SEARCH_SOURCE, WEB_SEARCH_SOURCE_ID, SANDBOX_AGENT_SOURCE } from './composer/types';
export function ChatAssistantChrome({ v }: { v: any }) {
  const {
    abortControllerRef, activeComposerSourceIds, activeFile, activePlanTitle, activeSubagents, addFilesFromList,
    agentRunId, appendSpeechToInput, appendVoiceAssistantToThread, appendVoiceUserToThread, applyMention, applySlash,
    approvalBusy, atmosphericHomeMode, attachButtonRef, attachMenuOpen, attachMenuRef, attachMenuStyle,
    attachments, availableConnectors, availableConnectorsLoading, browserElementContext, canSend,
    centerChatComposerColumn, chatGithubFilePath, childScrollRef, clearBrowserElementContext, composerDragDepthRef, composerDragging,
    composerFlexOrder, composerGlassRef, composerPillClass, composerPlaceholder, composerPortalTarget, composerPortaled,
    composerSources, composerToast, composerTurnSummary, composerVisible, contextHubInitialLane, contextHubOpen,
    contextTabVisible, conversationId, designModeActiveUi, designModeChips,
    desktopStartupCenterMode, displayMessages, displayRunModel, draftRunBusy, draftSyntaxBusy, effectiveThinking,
    effectiveWsId, entryPortalStartup, execLane, fileInputRef,
    focusedPane, githubRepoContext, githubContextActive, clearGithubState, handleApprovePendingTool, handleChatImagePreview, handleComposerPaste, handleDenyPendingTool,
    handleDraftRunScript, handleDraftSyntaxCheck, handleExecLaneChange, handleInputChange, handlePlanIntakeSubmit, handleRunPlan,
    handleSavePlanWorkspace, handleSend, handleSendRef, handleStopSubagent, handleToggleScratchpad, hideOverlayMessagesForPortalStartup,
    imageInputRef, input, isDarkTheme, isLoading, isModeOpen, isModelPickerOpen,
    isNarrow, location, mentionIndex, mentionItems,
    mentionMenuRef, mentionOpen, mentionStyle, messageQueue, messages, messagesPortalTarget, messagesPortaled,
    messagesVisible, mobileAgentHomeMode, mobileAgentsThread, mobileContextFocusId, mobileHubTab, mobileRepoConnectorLabel,
    mobileThreadTab, mode, modeButtonRef, modeIcon, modeLabel, modeMenuRef, modeMenuStyle,
    modelButtonRef, modelPickerLabel, modelPickerRef, modelPickerStyle, modes, onAgentRunContext, onFileSelect,
    onKeyDown, onOpenCodeTab, onOpenEditor, onOpenGitHubIntegration, onOpenQuickstart, onRunInTerminal,
    onVoiceToolResult, openAgentGeneratedFile, openBeside, openContextHub, openRepoPicker, pendingToolApproval,
    pickModelKey, planIntakeBusy, planSuggestDismissed, policyWebSearch, presenceColorwayStyle,
    pythonDraftHint, refreshRuntimeChecks, removeAttachment, removeComposerSource, renderModelPickerList,
    renderShellTabStrip, renderThreadHeader, repoDrawerOpen, resolvedActivePlanId,
    runPlanBusy, runtimeChecks, runtimeChecksLoading, saveGithubRepoSelection, savePlanBusy, scratchpadOpen,
    scrollRef, selectedModelKey, sessions, sessionsLoading, setAttachMenuOpen, setComposerDragging,
    setContextHubOpen, setFocusedPane, setInput, setIsLoading, setIsModeOpen, setIsModelPickerOpen,
    setMentionIndex, setMessages, setMobileContextFocusId, setMobileHubTab, setMobileThreadTab, setMode,
    setPlanSuggestDismissed, setRepoDrawerOpen, setSlashIndex, setSplitChild, setSplitChildMessages, setSplitRatio,
    setToolTraceRows, shellTabsVisible, showEmptyThreadPlaceholder, showHeaderPresence, showInlinePresence, showMobileHubNav,
    showMobileRepoConnector, showThreadHeader, slashIndex, slashItems, slashMenuRef, slashOpen, slashStyle,
    sourceFromConnector, splitChild, splitChildMessages, splitRatio,
    startDeepResearchPrompt, startImageGenerationPrompt, startWebSearchLane, streamAgentRunIdRef, streamReaderRef,
    syncPickers, textareaRef, thinkingState, toggleComposerSource, toolTraceRows,
    totalStagedBytes, workflowLedger, workspaceId, workspaces,
  } = v;
  return (
    <>
      {!isNarrow ? (
        <RepoPickerBottomSheet
          open={repoDrawerOpen}
          onClose={() => setRepoDrawerOpen(false)}
          workspaceId={effectiveWsId}
          githubRepoContext={githubRepoContext}
          githubFilePath={chatGithubFilePath}
          onSelectRepo={(full) => saveGithubRepoSelection(full, null)}
          onSelectFile={(repo, path, branch, meta) =>
            saveGithubRepoSelection(repo, path, branch, meta)
          }
          onBrowseFiles={(full) => onOpenGitHubIntegration?.({ expandRepoFullName: full })}
        />
      ) : (
        <ContextHubDrawer
          open={contextHubOpen}
          onClose={() => setContextHubOpen(false)}
          initialLane={contextHubInitialLane}
          workspaceId={effectiveWsId}
          githubRepoContext={githubRepoContext}
          githubFilePath={chatGithubFilePath}
          pinnedLabel={githubContextActive ? githubRepoContext?.trim() || undefined : undefined}
          onClearPinned={clearGithubState}
          onSelectRepo={(full) => saveGithubRepoSelection(full, null)}
          onSelectFile={(repo, path, branch, meta) =>
            saveGithubRepoSelection(repo, path, branch, meta)
          }
          onBrowseFiles={(full) => onOpenGitHubIntegration?.({ expandRepoFullName: full })}
          activeSourceIds={activeComposerSourceIds}
          webSearchAllowed={policyWebSearch}
          sandboxAgentAllowed={false}
          onUploadFile={() => fileInputRef.current?.click()}
          onUploadImage={() => imageInputRef.current?.click()}
          onToggleWebSearch={() => {
            const on = activeComposerSourceIds.has(WEB_SEARCH_SOURCE_ID);
            toggleComposerSource(WEB_SEARCH_SOURCE, !on);
          }}
          onToggleSource={toggleComposerSource}
          execLane={execLane}
          onExecLaneChange={handleExecLaneChange}
        />
      )}
      {typeof document !== 'undefined' &&
        !isNarrow &&
        attachMenuOpen &&
        attachMenuStyle &&
        createPortal(
          <div ref={attachMenuRef}>
            <ComposerConnectorSheet
              style={attachMenuStyle}
              connectors={availableConnectors}
              connectorsLoading={availableConnectorsLoading}
              activeSourceIds={activeComposerSourceIds}
              webSearchAllowed={policyWebSearch}
              sandboxAgentAllowed={false}
              onClose={() => setAttachMenuOpen(false)}
              onAttachFiles={() => {
                setAttachMenuOpen(false);
                fileInputRef.current?.click();
              }}
              onCreateImage={startImageGenerationPrompt}
              onWebSearch={startWebSearchLane}
              onDeepResearch={startDeepResearchPrompt}
              onOpenTerminal={() => {
                setAttachMenuOpen(false);
                window.dispatchEvent(new CustomEvent('iam:open-terminal'));
              }}
              onToggleSource={toggleComposerSource}
              sourceFromConnector={sourceFromConnector}
            />
          </div>,
          document.body,
        )}
      {typeof document !== 'undefined' &&
        isModelPickerOpen &&
        modelPickerStyle &&
        createPortal(
          <div
            ref={modelPickerRef}
            className="flex max-h-[min(360px,calc(100dvh-6rem))] min-w-0 flex-col overflow-y-auto overflow-x-hidden rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] py-1 text-[0.6875rem] shadow-2xl"
            style={modelPickerStyle}
            role="listbox"
            aria-label="Model picker"
          >
            <div className="border-b border-[var(--dashboard-border)]/70 px-3 py-2 text-[9px] font-black uppercase tracking-[0.15em] text-[var(--dashboard-muted)]">
              Models — this chat only
            </div>
            {renderModelPickerList(pickModelKey)}
          </div>,
          document.body,
        )}
      {typeof document !== 'undefined' &&
        isModeOpen &&
        modeMenuStyle &&
        createPortal(
          <div
            ref={modeMenuRef}
            className="bg-[var(--scene-bg)] border border-[var(--dashboard-border)] rounded-xl shadow-2xl p-1 flex flex-col text-[0.6875rem] overflow-y-auto overflow-x-hidden min-w-0"
            style={modeMenuStyle}
          >
            {modes.map((m) => {
              const MenuIcon =
                m.id === 'plan'
                  ? ListTodo
                  : m.id === 'debug'
                    ? Bug
                    : m.id === 'multitask'
                      ? RefreshCw
                      : m.id === 'ask'
                        ? MessageCircle
                        : Infinity;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`mx-1 flex w-full min-w-0 items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--dashboard-panel)] ${
                    mode === m.id ? 'bg-[var(--dashboard-panel)]' : ''
                  }`}
                  onClick={() => {
                    setMode(m.id);
                    setIsModeOpen(false);
                  }}
                >
                  <MenuIcon
                    size={14}
                    className={`mt-0.5 shrink-0 ${mode === m.id ? 'text-[var(--solar-cyan)]' : 'text-[var(--dashboard-muted)]'}`}
                  />
                  <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                    <div
                      className={`text-[11px] font-bold ${mode === m.id ? 'text-[var(--solar-cyan)]' : 'text-[var(--dashboard-text)]'}`}
                    >
                      {m.label}
                    </div>
                    <div className="text-[9px] text-[var(--dashboard-muted)] leading-tight">{m.description}</div>
                  </div>
                </button>
              );
            })}
          </div>,
          document.body
        )}
      {typeof document !== 'undefined' &&
        mentionOpen &&
        mentionStyle &&
        mentionItems.length > 0 &&
        createPortal(
          <div
            ref={mentionMenuRef}
            className="bg-[var(--scene-bg)] border border-[var(--dashboard-border)] rounded-xl shadow-2xl flex flex-col text-[0.6875rem] overflow-y-auto overflow-x-hidden p-1 min-w-0"
            style={mentionStyle}
          >
            {mentionItems.map((it, i) => (
              <button
                key={it.id}
                type="button"
                className={`px-3 py-1.5 text-left rounded-lg truncate ${
                  i === mentionIndex ? 'bg-[var(--dashboard-panel)] text-[var(--solar-cyan)]' : 'text-[var(--dashboard-muted)] hover:bg-[var(--dashboard-panel)]'
                }`}
                onMouseEnter={() => setMentionIndex(i)}
                onClick={() => applyMention(it)}
              >
                <span className="text-[0.6875rem] uppercase text-[var(--dashboard-muted)] mr-2">{it.kind}</span>
                {it.label}
              </button>
            ))}
          </div>,
          document.body
        )}
      {typeof document !== 'undefined' &&
        slashOpen &&
        slashStyle &&
        slashItems.length > 0 &&
        createPortal(
          <div
            ref={slashMenuRef}
            className="bg-[var(--scene-bg)] border border-[var(--dashboard-border)] rounded-xl shadow-2xl flex flex-col text-[0.6875rem] overflow-y-auto overflow-x-hidden p-1 max-w-[min(320px,calc(100vw-2rem))] min-w-0"
            style={slashStyle}
          >
            {slashItems.map((c, i) => (
              <button
                key={c.slug}
                type="button"
                className={`px-3 py-1.5 text-left rounded-lg ${
                  i === slashIndex ? 'bg-[var(--dashboard-panel)] text-[var(--solar-cyan)]' : 'text-[var(--dashboard-muted)] hover:bg-[var(--dashboard-panel)]'
                }`}
                onMouseEnter={() => setSlashIndex(i)}
                onClick={() => applySlash(c)}
              >
                <div className="font-mono font-bold">/{c.slug}</div>
                {c.description && (
                  <div className="text-[0.625rem] text-[var(--dashboard-muted)] truncate">{c.description}</div>
                )}
              </button>
            ))}
          </div>,
          document.body
        )}
      {composerToast ? (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-[200] -translate-x-1/2 px-4 py-2 rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-canvas)] text-[11px] text-main shadow-lg max-w-md text-center max-phone:[bottom:calc(env(safe-area-inset-bottom,0px)+8px)]"
        >
          {composerToast}
        </div>
      ) : null}
    </>
  );
}
