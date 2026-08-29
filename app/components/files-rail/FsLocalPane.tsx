import React from 'react';
import { VirtualizedFileTree } from '../VirtualizedFileTree';
import type { LocalFileNode, LocalFileTreeRow } from '../../src/lib/localFileTree';

type FsLocalPaneProps = {
  rootDir: LocalFileNode | null;
  localResumeHint: { folderName: string } | null;
  localTreeRows: LocalFileTreeRow[];
  onLocalTreeRowClick: (row: LocalFileTreeRow) => void;
  handleOpenFolder: () => void;
  handleReconnectPersistedFolder: () => void;
  handleCloneIntoWorkspace: () => void | Promise<void>;
  cloneBusy: boolean;
  cloneToast: string | null;
};

export const FsLocalPane: React.FC<FsLocalPaneProps> = ({
  rootDir,
  localResumeHint,
  localTreeRows,
  onLocalTreeRowClick,
  handleOpenFolder,
  handleReconnectPersistedFolder,
  handleCloneIntoWorkspace,
  cloneBusy,
  cloneToast,
}) => (
          <div className="flex-1 min-h-0 flex flex-col px-1 py-1 font-mono">
            {!rootDir ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 py-6">
                {localResumeHint ? (
                  <div className="w-full max-w-[240px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)]/80 p-3">
                    <p className="text-[10px] text-main leading-snug text-center">
                      You last had{' '}
                      <span className="font-semibold text-[var(--solar-cyan)]">{localResumeHint.folderName}</span>{' '}
                      open. Reconnect to grant access again.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleReconnectPersistedFolder()}
                      className="mt-2 w-full text-[10px] font-semibold py-1.5 rounded border border-[var(--solar-cyan)]/40 text-[var(--solar-cyan)] hover:bg-[var(--solar-cyan)]/10"
                    >
                      Reconnect folder
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenFolder()}
                      className="mt-1 w-full text-[9px] py-1 rounded text-muted hover:text-main"
                    >
                      Choose a different folder
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleOpenFolder()}
                  className="text-[11px] text-[var(--solar-blue)] hover:text-white hover:underline font-medium py-2 px-4 border border-[var(--solar-blue)]/30 rounded-lg"
                >
                  Connect native folder
                </button>
                <button
                  type="button"
                  disabled={cloneBusy}
                  onClick={() => void handleCloneIntoWorkspace()}
                  className="text-[11px] text-[var(--solar-cyan)] hover:text-white hover:underline font-medium py-2 px-4 border border-[var(--solar-cyan)]/30 rounded-lg disabled:opacity-40"
                >
                  {cloneBusy ? 'Cloning…' : 'Clone into workspace'}
                </button>
                {cloneToast ? (
                  <p className="text-[9px] text-muted text-center max-w-[240px] leading-relaxed break-all">
                    {cloneToast}
                  </p>
                ) : null}
                <p className="text-[9px] text-muted text-center max-w-[220px] leading-relaxed">
                  Chromium File System Access — folder name only is stored locally. Clone binds host workspace_root via terminal lane.
                </p>
              </div>
            ) : (
              <VirtualizedFileTree
                rows={localTreeRows}
                fillHeight
                ariaLabel="Local files"
                onRowClick={(row) => void onLocalTreeRowClick(row)}
              />
            )}
          </div>
);
