/** Minimal PulseResponse slice for portable adapters (production GET /api/analytics/overview). */

export type PortableKpiMetric = {
  value: Record<string, unknown> | number | string | null;
  sourceTables?: string[];
  isLive?: boolean;
  warning?: string | null;
};

export type PulsePortableInput = {
  ok?: boolean;
  range?: string;
  summary?: Record<string, unknown>;
  kpis?: Record<string, PortableKpiMetric>;
  workflowRunsOverTime?: Array<{ day?: string; status?: string; c?: number }>;
  modelLeaderboard?: Array<Record<string, unknown>>;
  tokensOverTime?: Array<{ day?: string; tin?: number; tout?: number }>;
};

export type PortableKpiItem = { label: string; value: string; hint?: string };

export type ActivityChartPoint = { day: string; runs: number };
