export type AnalyticsRange = '24h' | '7d' | '30d' | 'all';

export type LayoutWarning = {
  code: string;
  message: string;
  severity: 'info' | 'warn' | 'critical';
};

export type AnalyticsLayoutResponse = {
  ok: boolean;
  page: {
    id: string;
    title: string;
    routePath: string;
    defaultTab: string;
    config: Record<string, unknown>;
  };
  tabs: Array<{
    id: string;
    label: string;
    status: 'live' | 'beta' | 'coming_soon';
    description?: string;
    dataSources: string[];
    sortOrder: number;
  }>;
  widgetsByTab: Record<
    string,
    Array<{
      id: string;
      type: string;
      dataSourceKey?: string;
      chartType?: string;
      title?: string;
      gridColSpan?: number;
      config: Record<string, unknown>;
      sortOrder: number;
    }>
  >;
  warnings: LayoutWarning[];
};

