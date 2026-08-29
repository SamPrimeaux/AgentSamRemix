import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ActiveFile } from '../../../types';
import { SetiFileIcon } from '../../../src/components/SetiFileIcon';
import { DiffViewer } from './DiffViewer';
import {
  collectDiffArtifactsFromMessages,
  computeDiffLineStats,
  shortPathLabel,
  type ChatDiffEntry,
} from '../lib/collectChatDiffArtifacts';
import type { Message } from '../types';

type Props = {
  messages: Message[];
  onOpenInEditor?: (file: ActiveFile) => void;
  initialExpandedId?: string | null;
};

function DiffFileRow({
  entry,
  expanded,
  onToggle,
  onOpenInEditor,
}: {
  entry: ChatDiffEntry;
  expanded: boolean;
  onToggle: () => void;
  onOpenInEditor?: (file: ActiveFile) => void;
}) {
  const stats = computeDiffLineStats(entry.before, entry.after);
  const fileName = entry.path.split('/').pop() || entry.path;

  return (
    <div className="rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--bg-hover)]/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown size={14} className="shrink-0 text-[var(--dashboard-muted)]" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-[var(--dashboard-muted)]" />
        )}
        <SetiFileIcon filename={entry.path} size={14} className="shrink-0" />
        <span className="flex-1 min-w-0 truncate text-[12px] text-[var(--dashboard-text)] font-mono">
          {shortPathLabel(entry.path, 36)}
        </span>
        <span className="flex items-center gap-1 shrink-0 text-[11px] font-mono">
          {stats.isNew ? (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-400">
              New
            </span>
          ) : (
            <>
              {stats.added > 0 ? <span className="text-emerald-400/90">+{stats.added}</span> : null}
              {stats.removed > 0 ? <span className="text-red-400/90">−{stats.removed}</span> : null}
            </>
          )}
        </span>
      </button>
      {expanded ? (
        <div className="border-t border-[var(--dashboard-border)]/60 bg-black/40">
          <div className="px-2 py-1 flex items-center justify-between gap-2 border-b border-[var(--dashboard-border)]/40">
            <span className="text-[10px] text-[var(--dashboard-muted)] font-mono truncate" title={entry.path}>
              {entry.path}
            </span>
            {onOpenInEditor ? (
              <button
                type="button"
                className="text-[10px] text-[var(--solar-cyan)] hover:underline shrink-0"
                onClick={() =>
                  onOpenInEditor({
                    name: fileName,
                    content: entry.after,
                    originalContent: entry.before,
                  })
                }
              >
                Open
              </button>
            ) : null}
          </div>
          <div className="max-h-[min(52vh,420px)] overflow-hidden">
            <DiffViewer
              before={entry.before}
              after={entry.after}
              language={entry.language}
              path={entry.path}
              compact={false}
              mobileInline
              heightPx={320}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const AgentMobileDiffPanel: React.FC<Props> = ({
  messages,
  onOpenInEditor,
  initialExpandedId = null,
}) => {
  const entries = useMemo(() => collectDiffArtifactsFromMessages(messages), [messages]);
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId);

  useEffect(() => {
    if (initialExpandedId) setExpandedId(initialExpandedId);
  }, [initialExpandedId]);

  if (!entries.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <p className="text-[13px] text-[var(--dashboard-muted)]">No file diffs in this chat yet.</p>
        <p className="text-[11px] text-[var(--dashboard-muted)]/80">
          When Agent Sam edits files, they appear here with syntax-highlighted diffs.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-3 overflow-y-auto chat-hide-scroll min-h-0 flex-1">
      <p className="text-[11px] text-[var(--dashboard-muted)] px-1 pb-1">
        {entries.length} file{entries.length === 1 ? '' : 's'} — tap to expand diff
      </p>
      {entries.map((entry) => (
        <DiffFileRow
          key={entry.id}
          entry={entry}
          expanded={expandedId === entry.id}
          onToggle={() => setExpandedId((prev) => (prev === entry.id ? null : entry.id))}
          onOpenInEditor={onOpenInEditor}
        />
      ))}
    </div>
  );
};

export default AgentMobileDiffPanel;
