import React from 'react';
import { CheckCircle2, AlertCircle, Link2, Loader2 } from 'lucide-react';
import type { ComposerTrustStatus } from './useComposerTrustStatus';

export type AgentComposerTrustStripProps = {
  status: ComposerTrustStatus;
  onApprovalClick?: () => void;
  className?: string;
};

const toneStyles = {
  green: 'border-emerald-500/25 bg-emerald-500/8 text-emerald-200/95',
  amber: 'border-amber-500/28 bg-amber-500/10 text-amber-100/95',
  grey: 'border-white/10 bg-white/[0.03] text-[var(--dashboard-muted)]',
  muted: 'border-white/8 bg-transparent text-[var(--dashboard-muted)]',
} as const;

export function AgentComposerTrustStrip({
  status,
  onApprovalClick,
  className = '',
}: AgentComposerTrustStripProps) {
  const Icon =
    status.loading ? Loader2 : status.tone === 'green' ? CheckCircle2 : status.tone === 'amber' ? AlertCircle : Link2;

  const inner = (
    <>
      <Icon
        size={13}
        className={`shrink-0 ${status.loading ? 'animate-spin opacity-70' : ''} ${
          status.tone === 'green' ? 'text-emerald-400' : status.tone === 'amber' ? 'text-amber-300' : ''
        }`}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-[0.6875rem] font-medium leading-snug">{status.line}</span>
      {status.detail ? (
        <span className="hidden sm:inline text-[0.625rem] text-[var(--dashboard-muted)] truncate max-w-[45%]">
          {status.detail}
        </span>
      ) : null}
    </>
  );

  const boxClass = `flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${toneStyles[status.tone]} ${className}`.trim();

  if (status.tone === 'amber' && onApprovalClick) {
    return (
      <button
        type="button"
        onClick={onApprovalClick}
        className={`w-full text-left hover:brightness-110 transition-all ${boxClass}`}
        title="Jump to approval card"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={boxClass} role="status" aria-live="polite">
      {inner}
    </div>
  );
}
