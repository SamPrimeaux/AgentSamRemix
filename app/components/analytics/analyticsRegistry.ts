/** Single-page analytics cockpit — tab sub-routes removed (Sprint 1). */
export const ANALYTICS_PAGE = {
  id: 'analytics',
  route: '/dashboard/analytics',
  label: 'Analytics',
  status: 'live' as const,
  dataSources: [
    'systemPulse',
    'executionPerf',
    'toolCalls',
    'errorLog',
    'modelLeaderboard',
    'mcpTools',
    'routingArms',
  ],
  sections: [
    { id: 'platform-pulse', label: 'Platform pulse' },
    { id: 'model-intelligence', label: 'Model intelligence' },
    { id: 'tool-reliability', label: 'Tool reliability' },
    { id: 'routing-intelligence', label: 'Routing intelligence' },
  ],
};

/** @deprecated Tab nav removed — kept empty so legacy imports do not break. */
export const ANALYTICS_TABS: [] = [];

export type AnalyticsTabId = typeof ANALYTICS_PAGE.id;
