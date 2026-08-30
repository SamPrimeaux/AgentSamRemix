/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ChatAssistant render tree (peel A7). UI orchestrator — hard ceiling 1000.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatAssistantChrome } from './ChatAssistantChrome';
import { suggestPlanMode } from '../../lib/plan-mode-utils';
import {
  ArrowUp,
  AudioLines,
  ChevronDown,
  FileText,
  Github,
  Mic,
  MousePointer2,
  Plus,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { AgentChatFilesPanel } from './components/AgentChatFilesPanel';
import { AgentComposerMicButton } from './composer/AgentComposerMicButton';
import { AgentComposerSourceChips } from './composer/AgentComposerSourceChips';
import { AgentMessageList } from './components/AgentMessageList';
import { AgentMobileContextPanel } from './components/AgentMobileContextPanel';
import { AgentMobileHomePanel } from './components/AgentMobileHomePanel';
import { AgentPresenceStatus } from '../../features/agent-presence';
import { ChatConversationPane } from './components/ChatConversationPane';
import { ChatSplitLayout } from './components/ChatSplitLayout';
import { ComposerStartupChips, ComposerStartupGreeting } from './components/ComposerStartupChips';
import { PlanStartOverBar } from './components/PlanStartOverBar';
import { ScriptDraftPanel } from './execution';
import { ToolApprovalModal } from '../../src/components/ToolApprovalModal';
import {
  CHAT_ATTACH_MAX_TOTAL_BYTES,
  CHAT_REQUEST_MAX_BYTES,
  COMPOSER_TEXTAREA_MAX_PX_NARROW,
  COMPOSER_TEXTAREA_MAX_PX_WIDE,
  MOBILE_CHAT_COMPOSER_BOTTOM_PAD,
  MOBILE_AGENT_HOME_SCROLL_BOTTOM_PAD,
  isAutoModelSelection,
} from './types';
import { formatFileSize } from './composerLayout';
import { LS_AGENT_CHAT_CONVERSATION_ID } from '../../agentChatConstants';
import { agentModeAccentCssVar } from '../../features/mode-presence/AgentModePresenceIcon';
import { dashboardComposerBottomPad } from '../../config/shellChrome';
import { readExecutionWorkspaceId } from '../../src/lib/activateProjectWorkContext';
function useTerminalPanelOpen(): boolean {
  const [open, setOpen] = useState(() => {
    if (typeof document === 'undefined') return false;
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--terminal-panel-h').trim();
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n > 0;
  });
  useEffect(() => {
    const sync = () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--terminal-panel-h').trim();
      const n = Number.parseFloat(raw);
      setOpen(Number.isFinite(n) && n > 0);
    };
    sync();
    window.addEventListener('iam-terminal-panel-h', sync);
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('iam-terminal-panel-h', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);
  return open;
}

export function ChatAssistantView({ v }: { v: any }) {
  const terminalPanelOpen = useTerminalPanelOpen();
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
    focusedPane, githubRepoContext, handleApprovePendingTool, handleChatImagePreview, handleComposerPaste, handleDenyPendingTool,
    handleDraftRunScript, handleDraftSyntaxCheck, handleExecLaneChange, handleInputChange, handlePlanIntakeSubmit, handleRunPlan,
    handleSavePlanWorkspace, handleSend, handleSendRef, handleStopSubagent, handleToggleScratchpad, hideOverlayMessagesForPortalStartup,
    imageInputRef, input, isDarkTheme, isLoading, isModeOpen, isModelPickerOpen,
    isNarrow, location, mentionIndex, mentionItems,
    mentionMenuRef, mentionOpen, mentionStyle, messageQueue, messages, messagesPortalTarget, messagesPortaled,
    messagesVisible, mobileAgentHomeMode, mobileAgentsThread, mobileContextFocusId, mobileHubTab, mobileRepoConnectorLabel,
    mobileThreadTab, mode, modeButtonRef, modeIcon, modeLabel, modeMenuRef, modeMenuStyle,
    modelButtonRef, modelPickerLabel, modelPickerRef, modelPickerStyle, modes, onAgentRunContext, onFileSelect,
    onKeyDown, onOpenCodeTab, onOpenEditor, onOpenGitHubIntegration, onOpenQuickstart, onRunInTerminal,
    onVoiceTurn, onVoiceToolResult, openAgentGeneratedFile, openBeside, openContextHub, openRepoPicker, pendingToolApproval,
    pickModelKey, planIntakeBusy, planSuggestDismissed, policyWebSearch, presence, presenceColorwayStyle,
    pythonDraftHint, refreshRuntimeChecks, removeAttachment, removeComposerSource, renderModelPickerList,
    renderShellTabStrip, renderThreadHeader, repoDrawerOpen, resolvedActivePlanId,
    runPlanBusy, runtimeChecks, runtimeChecksLoading, saveGithubRepoSelection, savePlanBusy, scratchpadOpen,
    scrollRef, selectedModelKey, sessions, sessionsLoading, setAttachMenuOpen, setComposerDragging,
    setContextHubOpen, setFocusedPane, setInput, setIsLoading, setIsModeOpen, setIsModelPickerOpen,
    setMentionIndex, setMessages, setMobileContextFocusId, setMobileHubTab, setMobileThreadTab, setMode,
    setPlanSuggestDismissed, setPresenceState, setRepoDrawerOpen, setSlashIndex, setSplitChild, setSplitChildMessages, setSplitRatio,
    setThinkingState, setToolTraceRows, setWorkflowLedger, shellTabsVisible, showEmptyThreadPlaceholder, showHeaderPresence, showInlinePresence, showMobileHubNav,
    showMobileRepoConnector, showThreadHeader, slashIndex, slashItems, slashMenuRef, slashOpen, slashStyle,
    sourceFromConnector, splitChild, splitChildMessages, splitRatio,
    startDeepResearchPrompt, startImageGenerationPrompt, startWebSearchLane, streamAgentRunIdRef, streamFinalizedRef, streamReaderRef,
    syncPickers, textareaRef, thinkingState, toggleComposerSource, toolTraceRows,
    totalStagedBytes, workflowLedger, workspaceId, workspaces,
  } = v;
  return (
    <>
      <div
        data-chat-assistant-contract="agent-app-sse-v1"
        className={`flex flex-col h-full min-h-0 max-w-full overflow-x-hidden overflow-y-hidden w-full min-w-0 ${
          atmosphericHomeMode && composerPortaled && !mobileAgentHomeMode
            ? 'bg-transparent pointer-events-none'
            : 'bg-[var(--dashboard-panel)]'
        }`}
        style={presenceColorwayStyle}
      >
        <style>{`
        .agent-content strong { color: var(--solar-cyan); font-weight: 700; }
        .agent-content h1, .agent-content h2, .agent-content h3 { color: var(--text-heading); font-weight: 700; margin-bottom: 0.75rem; }
        .agent-content ul, .agent-content ol { padding-left: 1.5rem; margin-bottom: 1rem; }
        .agent-content li { margin-bottom: 0.4rem; }
        .agent-content p + p { margin-top: 0.75rem; }
        .agent-content pre, .agent-content code { max-width: 100%; }
        .chat-hide-scroll::-webkit-scrollbar { display: none; }
      `}</style>
        {showMobileHubNav && (
          <header className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2.5 border-b border-[var(--dashboard-border)] shrink-0 bg-[var(--dashboard-panel)] z-10">
            <nav className="flex items-center justify-center gap-2 sm:gap-3 min-w-0 max-w-full overflow-x-auto chat-hide-scroll [scrollbar-width:none]">
              {(['agents', 'automations', 'dashboard'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setMobileHubTab(tab)}
                  className={`shrink-0 text-[13px] font-medium transition-colors whitespace-nowrap ${
                    mobileHubTab === tab ? 'text-[var(--dashboard-text)]' : 'text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]'
                  }`}
                >
                  {tab === 'agents' ? 'Agents' : tab === 'automations' ? 'Automations' : 'Dashboard'}
                </button>
              ))}
            </nav>
            <div
              className="w-7 h-7 rounded-full bg-[var(--bg-hover)] border border-[var(--dashboard-border)] flex items-center justify-center text-[9px] text-[var(--dashboard-muted)] shrink-0"
              aria-hidden
            >
              ·
            </div>
          </header>
        )}
        {isNarrow && mobileAgentsThread && (
          <div className="shrink-0 border-b border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] z-10">
            {renderThreadHeader(true, false, true)}
            <div className="flex gap-2 px-3 pb-2">
              <button
                type="button"
                onClick={() => setMobileThreadTab('chat')}
                className={`flex-1 min-w-0 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                  mobileThreadTab === 'chat'
                    ? 'bg-[var(--scene-bg)] text-[var(--dashboard-text)] border border-[var(--dashboard-border)]'
                    : 'text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] border border-transparent'
                }`}
              >
                Chat
              </button>
              <button
                type="button"
                onClick={() => setMobileThreadTab('context')}
                className={`flex-1 min-w-0 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                  mobileThreadTab === 'context'
                    ? 'bg-[var(--scene-bg)] text-[var(--dashboard-text)] border border-[var(--dashboard-border)]'
                    : 'text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] border border-transparent'
                }`}
              >
                Context
              </button>
            </div>
            {showHeaderPresence ? (
              <div className="px-3 pb-2">
                <AgentPresenceStatus presence={presence} mode={mode} showBadge={false} className="opacity-95" />
              </div>
            ) : null}
          </div>
        )}
        {/* AgentPresenceLogo: built but unwired — chat header has no stable avatar slot without layout churn. */}
        {!isNarrow && !atmosphericHomeMode && (showThreadHeader || shellTabsVisible) ? (
          <div className="flex-shrink-0 flex flex-col min-w-0 border-b border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]/60">
            <div className="flex items-stretch min-w-0 gap-1 sm:gap-2 overflow-x-auto chat-hide-scroll [scrollbar-width:none]">
              {showThreadHeader ? (
                <div className="flex-1 min-w-0">{renderThreadHeader(true, true)}</div>
              ) : null}
              {renderShellTabStrip('px-2 py-1 shrink-0 max-w-[min(100%,280px)] sm:max-w-none')}
            </div>
            {scratchpadOpen && isNarrow ? (
              <AgentChatFilesPanel
                messages={displayMessages}
                stagedCount={attachments.length}
                onAttach={() => {
                  setAttachMenuOpen(true);
                  textareaRef.current?.focus();
                }}
                onClose={handleToggleScratchpad}
                onOpenFile={openAgentGeneratedFile}
              />
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-1 min-h-0 overflow-hidden min-w-0">
        <div className={`flex flex-col flex-1 min-h-0 overflow-hidden min-w-0${desktopStartupCenterMode ? ' iam-chat-startup-center' : ''}`}>
        {mobileAgentHomeMode ? (
          <div className="order-2 shrink-0 flex justify-center pt-2 pb-1 px-3">
            <img
              src={
                isDarkTheme
                  ? 'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/dbb316af-9c97-4959-f09f-bf58b2783d00/avatar'
                  : 'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/11f6af46-0a3c-482a-abe8-83edc5a8a200/avatar'
              }
              alt="Inner Animal Media"
              width={48}
              height={48}
              className="object-contain opacity-90"
            />
          </div>
        ) : null}
        {messagesVisible && !desktopStartupCenterMode && !hideOverlayMessagesForPortalStartup && (() => {
          const block = (
          <>
          {(() => {
            if (showEmptyThreadPlaceholder || !pythonDraftHint || !/\.py$/i.test(pythonDraftHint)) return null;
            return (
            <div className="px-3 sm:px-4 shrink-0">
              <ScriptDraftPanel
                fileName={pythonDraftHint}
                workspacePath={activeFile?.workspacePath ?? null}
                onFocusEditor={() => onOpenCodeTab?.()}
                onSyntaxCheck={handleDraftSyntaxCheck}
                onRunScript={handleDraftRunScript}
                syntaxBusy={draftSyntaxBusy}
                runBusy={draftRunBusy}
              />
            </div>
            );
          })()}
        {(() => {
            const parentList = (
              <AgentMessageList
                scrollRef={scrollRef}
                showEmptyThreadPlaceholder={showEmptyThreadPlaceholder}
                suppressEmptyPlaceholder={mobileAgentHomeMode || composerPortaled || desktopStartupCenterMode}
                displayMessages={displayMessages}
                isLoading={isLoading && focusedPane === 'parent'}
                mode={mode}
                presence={presence}
                thinkingState={focusedPane === 'parent' ? effectiveThinking : null}
                showInlinePresence={showInlinePresence && focusedPane === 'parent'}
                isNarrow={isNarrow}
                activeSubagents={isNarrow ? activeSubagents : []}
                onStopSubagent={handleStopSubagent}
                onOpenBeside={openBeside}
                onSendUserMessage={(text) => void handleSendRef.current(text)}
                isDarkTheme={isDarkTheme}
                toolTraceRows={toolTraceRows}
                setToolTraceRows={setToolTraceRows}
                runModelKey={displayRunModel}
                workspaceId={workspaceId ?? null}
                workflowLedger={workflowLedger}
                onFileSelect={onFileSelect}
                onRunInTerminal={onRunInTerminal}
                onImagePreview={handleChatImagePreview}
                onRunPlan={(planId) => void handleRunPlan(planId)}
                runPlanBusy={runPlanBusy}
                onSavePlanWorkspace={(planId) => void handleSavePlanWorkspace(planId)}
                savePlanBusy={savePlanBusy}
                onPlanIntakeSubmit={(p) => void handlePlanIntakeSubmit(p)}
                planIntakeBusy={planIntakeBusy}
                pendingToolApproval={pendingToolApproval?.tool ?? null}
                approvalBusy={approvalBusy}
                onApprovePendingTool={() => void handleApprovePendingTool()}
                onDenyPendingTool={() => void handleDenyPendingTool()}
                mobileEnvelopeDiffs={isNarrow && mobileAgentsThread}
                onOpenDiffTab={() => {
                  setMobileContextFocusId(null);
                  setMobileThreadTab('context');
                }}
                onOpenDiffFile={(entryId) => {
                  setMobileContextFocusId(entryId);
                  setMobileThreadTab('context');
                }}
              />
            );
            if (!splitChild || isNarrow) return parentList;
            return (
              <ChatSplitLayout
                ratio={splitRatio}
                onRatioChange={setSplitRatio}
                left={
                  <ChatConversationPane
                    title="Parent"
                    focused={focusedPane === 'parent'}
                    onFocus={() => setFocusedPane('parent')}
                  >
                    {parentList}
                  </ChatConversationPane>
                }
                right={
                  <ChatConversationPane
                    title={splitChild.label}
                    focused={focusedPane === 'child'}
                    onFocus={() => setFocusedPane('child')}
                    onClose={() => {
                      setSplitChild(null);
                      setSplitChildMessages([]);
                      setFocusedPane('parent');
                    }}
                  >
                    <AgentMessageList
                      scrollRef={childScrollRef}
                      showEmptyThreadPlaceholder={splitChildMessages.length === 0}
                      suppressEmptyPlaceholder={false}
                      displayMessages={splitChildMessages}
                      isLoading={isLoading && focusedPane === 'child'}
                      mode={mode}
                      presence={presence}
                      thinkingState={focusedPane === 'child' ? effectiveThinking : null}
                      showInlinePresence={false}
                      isNarrow={false}
                      activeSubagents={[]}
                      onOpenBeside={openBeside}
                      onSendUserMessage={(text) => void handleSendRef.current(text)}
                      isDarkTheme={isDarkTheme}
                      toolTraceRows={[]}
                      runModelKey={displayRunModel}
                      workspaceId={workspaceId ?? null}
                      workflowLedger={workflowLedger}
                      onFileSelect={onFileSelect}
                      onRunInTerminal={onRunInTerminal}
                      onImagePreview={handleChatImagePreview}
                    />
                  </ChatConversationPane>
                }
              />
            );
          })()}
          </>
          );
          if (messagesPortaled && messagesPortalTarget && typeof document !== 'undefined') {
            return createPortal(
              <div className="agent-home-messages-portal pointer-events-auto flex flex-col flex-1 min-h-0 overflow-hidden w-full">
                {renderThreadHeader(true)}
                {block}
              </div>,
              messagesPortalTarget,
            );
          }
          if (messagesPortaled) return null;
          return block;
        })()}
        {mobileAgentHomeMode ? (
          <div
            className="order-4 flex flex-col flex-1 min-h-0 overflow-hidden min-w-0 bg-[var(--dashboard-panel)]"
            style={{ paddingBottom: MOBILE_AGENT_HOME_SCROLL_BOTTOM_PAD }}
          >
            <AgentMobileHomePanel
              sessions={sessions}
              sessionsLoading={sessionsLoading}
              workspaces={workspaces}
              activeWorkspaceId={effectiveWsId}
              onQuickstart={onOpenQuickstart}
            />
          </div>
        ) : null}
        {contextTabVisible ? (
          <div className="order-4 flex flex-col flex-1 min-h-0 overflow-hidden border-t border-[var(--dashboard-border)]">
            <AgentMobileContextPanel
              messages={displayMessages}
              githubRepoContext={githubRepoContext}
              runtimeChecks={runtimeChecks}
              runtimeChecksLoading={runtimeChecksLoading}
              onRefreshRuntime={() => void refreshRuntimeChecks()}
              onChooseRepo={() => openRepoPicker()}
              initialExpandedId={mobileContextFocusId}
              onOpenInEditor={(file) => onFileSelect?.(file)}
            />
          </div>
        ) : null}
        {composerVisible && mode === 'plan' && resolvedActivePlanId ? (
          <div className={`${composerFlexOrder} flex-shrink-0 w-full min-w-0 max-w-full px-3 pt-1`}>
            <PlanStartOverBar
              planId={resolvedActivePlanId}
              planTitle={activePlanTitle ?? undefined}
              isNarrow={isNarrow}
              onReverted={() => {
                setMessages((prev) => [
                  ...prev,
                  {
                    role: 'assistant',
                    content: 'Plan tasks reset — blocked steps are back to **todo**. Use **Build** to retry.',
                  },
                ]);
              }}
              onRefineHint={() => {
                setInput((prev) => (prev.trim().startsWith('@plan') ? prev : `@plan ${prev}`.trim()));
                textareaRef.current?.focus();
              }}
            />
          </div>
        ) : null}
        {composerVisible &&
        !atmosphericHomeMode &&
        !entryPortalStartup &&
        !desktopStartupCenterMode &&
        !isNarrow &&
        !planSuggestDismissed &&
        mode !== 'plan' &&
        suggestPlanMode(input) &&
        !isLoading ? (
          <div className={`${composerFlexOrder} flex-shrink-0 w-full min-w-0 max-w-full px-3`}>
            <div
              className={`flex items-center gap-2 rounded-xl border border-[var(--solar-cyan)]/25 bg-[var(--solar-cyan)]/8 ${
                isNarrow ? 'flex-wrap px-2.5 py-2' : 'px-3 py-2'
              }`}
            >
              <Sparkles size={14} className="shrink-0 text-[var(--solar-cyan)]" />
              <span className="min-w-0 flex-1 text-[11px] text-[var(--dashboard-text)]">
                Complex goal — try <strong>Plan mode</strong> (Shift+Tab or /plan) to explore first.
              </span>
              <button
                type="button"
                onClick={() => {
                  setMode('plan');
                  setPlanSuggestDismissed(true);
                }}
                className="rounded-full border border-[var(--solar-cyan)]/40 px-2.5 py-1 min-h-[32px] text-[10px] font-semibold text-[var(--solar-cyan)] hover:bg-[var(--solar-cyan)]/12"
              >
                Switch to Plan
              </button>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setPlanSuggestDismissed(true)}
                className="p-1 rounded-md text-[var(--dashboard-muted)] hover:bg-[var(--bg-hover)]"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ) : null}
        {composerVisible && (() => {
          const shell = (
        <div
          className={`${composerFlexOrder} iam-chat-composer-shell flex-shrink-0 w-full min-w-0 max-w-full ${
            composerPortaled || centerChatComposerColumn
              ? 'iam-chat-composer-shell--atmospheric'
              : 'px-3'
          } pt-2 space-y-2`}
          style={{
            paddingBottom:
              // Terminal owns the bottom band — don't double-pad for the home indicator.
              isNarrow && terminalPanelOpen
                ? 'max(0.5rem, env(safe-area-inset-bottom, 0px))'
                // Phone Agent Home scroll body already clears the home indicator — one owner only.
                : isNarrow && mobileAgentHomeMode
                  ? 'max(0.5rem, env(safe-area-inset-bottom, 0px))'
                  : composerPortaled && isNarrow
                    ? 'calc(env(safe-area-inset-bottom, 0px) + 8px)'
                    : isNarrow
                      ? MOBILE_CHAT_COMPOSER_BOTTOM_PAD
                      : dashboardComposerBottomPad(location.pathname, isNarrow, desktopStartupCenterMode ? 12 : 20),
          }}
        >
          <ToolApprovalModal
            workspaceId={readExecutionWorkspaceId() || workspaceId}
            agentRunId={agentRunId}
            toolExecutionActive={isLoading}
            chatSessionId={conversationId}
            onOpenInEditor={onFileSelect}
          />
          {attachments.length > 0 && (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1 chat-hide-scroll">
                {attachments.map((a) => (
                  <div
                    key={a.id}
                    className="relative flex-shrink-0 flex items-center gap-2 bg-[var(--scene-bg)] border border-[var(--dashboard-border)] rounded-lg pl-1 pr-7 py-1"
                  >
                    {a.type === 'image' && a.previewUrl ? (
                      <img
                        src={a.previewUrl}
                        alt=""
                        className="w-12 h-12 rounded-md object-cover"
                        style={{ width: 48, height: 48, borderRadius: 6 }}
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-md bg-[var(--dashboard-panel)] flex items-center justify-center border border-[var(--dashboard-border)]">
                        <FileText size={18} className="text-[var(--dashboard-muted)]" />
                      </div>
                    )}
                    {a.type === 'file' && (
                      <div className="min-w-0 max-w-[140px]">
                        <div className="text-[0.625rem] font-mono text-[var(--dashboard-text)] truncate">
                          {a.file.name.length > 24 ? `${a.file.name.slice(0, 21)}...` : a.file.name}
                        </div>
                        <div className="text-[0.6875rem] text-[var(--dashboard-muted)]">{formatFileSize(a.file.size)}</div>
                      </div>
                    )}
                    {a.stageStatus === 'pending' && (
                      <span className="absolute bottom-0.5 left-1 text-[0.5rem] font-mono text-[var(--dashboard-muted)]">
                        …
                      </span>
                    )}
                    {a.stageStatus === 'error' && (
                      <span
                        className="absolute bottom-0.5 left-1 text-[0.5rem] font-mono text-[var(--solar-red)]"
                        title={a.stageError || 'stage failed'}
                      >
                        !
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label="Remove attachment"
                      className="absolute top-0.5 right-0.5 p-0.5 rounded text-[var(--dashboard-muted)] hover:text-[var(--solar-red)] hover:bg-[var(--bg-hover)]"
                      onClick={() => removeAttachment(a.id)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.625rem] font-mono px-0.5 -mt-0.5 pb-0.5">
                <span
                  className={
                    totalStagedBytes > CHAT_ATTACH_MAX_TOTAL_BYTES ? 'text-[var(--solar-red)]' : 'text-[var(--dashboard-muted)]'
                  }
                >
                  Total: {(totalStagedBytes / (1024 * 1024)).toFixed(2)} MB / {(CHAT_REQUEST_MAX_BYTES / (1024 * 1024)).toFixed(0)} MB
                </span>
                {totalStagedBytes > CHAT_ATTACH_MAX_TOTAL_BYTES ? (
                  <span className="text-[var(--solar-red)]">
                    Over {(CHAT_ATTACH_MAX_TOTAL_BYTES / (1024 * 1024)).toFixed(0)} MB combined — remove files before send
                  </span>
                ) : null}
              </div>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="*/*"
            className="hidden"
            onChange={(e) => {
              addFilesFromList(e.target.files, false);
              e.target.value = '';
            }}
          />
          <input
            ref={imageInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              addFilesFromList(e.target.files, true);
              e.target.value = '';
            }}
          />
          {activeSubagents.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1.5 min-w-0">
              <span className="text-[0.625rem] uppercase tracking-wide text-[var(--dashboard-muted)] shrink-0">
                {activeSubagents.some((r) => r.cardStatus === 'running' || !r.cardStatus || r.cardStatus === 'approval_required')
                  ? `${activeSubagents.filter((r) => r.cardStatus !== 'done' && r.cardStatus !== 'failed').length || activeSubagents.length} subagent${activeSubagents.length === 1 ? '' : 's'}`
                  : 'Subagents'}
              </span>
              {activeSubagents.map((row) => {
                const statusDot =
                  row.cardStatus === 'approval_required'
                    ? 'bg-amber-400'
                    : row.cardStatus === 'done'
                      ? 'bg-emerald-400'
                      : row.cardStatus === 'failed'
                        ? 'bg-red-400'
                        : 'bg-[var(--solar-cyan)] animate-pulse';
                return (
                  <button
                    key={row.id}
                    type="button"
                    title={row.conversationId ? 'Open beside' : row.label}
                    disabled={!row.conversationId}
                    onClick={() => {
                      if (row.conversationId) void openBeside(row.conversationId, row.label);
                    }}
                    className={`inline-flex items-center gap-1.5 max-w-[12rem] truncate rounded-md border px-1.5 py-0.5 text-[0.6875rem] ${
                      row.conversationId
                        ? 'border-[var(--solar-cyan)]/35 text-[var(--solar-cyan)] hover:bg-[var(--solar-cyan)]/10 cursor-pointer'
                        : 'border-[var(--dashboard-border)] text-[var(--dashboard-muted)] cursor-default'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot}`} aria-hidden />
                    <span className="truncate">{row.label}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div
            ref={composerGlassRef}
            data-agent-mode={mode}
            style={
              {
                ['--agent-composer-accent' as string]: agentModeAccentCssVar(mode),
              } as React.CSSProperties
            }
            className={`iam-chat-composer-glass flex flex-col rounded-xl transition-all overflow-visible ${
              isNarrow ? 'iam-chat-composer-glass--mobile' : ''
            } ${composerPortaled || centerChatComposerColumn ? 'iam-chat-composer-glass--atmospheric' : ''
            } ${composerDragging ? 'iam-chat-composer-glass--dragging' : ''}`}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              composerDragDepthRef.current += 1;
              setComposerDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              composerDragDepthRef.current = Math.max(0, composerDragDepthRef.current - 1);
              if (composerDragDepthRef.current === 0) setComposerDragging(false);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              composerDragDepthRef.current = 0;
              setComposerDragging(false);
              addFilesFromList(e.dataTransfer.files, false);
            }}
          >
            {designModeActiveUi ? (
              <div className="flex flex-wrap items-center gap-1.5 px-2 pt-2 pb-0 min-w-0">
                <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--solar-cyan)]">
                  Design Mode
                </span>
                <span className="text-[0.625rem] text-[var(--dashboard-muted)]">
                  Agent kit auto · no mode swap
                </span>
                {designModeChips.map((c) => (
                  <span
                    key={c.id}
                    className="max-w-[40%] truncate rounded-md border border-[var(--solar-cyan)]/30 bg-[var(--solar-cyan)]/10 px-1.5 py-0.5 text-[0.625rem] font-mono text-[var(--solar-cyan)]"
                  >
                    {c.label}
                  </span>
                ))}
              </div>
            ) : null}
            {browserElementContext ? (
              <div className="flex items-center gap-2 px-2 pt-2 pb-0 min-w-0">
                <div
                  className="flex items-center gap-1.5 min-w-0 max-w-full rounded-lg border border-[var(--solar-cyan)]/35 bg-[var(--solar-cyan)]/10 pl-2 pr-1 py-1 text-[0.6875rem] font-mono text-[var(--solar-cyan)]"
                  title="Browser element attached to this message — ask what it is, how to style it, etc."
                >
                  <MousePointer2 size={12} className="shrink-0" aria-hidden />
                  <span className="truncate">
                    @{browserElementMentionToken(browserElementContext)}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove browser element from message"
                    className="shrink-0 p-0.5 rounded text-[var(--dashboard-muted)] hover:text-[var(--solar-red)] hover:bg-[var(--bg-hover)]"
                    onClick={clearBrowserElementContext}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ) : null}
            {composerSources.length > 0 ? (
              <div className="px-2 pt-2 pb-0 min-w-0">
                <AgentComposerSourceChips sources={composerSources} onRemove={removeComposerSource} />
              </div>
            ) : null}
            <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onPaste={handleComposerPaste}
                onKeyDown={onKeyDown}
                onSelect={(ev) => syncPickers(ev.currentTarget.value, ev.currentTarget.selectionStart)}
                onClick={(ev) => syncPickers(ev.currentTarget.value, ev.currentTarget.selectionStart)}
                placeholder={isNarrow ? 'Ask Agent Sam' : composerPlaceholder}
                rows={1}
                className={`iam-composer-textarea w-full min-w-0 bg-transparent px-3 pt-2.5 pb-1 focus:outline-none text-[var(--dashboard-text)] placeholder:text-[var(--text-placeholder-strong)] resize-none font-sans leading-relaxed ${
                  isNarrow ? 'text-base' : 'text-[0.8125rem]'
                }`}
                style={{
                  minHeight: '44px',
                  maxHeight: isNarrow ? COMPOSER_TEXTAREA_MAX_PX_NARROW : COMPOSER_TEXTAREA_MAX_PX_WIDE,
                }}
              />
            <div className="iam-composer-toolbar flex items-center justify-between gap-2 px-2 pb-2 pt-0.5 min-w-0">
              <div className="iam-composer-toolbar__left flex items-center gap-1.5 min-w-0 shrink">
                <button
                  type="button"
                  ref={modeButtonRef}
                  onClick={() => {
                    setIsModeOpen((o) => !o);
                    setIsModelPickerOpen(false);
                    setAttachMenuOpen(false);
                  }}
                  className={`${composerPillClass} max-w-[9rem] ${isNarrow ? 'hidden' : ''}`}
                  title={`Conversation mode: ${modeLabel}`}
                  aria-expanded={isModeOpen}
                  aria-haspopup="listbox"
                >
                  {modeIcon}
                  <span className="truncate">{modeLabel}</span>
                  <ChevronDown size={12} className="shrink-0 opacity-60" />
                </button>
                <button
                  type="button"
                  ref={modelButtonRef}
                  onClick={() => {
                    setIsModelPickerOpen((o) => !o);
                    setIsModeOpen(false);
                    setAttachMenuOpen(false);
                  }}
                  className={`${composerPillClass} max-w-[10rem] ${isNarrow ? 'hidden' : ''}`}
                  title={
                    isAutoModelSelection(selectedModelKey)
                      ? 'Model: Auto (Thompson routing)'
                      : `Model: ${modelPickerLabel}`
                  }
                  aria-expanded={isModelPickerOpen}
                  aria-haspopup="listbox"
                  aria-hidden={isNarrow && isLoading ? true : undefined}
                  tabIndex={isNarrow && isLoading ? -1 : undefined}
                >
                  <span className="truncate">{modelPickerLabel}</span>
                  <ChevronDown size={12} className="shrink-0 opacity-60" />
                </button>
              </div>
              <div className="iam-composer-toolbar__right flex items-center gap-1.5 shrink-0 min-w-0">
                {!isNarrow && showMobileRepoConnector ? (
                  <button
                    type="button"
                    onClick={() => openContextHub('github')}
                    className="iam-composer-connection inline-flex shrink-0 items-center justify-center gap-0.5 rounded-full text-[var(--dashboard-muted)] transition-colors hover:text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)]"
                    aria-label="GitHub context active. Manage repository context"
                    title="GitHub context active"
                  >
                    <Github size={13} aria-hidden />
                    <span className="iam-composer-connection__at" aria-hidden>@</span>
                  </button>
                ) : null}
                <AgentComposerMicButton
                  onTranscript={appendSpeechToInput}
                  onUserVoiceTranscript={appendVoiceUserToThread}
                  onAssistantTranscript={appendVoiceAssistantToThread}
                  onToolResult={onVoiceToolResult}
                  onVoiceTurn={onVoiceTurn}
                  conversationId={conversationId}
                  disabled={isLoading}
                  compactActiveOnly={isNarrow}
                />
                <button
                  type="button"
                  ref={attachButtonRef}
                  className="iam-composer-attach flex-shrink-0 p-2 text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)] hover:bg-[var(--bg-hover)] rounded-lg transition-all"
                  title="Add files, web search, or sources"
                  aria-expanded={attachMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => {
                    if (isNarrow) {
                      openContextHub('hub');
                    } else {
                      setAttachMenuOpen((o) => !o);
                    }
                    setIsModeOpen(false);
                    setIsModelPickerOpen(false);
                  }}
                >
                  <Plus size={16} strokeWidth={2} />
                </button>
                <button
                type="button"
                onClick={() => {
                  if (isLoading) {
                    // Resolve conversation id from state, then localStorage — atmospheric
                    // portal turns can briefly have empty React state while LS is set.
                    let convId = String(conversationId || '').trim();
                    if (!convId && typeof localStorage !== 'undefined') {
                      try {
                        convId =
                          localStorage.getItem(LS_AGENT_CHAT_CONVERSATION_ID)?.trim() || '';
                      } catch {
                        convId = '';
                      }
                    }
                    streamFinalizedRef.current = true;
                    cancelAgentChatRun(streamAgentRunIdRef.current || agentRunId || null, {
                      conversationId: convId || null,
                    });
                    // Local abort is also fired by IAM_AGENT_ABORT_LIVE_STREAM; keep explicit
                    // clears so Stop restores Send even if the event listener is late.
                    abortControllerRef.current?.abort();
                    streamReaderRef.current?.cancel().catch(() => {});
                    abortControllerRef.current = null;
                    streamReaderRef.current = null;
                    streamAgentRunIdRef.current = null;
                    onAgentRunContext?.(null);
                    setIsLoading(false);
                    setThinkingState?.(null);
                    setPresenceState?.('idle');
                    setToolTraceRows?.([]);
                    setWorkflowLedger?.(null);
                  } else {
                    handleSend();
                  }
                }}
                disabled={!isLoading && !canSend}
                className={`iam-composer-send flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full text-[0.6875rem] font-bold transition-all relative ${
                  canSend || isLoading
                    ? 'bg-[var(--accent,var(--accent-secondary,var(--solar-cyan)))] text-[var(--dashboard-canvas)] shadow-[0_0_16px_var(--accent-glow,color-mix(in_srgb,var(--accent-secondary,var(--solar-cyan))_25%,transparent))] hover:bg-[var(--accent-hover,var(--accent-secondary,var(--solar-cyan)))] hover:brightness-110'
                    : 'text-[var(--text-chrome-muted)] bg-[var(--accent-muted,var(--bg-disabled))] cursor-not-allowed'
                } ${isLoading ? 'agent-send-pulse' : ''} ${
                  pendingToolApproval && !isLoading ? 'agent-send-approval ring-1 ring-[var(--solar-yellow)]/45' : ''
                }`}
                title={
                  isLoading ? 'Stop' : pendingToolApproval ? 'Approval required — confirm below' : 'Send'
                }
              >
                {isLoading ? (
                  <>
                    <X size={12} className="text-red-600" />
                    {messageQueue.length > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold border border-[var(--dashboard-panel)]">
                        {messageQueue.length}
                      </span>
                    )}
                  </>
                ) : pendingToolApproval ? (
                  <ShieldCheck size={14} className="text-[var(--dashboard-canvas)]" />
                ) : (
                  <ArrowUp size={14} strokeWidth={2.5} />
                )}
              </button>
              </div>
            </div>
          </div>
          {composerTurnSummary ? (
            <div
              className="flex items-center gap-1.5 px-1 pt-0.5 pb-1 text-[11px] leading-snug text-[var(--dashboard-muted)] font-sans"
              role="status"
              title={[composerTurnSummary.model, composerTurnSummary.toolsLabel].filter(Boolean).join(' · ')}
            >
              <span
                className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-[#34d399]"
                style={{ background: 'color-mix(in srgb, #34d399 18%, transparent)' }}
                aria-hidden
              >
                ✓
              </span>
              <span className="shrink-0">Done</span>
              {composerTurnSummary.model ? (
                <span className="min-w-0 truncate opacity-90">· {composerTurnSummary.model}</span>
              ) : null}
              {composerTurnSummary.toolsLabel ? (
                <span className="min-w-0 truncate opacity-80">· {composerTurnSummary.toolsLabel}</span>
              ) : null}
            </div>
          ) : null}
        </div>
          );
          // Portaled composer must always re-enable pointer events — parent host
          // trees use pointer-events-none for atmospheric overlays.
          const wrapPortaled = (node: React.ReactNode) =>
            composerPortaled ? (
              <div className="pointer-events-auto w-full min-w-0">{node}</div>
            ) : (
              node
            );
          const wrappedShell = composerPortaled && entryPortalStartup ? (
            wrapPortaled(shell)
          ) : desktopStartupCenterMode || entryPortalStartup ? (
            <div
              className={`iam-chat-startup-stack order-2 shrink-0 w-full${
                composerPortaled ? ' pointer-events-auto' : ''
              }`}
            >
              {!entryPortalStartup ? (
                <ComposerStartupGreeting isDarkTheme={isDarkTheme} />
              ) : null}
              {shell}
              {!entryPortalStartup ? (
                <ComposerStartupChips
                  className="mt-2"
                  onCreateImage={startImageGenerationPrompt}
                  onWebSearch={startWebSearchLane}
                  onOpenEditor={() => onOpenEditor?.()}
                />
              ) : null}
            </div>
          ) : (
            wrapPortaled(shell)
          );
          if (composerPortaled) {
            if (!composerPortalTarget || typeof document === 'undefined') return null;
            return createPortal(wrappedShell, composerPortalTarget);
          }
          return wrappedShell;
        })()}
        </div>
        </div>
      </div>
      <ChatAssistantChrome v={v} />
    </>
  );
}
