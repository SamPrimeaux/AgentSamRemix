/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Thread header + shell tab strip render helpers.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import { AgentChatThreadHeader } from '../components/AgentChatThreadHeader';
import { AgentChatFilesPanel } from '../components/AgentChatFilesPanel';
import type { AgentGeneratedFile } from '../types';

export function useChatThreadChrome(d: any) {
  const {
    onFileSelect, showThreadHeader, conversationId, threadTitle, activeSessionRow, chatProjects,
    setThreadTitle, loadSessions, onDeleteActiveChat, handleNewChat, handleToggleScratchpad,
    scratchpadOpen, scratchpadFileCount, isNarrow, onOpenCodeTab, setAttachMenuOpen, textareaRef,
    displayMessages, attachments, showAgentWorkbenchTabs, onAgentChatShellNewTab, agentChatShellTabs,
    activeAgentChatShellTabId, onAgentChatShellTabSelect, onAgentChatShellTabClose,
  } = d;

  const openAgentGeneratedFile = useCallback(
    (file: AgentGeneratedFile) => {
      if (file.kind === 'image' || /\.(png|jpe?g|webp|gif)$/i.test(file.filename)) {
        if (file.r2Url && typeof window !== 'undefined') {
          window.open(file.r2Url, '_blank', 'noopener,noreferrer');
        }
        return;
      }
      if (file.content) {
        onFileSelect?.({
          name: file.filename,
          content: file.content,
          workspacePath: file.workspacePath,
        });
        return;
      }
      if (file.r2Url) {
        void fetch(file.r2Url, { credentials: 'include' })
          .then((r) => r.text())
          .then((content) =>
            onFileSelect?.({
              name: file.filename,
              content,
              workspacePath: file.workspacePath,
            }),
          )
          .catch((e) => console.warn('[ChatAssistant] scratchpad open failed', e));
      }
    },
    [onFileSelect],
  );

  const renderThreadHeader = (compact = false, embedded = false, mobileThreadChrome = false) =>
    showThreadHeader ? (
      <>
        <AgentChatThreadHeader
          conversationId={conversationId}
          threadTitle={threadTitle}
          session={activeSessionRow}
          projects={chatProjects}
          onTitleChange={setThreadTitle}
          onReloadSessions={loadSessions}
          onDeletedActive={onDeleteActiveChat}
          onNewChat={handleNewChat}
          onToggleScratchpad={handleToggleScratchpad}
          scratchpadOpen={scratchpadOpen}
          scratchpadFileCount={scratchpadFileCount}
          compact={compact}
          embedded={embedded}
          mobileThreadChrome={mobileThreadChrome}
          onView={mobileThreadChrome ? () => onOpenCodeTab?.() : undefined}
        />
        {scratchpadOpen && isNarrow && !embedded ? (
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
      </>
    ) : null;

  const shellTabsVisible =
    showAgentWorkbenchTabs &&
    Boolean(onAgentChatShellNewTab && agentChatShellTabs && agentChatShellTabs.length > 0);

  const renderShellTabStrip = (className = '') =>
    shellTabsVisible ? (
      <div
        className={`flex items-center gap-1 min-w-0 overflow-x-auto chat-hide-scroll [scrollbar-width:none] ${className}`}
      >
        {agentChatShellTabs!.map((tab) => (
          <div
            key={tab.id}
            className={`group/tab flex items-center shrink-0 max-w-[min(176px,40vw)] rounded-md border transition-colors ${
              tab.id === activeAgentChatShellTabId
                ? 'bg-[var(--scene-bg)] border-[var(--dashboard-border)]'
                : 'border-transparent hover:bg-[var(--bg-hover)]'
            }`}
          >
            <button
              type="button"
              onClick={() => onAgentChatShellTabSelect?.(tab.id)}
              className={`min-w-0 flex-1 truncate px-2 sm:px-2.5 py-1 text-[11px] font-medium text-left transition-colors ${
                tab.id === activeAgentChatShellTabId
                  ? 'text-[var(--solar-cyan)]'
                  : 'text-[var(--dashboard-muted)] group-hover/tab:text-[var(--dashboard-text)]'
              }`}
              title={tab.title}
            >
              {tab.title}
            </button>
            {onAgentChatShellTabClose ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAgentChatShellTabClose(tab.id);
                }}
                className="shrink-0 mr-0.5 p-0.5 rounded text-[var(--dashboard-muted)] opacity-70 hover:opacity-100 hover:text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)]"
                title="Close chat"
                aria-label={`Close ${tab.title}`}
              >
                <X size={11} strokeWidth={2} />
              </button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          onClick={handleNewChat}
          className="shrink-0 p-1 rounded-md text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)] border border-transparent"
          title="New chat"
          aria-label="New chat"
        >
          <Plus size={14} strokeWidth={1.75} />
        </button>
      </div>
    ) : null;

  return { openAgentGeneratedFile, renderThreadHeader, shellTabsVisible, renderShellTabStrip };
}
