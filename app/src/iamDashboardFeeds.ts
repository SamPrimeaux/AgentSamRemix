import type { AgentSessionRow } from '../agentSessionsCatalog';

export type { AgentSessionRow };

export type OverviewStatsPayload = {
  success?: boolean;
  db_health?: string;
  finance_transactions_count?: number;
  spend_ledger_entries?: number;
  active_clients?: number;
  agent_conversations?: number;
  agent_last_activity?: string | null;
  latest_migration?: { name?: string; applied_at?: string | null } | null;
  financial_health?: { total_in_all_time?: number; total_out_all_time?: number };
  infrastructure_spend_by_provider?: { provider: string; total: number }[];
};

export type RecentActivityItem = { at?: string; text?: string; type?: string };
export type RecentActivityPayload = { items: RecentActivityItem[]; filter_hours?: number };

export type DeploymentsPayload = {
  deployments?: Array<{
    worker_name?: string;
    environment?: string;
    status?: string;
    deployed_at?: string;
    deployment_notes?: string;
  }>;
  cicd_runs?: Array<{
    run_id?: string;
    workflow_name?: string;
    branch?: string;
    status?: string;
    conclusion?: string;
    started_at?: string;
    completed_at?: string;
  }>;
  error?: string;
};

export type AgentsamSkillRow = {
  id: string;
  name?: string;
  description?: string;
  is_active?: number;
};

export type TodayTodoPayload = { markdown?: string; ok?: boolean; error?: string };

export type AgentProblemsPayload = {
  checked_at?: string;
  agentsam_error_log?: unknown[];
  error?: string;
};

export type AgentGitStatusPayload = {
  branch?: string;
  git_hash?: string | null;
  worker_name?: string;
  repo_full_name?: string | null;
  sync_last_at?: string | null;
  error?: string;
};

export type AgentRulesPayload = { rules?: unknown[] };

export type AgentNotificationsPayload = { notifications?: Array<{ id?: string; subject?: string; message?: string; status?: string; created_at?: string }>; error?: string };

export type JsonFetchResult<T> = { ok: boolean; status: number; body: T | null };

export async function getJson<T>(url: string, init?: RequestInit): Promise<JsonFetchResult<T>> {
  try {
    const r = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      ...init,
    });
    const body = (await r.json().catch(() => null)) as T | null;
    return { ok: r.ok, status: r.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

export type WelcomeOverviewBundle = {
  stats: JsonFetchResult<OverviewStatsPayload>;
  recent: JsonFetchResult<RecentActivityPayload>;
  deployments: JsonFetchResult<DeploymentsPayload>;
  sessions: JsonFetchResult<AgentSessionRow[]>;
  skills: JsonFetchResult<AgentsamSkillRow[]>;
};

export async function loadWelcomeOverviewFeeds(): Promise<WelcomeOverviewBundle> {
  const [stats, recent, deployments, sessions, skills] = await Promise.all([
    getJson<OverviewStatsPayload>('/api/overview/stats'),
    getJson<RecentActivityPayload>('/api/overview/recent-activity?hours=48'),
    getJson<DeploymentsPayload>('/api/overview/deployments'),
    getJson<AgentSessionRow[]>('/api/agent/sessions'),
    getJson<AgentsamSkillRow[]>('/api/agentsam/skills'),
  ]);
  return { stats, recent, deployments, sessions, skills };
}

export type StudioIamBundle = {
  todayTodo: JsonFetchResult<TodayTodoPayload>;
  problems: JsonFetchResult<AgentProblemsPayload>;
  gitStatus: JsonFetchResult<AgentGitStatusPayload>;
  rules: JsonFetchResult<AgentRulesPayload>;
  notifications: JsonFetchResult<AgentNotificationsPayload>;
};

export async function loadStudioIamFeeds(): Promise<StudioIamBundle> {
  const [todayTodo, problems, gitStatus, rules, notifications] = await Promise.all([
    getJson<TodayTodoPayload>('/api/agent/today-todo'),
    getJson<AgentProblemsPayload>('/api/agent/problems'),
    getJson<AgentGitStatusPayload>('/api/agent/git/status'),
    getJson<AgentRulesPayload>('/api/agent/rules'),
    getJson<AgentNotificationsPayload>('/api/agent/notifications'),
  ]);
  return { todayTodo, problems, gitStatus, rules, notifications };
}

export function truncateOneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t || '';
  return `${t.slice(0, max - 1)}…`;
}

export function firstLinesOfMarkdown(markdown: string, lines: number, maxChars: number): string {
  const raw = markdown.trim();
  if (!raw) return '';
  const parts = raw.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, lines);
  return truncateOneLine(parts.join(' · '), maxChars);
}

export function problemTotal(problems: AgentProblemsPayload | null): number {
  if (!problems) return 0;
  return Array.isArray(problems.agentsam_error_log) ? problems.agentsam_error_log.length : 0;
}
