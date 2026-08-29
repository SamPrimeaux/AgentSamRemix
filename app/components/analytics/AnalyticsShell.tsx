import React from 'react';
import type { AnalyticsLayoutResponse } from './types';
import { AnalyticsHeader } from './AnalyticsHeader';
import { AnalyticsTabs } from './AnalyticsTabs';

type Props = {
  tabId: string;
  layout: AnalyticsLayoutResponse | null;
  layoutLoadedAt: number;
  onTab: (tabId: string) => void;
  children: React.ReactNode;
};

export const AnalyticsShell: React.FC<Props> = ({ tabId, layout, layoutLoadedAt, onTab, children }) => {
  return (
    <div className="ov-wrap flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden w-full">
      <AnalyticsHeader layout={layout} layoutLoadedAt={layoutLoadedAt} />
      <AnalyticsTabs activeTabId={tabId} layout={layout} onTab={onTab} />
      <div className="flex-1 min-h-0 overflow-auto p-3">{children}</div>
    </div>
  );
};

