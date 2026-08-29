import type { ReactNode } from "react";

export interface KpiStripData {
  api_calls: number;
  tokens_used: number;
  cost_usd: number;
  tool_calls: number;
  mcp_calls: number;
  deployments: number;
}

export interface ActivityData {
  weekly_activity: { deploys: number; tasks_completed: number; agent_calls: number };
  worked_this_week: { hours_this_week: number; hours_today: number };
  projects: { active: number; top: any[] };
}

export interface AgentActivity {
  sessions: number;
  llm_calls: number;
  top_model: string | null;
  total_cost_usd: number;
  events: Array<{ type: string; count: number; cost: number }>;
}

export interface WorkflowData {
  total: number;
  by_intent: Array<{ intent: string; count: number; success_rate: number }>;
  recent: any[];
}

export interface DeployData {
  deployments: any[];
  cicd_runs: any[];
}

export interface KpiDef {
  icon: ReactNode;
  label: string;
  value: string;
  trend: number;
  compare: string;
  spark: number[];
  color: string;
}

/** `/api/overview/dashboard-bundle` — D1-backed slices (see `src/api/overview-bundle.js`). */
export type DashboardBundleMeta = {
  warnings?: string[];
  dirty_sections?: Array<'deploy' | 'errors' | 'workflows' | 'plans'>;
  refresh_recommended?: boolean;
};
export type DashboardBundle = {
  ok?: boolean;
  kpis?: Record<string, number | null | undefined>;
  workflow_by_day_status?: Array<{ day: string; status: string; c: number }>;
  workflow_status_pie?: Array<{ status: string; c: number }>;
  workflow_stats?: Array<{
    status: string;
    workflow_key: string;
    cnt: number;
    cost_usd: number;
    tokens: number;
  }>;
  workflow_timeseries?: Array<{
    date: string;
    succeeded: number;
    failed: number;
    running: number;
  }>;
  top_services?: Array<{ tool_name: string; total_calls: number; success_rate?: number; avg_duration_ms?: number }>;
  tool_waterfall?: {
    run: {
      id?: string | null;
      workflow_key?: string | null;
      display_name?: string | null;
      duration_ms?: number | null;
      status?: string | null;
    } | null;
    steps: Array<{
      node_key: string;
      node_type: string;
      status: string;
      started_at: number | string;
      completed_at?: number | string | null;
      latency_ms?: number | null;
      tokens_in?: number | null;
      tokens_out?: number | null;
      cost_usd?: number | null;
      error_json?: string | null;
    }>;
  };
  error_inbox?: Array<{ error_type: string; error_message: string; source: string; resolved: number; created_at: number }>;
  error_log?: Array<{
    error_type: string;
    error_message: string;
    source: string;
    source_id?: string | null;
    resolved: number;
    created_at: number;
    severity: "high" | "medium" | "low";
  }>;
  /** 7d stacked severity counts (high / medium / low) for Error Inbox chart */
  error_severity_timeseries?: Array<{ date: string; high: number; medium: number; low: number }>;
  tokens_by_day?: Array<{ day: string; tin: number; tout: number }>;
  token_timeseries?: Array<{ date: string; input: number; output: number; cached: number }>;
  model_leaderboard?: Array<{
    model_key: string;
    provider: string;
    runs: number;
    success_pct: number;
    avg_latency_ms: number;
    total_cost_usd: number;
    total_tokens: number;
    decayed_score: number | null;
    score_overall: number | null;
    realized_per_1k?: number | null;
    list_in_per_1k?: number | null;
    list_out_per_1k?: number | null;
    routing_eligible?: number | null;
    requires_owner_approval?: number | null;
    is_paused?: number | null;
  }>;
  eval_scatter?: Array<{
    model_key: string;
    provider: string;
    cost_usd: number;
    latency_ms: number;
    score_overall?: number | null;
    passed: number;
    run_at?: string;
  }>;
  cost_latency?: Array<{
    model_key: string;
    provider: string;
    runs: number;
    latency_ms: number;
    cost_usd: number;
    quality: number;
    success_rate: number | null;
  }>;
  routing_arms?: Array<{
    model_key?: string;
    provider?: string;
    total_executions?: number;
    decayed_score?: number;
    is_eligible?: number;
    is_paused?: number;
    budget_exhausted?: number;
    success_alpha?: number;
    success_beta?: number;
    latency_mean?: number;
    cost_mean?: number;
  }>;
  routing_timeseries?: Array<{ date: string; primary: number; fallback: number }>;
  cron_latest?: Array<{ job_name: string; status: string; duration_ms: number; error_message?: string | null; started_at?: number }>;
  /** Newest-first run outcomes per job (length 7); cells: ok | fail | skip | warn | empty */
  cron_heatmap?: Array<{ job_name: string; runs: Array<"ok" | "fail" | "skip" | "warn" | "empty"> }>;
  github_push_events?: Array<{
    commit_message?: string | null;
    author_username?: string | null;
    branch?: string | null;
    received_at?: string | null;
    repo_full_name?: string | null;
  }>;
  deployment_stats?: {
    total: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    avg_ms: number;
  };
  deployment_timeseries?: Array<{ date: string; prod: number; staging: number }>;
  budget?: { spent_7d_usd?: number; plan_token_budget_sum?: number; plans_recorded_cost_usd?: number };
  active_plans?: Array<{
    id: string;
    title: string;
    status: string;
    tasks_total: number;
    tasks_done: number;
    tasks_blocked: number;
    plan_date?: string;
    cost_usd?: number;
  }>;
  _meta?: DashboardBundleMeta;
};

export type CostLatencyPoint = {
  x: number;
  y: number;
  model_key: string;
  runs: number;
  quality: number;
  success_rate: number | null;
};
