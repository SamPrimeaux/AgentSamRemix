/**
 * Editor workbench entry — valid lanes when no file is open (no auto Untitled.ts).
 */
import { FolderOpen, Files, Globe, FilePlus, LayoutGrid } from 'lucide-react';
import { StartupChipRow } from '../shell/chat-startup/StartupChipRow';
import '../../components/ChatAssistant/chat-startup-center.css';

export type EditorWorkbenchLanesProps = {
  onOpenFileTree: () => void;
  onOpenFolder: () => void;
  onBrowseWeb: () => void;
  onNewFile: () => void;
  onOpenWorkspace: () => void;
  recentFiles?: { name: string; path: string }[];
  onOpenRecent?: (path: string) => void;
};

export function EditorWorkbenchLanes({
  onOpenFileTree,
  onOpenFolder,
  onBrowseWeb,
  onNewFile,
  onOpenWorkspace,
  recentFiles = [],
  onOpenRecent,
}: EditorWorkbenchLanesProps) {
  const recents = recentFiles.slice(0, 5);

  return (
    <div
      className="flex flex-1 min-h-0 items-center justify-center p-6 bg-[var(--dashboard-canvas)]"
      role="main"
      aria-label="Editor workbench"
    >
      <div className="iam-chat-startup-stack max-w-lg w-full">
        <header className="iam-chat-startup-greeting">
          <img
            src="https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/11f6af46-0a3c-482a-abe8-83edc5a8a200/avatar"
            alt=""
            width={56}
            height={56}
            className="opacity-90"
          />
          <p className="text-[15px] font-semibold text-[var(--dashboard-text)]">Choose a lane</p>
          <p className="text-[12px] text-[var(--dashboard-muted)] leading-relaxed max-w-sm">
            Open the file tree, pick a workspace, browse a site, or start a new file — Agent Sam stays in the side panel.
          </p>
        </header>

        <StartupChipRow
          ariaLabel="Editor lanes"
          chips={[
            { id: 'files', label: 'File tree', icon: Files, onClick: onOpenFileTree },
            { id: 'folder', label: 'Open folder', icon: FolderOpen, onClick: onOpenFolder },
            { id: 'browser', label: 'Browse web', icon: Globe, onClick: onBrowseWeb },
            { id: 'new', label: 'New file', icon: FilePlus, onClick: onNewFile },
            { id: 'workspace', label: 'Workspace', icon: LayoutGrid, onClick: onOpenWorkspace },
          ]}
        />

        {recents.length > 0 && onOpenRecent ? (
          <div className="rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]/60 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--dashboard-muted)] mb-2">
              Recent
            </p>
            <ul className="space-y-1">
              {recents.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    className="w-full text-left text-[12px] px-2 py-1.5 rounded-md text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)] truncate"
                    onClick={() => onOpenRecent(f.path)}
                  >
                    {f.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
