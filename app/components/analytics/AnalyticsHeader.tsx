import React from 'react';
import type { AnalyticsLayoutResponse } from './types';

type Props = {
  layout: AnalyticsLayoutResponse | null;
  layoutLoadedAt: number;
};

export const AnalyticsHeader: React.FC<Props> = ({ layout, layoutLoadedAt }) => {
  const title = layout?.page?.title || 'Analytics';
  const subtitle = 'Telemetry, cost, and platform observability';
  const updated =
    layoutLoadedAt > 0
      ? new Date(layoutLoadedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : null;

  return (
    <header className="ov-header shrink-0">
      <div className="ov-title">
        <div className="text-[11px] uppercase tracking-wide text-muted">Analytics cockpit</div>
        <h1 className="ov-h1">{title}</h1>
        <p className="ov-sub">{subtitle}</p>
      </div>
      <div className="ov-actions">
        {updated ? <div className="text-[11px] text-muted">Layout updated {updated}</div> : null}
      </div>
    </header>
  );
};

