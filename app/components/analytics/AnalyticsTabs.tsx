import React, { useMemo } from 'react';
import type { AnalyticsLayoutResponse } from './types';
import { ANALYTICS_TABS } from './analyticsRegistry';

type Props = {
  activeTabId: string;
  layout: AnalyticsLayoutResponse | null;
  onTab: (tabId: string) => void;
};

export const AnalyticsTabs: React.FC<Props> = ({ activeTabId, layout, onTab }) => {
  const tabs = useMemo(() => {
    const cms = Array.isArray(layout?.tabs) && layout?.tabs.length ? layout.tabs : null;
    if (cms) {
      return cms
        .slice()
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map((t) => ({ id: t.id, label: t.label, status: t.status }));
    }
    return ANALYTICS_TABS.map((t) => ({ id: t.id, label: t.label, status: t.status }));
  }, [layout]);

  return (
    <div className="flex flex-wrap gap-1 px-1 pb-2 shrink-0 border-b border-[var(--border-subtle)]">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`ov-btn text-[12px] !py-1 !px-2 ${String(activeTabId) === String(t.id) ? 'ring-1 ring-[var(--accent-secondary)]' : ''}`}
          onClick={() => onTab(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
};

