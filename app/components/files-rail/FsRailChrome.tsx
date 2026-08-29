import React from 'react';
import { GripVertical, PanelLeftClose, RefreshCw } from 'lucide-react';
import { FsSourceIcon } from '../../src/components/FsSourceIcon';
import {
  AGENT_SAM_FS_SOURCES,
  fsSourceIconId,
  type AgentSamFsPaneMode,
  type AgentSamFsSource,
} from '../../src/lib/agentSamFilesystemTypes';

export type FsRailChromeProps = {
  onClose?: () => void;
  headerTitle: string;
  runHeaderRefresh: () => void | Promise<void>;
  headerRefreshBusy: boolean;
  refreshedAtLabel: string | null;
  modesEnabled: boolean;
  paneMode: AgentSamFsPaneMode;
  setPaneMode: React.Dispatch<React.SetStateAction<AgentSamFsPaneMode>>;
  showSnapshotTab: boolean;
  activeSource: AgentSamFsSource;
  selectSource: (source: AgentSamFsSource) => void;
};

export const FsRailChrome: React.FC<FsRailChromeProps> = ({
  onClose,
  headerTitle,
  runHeaderRefresh,
  headerRefreshBusy,
  refreshedAtLabel,
  modesEnabled,
  paneMode,
  setPaneMode,
  showSnapshotTab,
  activeSource,
  selectSource,
}) => (
  <>
  <div className="flex items-center justify-between px-3 py-2 shrink-0 border-b border-[var(--border-subtle)]/40 gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <GripVertical size={12} className="text-muted/50 shrink-0 hidden md:block" aria-hidden />
          <span className="text-[11px] font-semibold tracking-wide text-main truncate" title={headerTitle}>
            {headerTitle}
          </span>
          <button
            type="button"
            className="shrink-0 p-1 rounded-md text-muted hover:text-main hover:bg-[var(--bg-hover)] transition-colors"
            title="Refresh"
            aria-label="Refresh files"
            onClick={() => void runHeaderRefresh()}
            disabled={headerRefreshBusy}
          >
            <RefreshCw size={12} className={headerRefreshBusy ? 'animate-spin' : ''} />
          </button>
          {refreshedAtLabel ? (
            <span className="text-[9px] text-muted/80 truncate shrink min-w-0" title={`Refreshed at ${refreshedAtLabel}`}>
              Refreshed at {refreshedAtLabel}
            </span>
          ) : null}
        </div>
        {onClose ? (
          <button
            type="button"
            className="shrink-0 p-1.5 rounded-md text-muted hover:text-main hover:bg-[var(--bg-hover)] transition-colors"
            title="Close Files (⌘B)"
            aria-label="Close Files"
            onClick={onClose}
          >
            <PanelLeftClose size={14} strokeWidth={1.75} />
          </button>
        ) : null}
      </div>

      {modesEnabled ? (
        <div
          className="shrink-0 flex items-center gap-1 px-2 py-1 border-b border-[var(--border-subtle)]/30"
          role="tablist"
          aria-label="Files pane modes"
          data-testid="agent-sam-fs-mode-tabs"
        >
          {(
            [
              { id: 'files' as const, label: 'Files' },
              { id: 'changes' as const, label: 'Changes' },
              ...(showSnapshotTab ? [{ id: 'snapshot' as const, label: 'Snapshot' }] : []),
            ] as Array<{ id: AgentSamFsPaneMode; label: string }>
          ).map((tab) => {
            const active = paneMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPaneMode(tab.id)}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide transition-colors ${
                  active
                    ? 'bg-[var(--bg-hover)] text-main ring-1 ring-[var(--solar-cyan)]/40'
                    : 'text-muted hover:text-main hover:bg-[var(--bg-hover)]/50'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {(!modesEnabled || paneMode === 'files') ? (
      <div
        className="shrink-0 flex items-center justify-around gap-0.5 px-1.5 py-1.5 border-b border-[var(--dashboard-border)]/60 bg-transparent"
        role="tablist"
        aria-label="File sources"
      >
        {AGENT_SAM_FS_SOURCES.map(({ id, title }) => {
          const active = activeSource === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={title}
              title={title}
              onClick={() => selectSource(id)}
              className={`flex items-center justify-center rounded-lg transition-all h-11 w-11 min-w-[44px] shrink-0 ${
                active
                  ? 'bg-[var(--bg-hover)] ring-1 ring-[var(--solar-cyan)]/45 shadow-sm'
                  : 'opacity-85 hover:opacity-100 hover:bg-[var(--bg-hover)]/60'
              }`}
            >
              <FsSourceIcon id={fsSourceIconId(id)} active={active} size={20} />
            </button>
          );
        })}
      </div>
      ) : null}

  </>
);
