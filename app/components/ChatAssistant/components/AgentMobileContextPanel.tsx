import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, GitBranch, Loader2 } from 'lucide-react';
import type { ActiveFile } from '../../../types';
import { SetiFileIcon } from '../../../src/components/SetiFileIcon';
import { AppIcon } from '../../ui/AppIcon';
import { DiffViewer } from './DiffViewer';
import {
  collectDiffArtifactsFromMessages,
  computeDiffLineStats,
  shortPathLabel,
  type ChatDiffEntry,
} from '../lib/collectChatDiffArtifacts';
import type { Message } from '../types';

export type RuntimeCheckRow = {
  id: string;
  ok: boolean;
  label: string;
  providerKey?: string;
  iconSlug?: string;
};

type Props = {
  messages: Message[];
  githubRepoContext: string | null;
  runtimeChecks: RuntimeCheckRow[];
  runtimeChecksLoading: boolean;
  onRefreshRuntime: () => void;
  onChooseRepo: () => void;
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

function runtimeIconForRow(row: RuntimeCheckRow) {
  if (row.providerKey || row.iconSlug) {
    return (
      <AppIcon
        title={row.label}
        providerKey={row.providerKey}
        iconSlug={row.iconSlug}
        size="sm"
        status={row.ok ? 'ok' : 'error'}
      />
    );
  }
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[10px] font-bold ${
        row.ok
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
      }`}
    >
      {row.label.slice(0, 2).toUpperCase()}
    </span>
  );
}

export const AgentMobileContextPanel: React.FC<Props> = ({
  messages,
  githubRepoContext,
  runtimeChecks,
  runtimeChecksLoading,
  onRefreshRuntime,
  onChooseRepo,
  onOpenInEditor,
  initialExpandedId = null,
}) => {
  const entries = useMemo(() => collectDiffArtifactsFromMessages(messages), [messages]);
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId);

  useEffect(() => {
    if (initialExpandedId) setExpandedId(initialExpandedId);
  }, [initialExpandedId]);

  useEffect(() => {
    onRefreshRuntime();
  }, [onRefreshRuntime]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto chat-hide-scroll px-4 py-4 space-y-4">
      <section className="rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] p-4 space-y-3">
        <h3 className="text-[12px] font-semibold text-[var(--text-heading)] uppercase tracking-wide">
          Files produced
        </h3>
        {!entries.length ? (
          <p className="text-[12px] text-[var(--dashboard-muted)]">
            When Agent Sam edits or creates files, they appear here with diffs.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-[var(--dashboard-muted)]">
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
        )}
      </section>

      <section className="rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[12px] font-semibold text-[var(--text-heading)] uppercase tracking-wide">
            Runtime
          </h3>
          <button
            type="button"
            onClick={onRefreshRuntime}
            disabled={runtimeChecksLoading}
            className="text-[11px] text-[var(--solar-cyan)] hover:underline disabled:opacity-50"
          >
            {runtimeChecksLoading ? 'Checking…' : 'Recheck'}
          </button>
        </div>
        <ul className="space-y-2">
          {runtimeChecks.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 border border-[var(--dashboard-border)] rounded-lg px-2.5 py-2"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                {runtimeIconForRow(row)}
                <span className="text-[12px] text-[var(--dashboard-text)] truncate">{row.label}</span>
              </span>
              <span className={`shrink-0 text-[11px] font-medium ${row.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                {row.ok ? 'OK' : 'Fail'}
              </span>
            </li>
          ))}
          {!runtimeChecks.length && !runtimeChecksLoading ? (
            <li className="text-[12px] text-[var(--dashboard-muted)]">Tap Recheck to probe integrations.</li>
          ) : null}
          {runtimeChecksLoading && !runtimeChecks.length ? (
            <li className="flex items-center gap-2 text-[12px] text-[var(--dashboard-muted)]">
              <Loader2 size={14} className="animate-spin" />
              Checking…
            </li>
          ) : null}
        </ul>
      </section>

      <section className="rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] p-4 space-y-3">
        <h3 className="text-[12px] font-semibold text-[var(--text-heading)] uppercase tracking-wide">GitHub</h3>
        <p className="text-[12px] text-[var(--dashboard-muted)]">
          {githubRepoContext?.trim()
            ? `Selected repo: ${githubRepoContext}`
            : 'Pick a repository for this chat.'}
        </p>
        <button
          type="button"
          onClick={onChooseRepo}
          className="w-full py-2.5 rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] text-[13px] font-medium text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)] flex items-center justify-center gap-2"
        >
          <GitBranch size={16} className="text-[var(--solar-cyan)]" />
          Choose repository for this chat
        </button>
        <button
          type="button"
          onClick={() => window.open('https://github.com/new', '_blank', 'noopener,noreferrer')}
          className="w-full py-2.5 rounded-lg border border-[var(--dashboard-border)] text-[13px] font-medium text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] hover:bg-[var(--bg-hover)] flex items-center justify-center gap-2"
        >
          <ExternalLink size={16} />
          Create new repo on GitHub
        </button>
      </section>
    </div>
  );
};

export default AgentMobileContextPanel;
