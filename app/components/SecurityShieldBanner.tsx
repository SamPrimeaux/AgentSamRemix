import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, X } from 'lucide-react';

interface SecurityShieldBannerProps {
  message: string;
  detailsUrl: string;
  openFindingsCount?: number;
  auditEvents24h?: number;
  onDismiss?: () => void;
}

export function SecurityShieldBanner({
  message,
  detailsUrl,
  openFindingsCount = 0,
  auditEvents24h = 0,
  onDismiss,
}: SecurityShieldBannerProps) {
  return (
    <div
      className="shrink-0 flex items-center justify-between gap-3 px-3 py-2 border-b border-[var(--solar-yellow)]/30 bg-[var(--solar-yellow)]/10 text-main"
      role="status"
    >
      <div className="flex items-center gap-2 min-w-0 text-[12px]">
        <ShieldAlert size={16} className="text-[var(--solar-yellow)] shrink-0" />
        <span className="font-medium truncate">{message}</span>
        <span className="hidden sm:inline text-muted font-mono text-[10px] shrink-0">
          {openFindingsCount > 0 && `${openFindingsCount} open`}
          {openFindingsCount > 0 && auditEvents24h > 0 && ' · '}
          {auditEvents24h > 0 && `${auditEvents24h} audit (24h)`}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          to={detailsUrl}
          className="text-[11px] font-mono text-[var(--solar-cyan)] hover:underline whitespace-nowrap"
        >
          View findings
        </Link>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-muted"
            aria-label="Dismiss security banner"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
