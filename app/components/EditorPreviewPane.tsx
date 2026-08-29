/**
 * In-editor file preview — srcDoc or localhost dev-server iframe. Never MYBROWSER.
 */
import React from 'react';
import { X, Loader2, RefreshCw } from 'lucide-react';
import { SetiFileIcon } from '../src/components/SetiFileIcon';
import { EDITOR_HTML_PREVIEW_SANDBOX } from '../lib/buildPreviewSrcDoc';

export type EditorPreviewPaneProps = {
  fileName: string;
  mode: 'srcdoc' | 'devserver';
  srcDoc?: string | null;
  url?: string | null;
  loading?: boolean;
  statusMessage?: string | null;
  onClose: () => void;
  onRefresh?: () => void;
};

export function EditorPreviewPane({
  fileName,
  mode,
  srcDoc,
  url,
  loading = false,
  statusMessage,
  onClose,
  onRefresh,
}: EditorPreviewPaneProps) {
  const title = fileName.trim() || 'Preview';

  return (
    <div className="flex flex-col h-full min-w-0 min-h-0 border-l border-[var(--dashboard-border)] bg-[var(--dashboard-canvas)]">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 shrink-0 border-b border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]">
        <div className="flex items-center gap-2 min-w-0">
          <SetiFileIcon filename={fileName} size={14} className="shrink-0" />
          <span className="truncate text-[11px] font-medium text-[var(--dashboard-text)]">
            Preview · {title}
          </span>
          {mode === 'devserver' && url ? (
            <span className="truncate text-[10px] font-mono text-[var(--dashboard-muted)]">{url}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="p-1 rounded text-muted hover:text-[var(--solar-cyan)] hover:bg-[var(--bg-hover)]"
              title="Refresh preview"
            >
              <RefreshCw size={14} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-muted hover:text-main hover:bg-[var(--bg-hover)]"
            title="Close preview"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {statusMessage ? (
        <div className="shrink-0 px-2 py-1 text-[10px] text-[var(--dashboard-muted)] border-b border-[var(--dashboard-border)]">
          {statusMessage}
        </div>
      ) : null}

      <div className="relative flex-1 min-h-0 min-w-0">
        {loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted text-xs">
            <Loader2 size={20} className="animate-spin text-[var(--solar-cyan)]" />
            <span>Starting dev server…</span>
          </div>
        ) : mode === 'srcdoc' && srcDoc ? (
          <iframe
            title={`Preview ${title}`}
            srcDoc={srcDoc}
            sandbox={EDITOR_HTML_PREVIEW_SANDBOX}
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full border-0 bg-white"
          />
        ) : mode === 'devserver' && url ? (
          <iframe
            title={`Dev server ${title}`}
            src={url}
            className="absolute inset-0 w-full h-full border-0 bg-white"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted px-4 text-center">
            No preview available. Open a local workspace and run a dev server from the terminal.
          </div>
        )}
      </div>
    </div>
  );
}
