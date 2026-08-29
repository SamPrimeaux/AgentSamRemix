/**
 * Slim code-tools rail for /dashboard/agent/editor — sessions + file tree (~240px).
 */
import { Suspense, lazy, type FC } from 'react';
import { Plus, Search } from 'lucide-react';
import { AgentChatSessionList } from './AgentChatSessionList';

const AgentSamFilesystem = lazy(() =>
  import('../AgentSamFilesystem').then((m) => ({ default: m.AgentSamFilesystem })),
);

type CodeToolsSidebarProps = {
  workspaceId?: string | null;
  userId?: string | null;
  activeConversationId?: string | null;
  nativeFolderOpenSignal?: number;
  pinnedGithubRepo?: string | null;
  onNewChat?: () => void;
  onSelectChat?: (conversationId: string, title?: string) => void;
  onDeleteActiveChat?: (conversationId: string) => void;
  onFileSelect?: (file: import('../../types').ActiveFile) => void;
  onWorkspaceRootChange?: (payload: { folderName: string }) => void;
  onSearchFiles?: () => void;
};

export const CodeToolsSidebar: FC<CodeToolsSidebarProps> = ({
  workspaceId,
  userId,
  activeConversationId,
  nativeFolderOpenSignal = 0,
  pinnedGithubRepo,
  onNewChat,
  onSelectChat,
  onDeleteActiveChat,
  onFileSelect,
  onWorkspaceRootChange,
  onSearchFiles,
}) => {
  return (
    <div className="flex flex-col h-full min-h-0 w-full text-[var(--dashboard-text)]">
      <div className="shrink-0 px-2 pt-1 pb-2 border-b border-[var(--dashboard-border)]">
        <button
          type="button"
          onClick={onNewChat}
          className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] font-medium bg-[var(--bg-hover)] hover:bg-[var(--dashboard-panel)] border border-[var(--dashboard-border)] transition-colors"
        >
          <Plus size={14} strokeWidth={1.75} aria-hidden />
          New session
        </button>
      </div>

      <div className="shrink-0 px-1 py-2 border-b border-[var(--dashboard-border)]">
        <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted opacity-70">
          Recent sessions
        </div>
        <AgentChatSessionList
          variant="sidebar"
          expanded
          activeConversationId={activeConversationId}
          onSelect={onSelectChat}
          onDeletedActive={onDeleteActiveChat}
        />
      </div>

      <div className="shrink-0 px-2 py-2 border-b border-[var(--dashboard-border)]">
        <button
          type="button"
          onClick={onSearchFiles}
          className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-muted hover:text-main hover:bg-[var(--bg-hover)] transition-colors"
        >
          <Search size={13} strokeWidth={1.75} aria-hidden />
          Search files
          <span className="ml-auto text-[10px] opacity-60">⌘K</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted opacity-70 shrink-0">
          Files
        </div>
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-[11px] text-muted px-3 text-center">
              Loading file tree…
            </div>
          }
        >
          <AgentSamFilesystem
            workspace_id={workspaceId}
            user_id={userId}
            nativeFolderOpenSignal={nativeFolderOpenSignal}
            onWorkspaceRootChange={onWorkspaceRootChange}
            onFileSelect={onFileSelect}
            onOpenInEditor={onFileSelect}
            pinnedGithubRepo={pinnedGithubRepo}
          />
        </Suspense>
      </div>
    </div>
  );
};
