import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { SetiFileIcon } from '../../../src/components/SetiFileIcon';
import {
  computeDiffLineStats,
  shortPathLabel,
  type ChatDiffEntry,
} from '../lib/collectChatDiffArtifacts';

type Props = {
  entries: ChatDiffEntry[];
  onOpenDiffTab?: () => void;
  onOpenDiffFile?: (entryId: string) => void;
  compact?: boolean;
};

export const AgentMobileFilesChangedEnvelope: React.FC<Props> = ({
  entries,
  onOpenDiffTab,
  onOpenDiffFile,
  compact = false,
}) => {
  const [open, setOpen] = useState(false);
  if (!entries.length) return null;

  const count = entries.length;
  const label = `${count} File${count === 1 ? '' : 's'} Changed`;

  return (
    <div className="my-2 rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 min-w-0 items-center gap-2 text-left hover:opacity-90 transition-opacity"
        >
          {open ? (
            <ChevronDown size={14} className="shrink-0 text-[var(--dashboard-muted)]" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-[var(--dashboard-muted)]" />
          )}
          <span className="text-[13px] font-medium text-[var(--dashboard-text)]">{label}</span>
        </button>
        {onOpenDiffTab ? (
          <button
            type="button"
            onClick={() => onOpenDiffTab()}
            className="text-[11px] font-medium text-[var(--solar-cyan)] hover:underline shrink-0"
          >
            Context
          </button>
        ) : null}
      </div>
      {open ? (
        <ul className={`border-t border-[var(--dashboard-border)]/60 ${compact ? 'max-h-[160px]' : 'max-h-[220px]'} overflow-y-auto chat-hide-scroll`}>
          {entries.map((entry) => {
            const stats = computeDiffLineStats(entry.before, entry.after);
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (onOpenDiffFile) {
                      onOpenDiffFile(entry.id);
                    } else {
                      onOpenDiffTab?.();
                    }
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 border-b border-[var(--dashboard-border)]/30 last:border-0 text-left hover:bg-[var(--bg-hover)]/30 transition-colors"
                >
                  <SetiFileIcon filename={entry.path} size={14} className="shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-[12px] text-[var(--dashboard-text)] font-mono">
                    {shortPathLabel(entry.path)}
                  </span>
                  <span className="flex items-center gap-1 shrink-0 text-[11px] font-mono">
                    {stats.isNew ? (
                      <span className="text-emerald-400/90">New</span>
                    ) : (
                      <>
                        {stats.added > 0 ? (
                          <span className="text-emerald-400/90">+{stats.added}</span>
                        ) : null}
                        {stats.removed > 0 ? (
                          <span className="text-red-400/90">−{stats.removed}</span>
                        ) : null}
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};

export default AgentMobileFilesChangedEnvelope;
