import React from 'react';

export interface EmptyTelemetryCardProps {
  title: string;
  reason: string;
  dataSourceKey: string;
  suggestedAction?: string;
  status: 'not_connected_yet' | 'empty_capability' | 'config_only' | 'legacy_ignore' | 'unknown';
}

export const EmptyTelemetryCard: React.FC<EmptyTelemetryCardProps> = ({
  title,
  reason,
  dataSourceKey,
  suggestedAction,
  status,
}) => {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted">{dataSourceKey}</div>
          <div className="text-[var(--text)] font-semibold">{title}</div>
        </div>
        <div className="text-[11px] px-2 py-1 rounded border border-[var(--border-subtle)] text-muted bg-[var(--bg-canvas)]">
          {status}
        </div>
      </div>
      <div className="mt-2 text-muted leading-relaxed">{reason}</div>
      {suggestedAction ? (
        <div className="mt-2 text-[12px] text-[var(--text)]">
          <span className="text-muted">Suggested action:</span> {suggestedAction}
        </div>
      ) : null}
    </div>
  );
};

