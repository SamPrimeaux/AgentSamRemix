import React from 'react';
import { ChatPresenceIcon } from '../../../features/mode-presence/ChatPresenceIcon';
import type { CadJobPhase } from './cadJobPhase';

export type InlineJobProgressProps = {
  phase: CadJobPhase;
  /** Smaller icon + text for status bar embeds */
  compact?: boolean;
  className?: string;
};

export function InlineJobProgress({ phase, compact = false, className = '' }: InlineJobProgressProps) {
  const isActive = phase.status === 'creating' || phase.status === 'uploading';
  const cardStatus =
    phase.status === 'failed'
      ? 'error'
      : phase.status === 'complete'
        ? 'done'
        : isActive
          ? 'working'
          : undefined;

  const iconPx = compact ? 28 : 44;

  return (
    <div
      className={`inline-job-progress inline-job-progress--${phase.status}${compact ? ' inline-job-progress--compact' : ''} ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-label={`${phase.label} ${phase.progress}%`}
    >
      <div className="inline-job-progress__stage">
        <ChatPresenceIcon
          iconKey={phase.iconKey}
          size={iconPx}
          cardStatus={cardStatus}
          className="inline-job-progress__icon shrink-0"
        />
        <div className="inline-job-progress__copy">
          <p className="inline-job-progress__label">
            {phase.label}
            {isActive && !phase.indeterminate ? (
              <>
                … <span className="inline-job-progress__pct">{phase.progress}%</span>
              </>
            ) : isActive && phase.indeterminate ? (
              <>…</>
            ) : null}
          </p>
          {phase.detail ? <p className="inline-job-progress__detail">{phase.detail}</p> : null}
        </div>
      </div>
      {isActive ? (
        <div
          className={`inline-job-progress__track${phase.indeterminate ? ' inline-job-progress__track--indeterminate' : ''}`}
          aria-hidden="true"
        >
          <div
            className={`inline-job-progress__fill${phase.indeterminate ? ' inline-job-progress__fill--indeterminate' : ''}`}
            style={phase.indeterminate ? undefined : { width: `${phase.progress}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
