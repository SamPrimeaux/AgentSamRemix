/** Deep links from Overview System Pulse panels (1–2 clicks to live analytics). */

export const OVERVIEW_LINKS = {
  workflowRuns: "/dashboard/analytics/agent",
  workflowRun: (runId: string) =>
    `/dashboard/analytics/agent?run_id=${encodeURIComponent(runId)}`,
  errors: "/dashboard/analytics/advisors",
  errorsSource: (source: string) =>
    `/dashboard/analytics/advisors?source=${encodeURIComponent(source)}`,
  tokens: "/dashboard/analytics/costs",
  mcpTools: "/dashboard/analytics/mcp",
} as const;

export function go(href: string) {
  if (typeof window !== "undefined") window.location.assign(href);
}
