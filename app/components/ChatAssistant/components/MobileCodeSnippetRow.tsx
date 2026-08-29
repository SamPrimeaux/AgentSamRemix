import React from 'react';
import { ChevronRight } from 'lucide-react';
import { SetiFileIcon } from '../../../src/components/SetiFileIcon';

type Props = {
  fileName: string;
  lang: string;
  lineCount: number;
  code: string;
  isShell?: boolean;
  onOpenMonaco?: () => void;
  onRunInTerminal?: () => void;
};

export function MobileCodeSnippetRow({
  fileName,
  lang,
  lineCount,
  isShell = false,
  onOpenMonaco,
  onRunInTerminal,
}: Props) {
  return (
    <div className="my-1.5 flex items-center gap-2 rounded-xl border border-[var(--dashboard-border)] bg-[var(--scene-bg)] px-3 py-2.5 max-w-full min-w-0">
      <button
        type="button"
        onClick={onOpenMonaco}
        className="flex flex-1 min-w-0 items-center gap-2 text-left hover:opacity-90 transition-opacity"
      >
        <SetiFileIcon filename={fileName} size={14} className="shrink-0" />
        <span className="flex-1 min-w-0 truncate text-[12px] text-[var(--dashboard-text)]">
          {lang} · {lineCount} line{lineCount === 1 ? '' : 's'}
        </span>
        <ChevronRight size={14} className="shrink-0 text-[var(--dashboard-muted)]" />
      </button>
      {isShell && onRunInTerminal ? (
        <button
          type="button"
          onClick={onRunInTerminal}
          className="shrink-0 px-2 py-1 rounded-md text-[10px] font-semibold text-[var(--solar-green)] border border-[var(--solar-green)]/30 hover:bg-[var(--solar-green)]/10"
        >
          Run
        </button>
      ) : null}
    </div>
  );
}
