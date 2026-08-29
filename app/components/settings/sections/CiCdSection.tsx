import React from 'react';
import { useSettingsSectionStatus } from '../hooks/useSettingsSectionStatus';
import {
  ActionRow,
  DataTable,
  EmptyState,
  LoadingRow,
  RelTime,
  SectionHeader,
  SummaryGrid,
  WarningStrip,
} from '../components/SectionPrimitives';

type ScriptRow = {
  id?: string;
  name?: string;
  language?: string;
  kind?: string;
  is_active?: number;
  last_run_at?: string | number | null;
  updated_at?: string | number | null;
};

type RunRow = {
  id?: string;
  script_id?: string;
  status?: string;
  exit_code?: number | null;
  started_at?: string | number | null;
  duration_ms?: number | null;
  triggered_by?: string;
};

type DeployRow = {
  environment?: string;
  status?: string;
  last_checked_at?: string | number | null;
  latency_ms?: number | null;
  error_rate_pct?: number | null;
  notes?: string;
};

type DashboardVersionRow = {
  version?: string;
  deployed_at?: string | number | null;
  git_sha?: string;
  environment?: string;
  deployed_by?: string;
};

type CicdSummary = {
  total_scripts?: number;
  active_scripts?: number;
  recent_runs?: number;
  recent_failures?: number;
  recent_successes?: number;
  latest_dashboard_version?: string | null;
  latest_deployed_at?: string | number | null;
};

type CicdExtra = {
  recent_runs?: RunRow[];
  cicd_pipeline_runs?: Array<{
    run_id?: string;
    env?: string;
    status?: string;
    branch?: string;
    commit_hash?: string;
    triggered_at?: string | number | null;
    completed_at?: string | number | null;
    notes?: string;
  }>;
  deployment_health?: DeployRow[];
  dashboard_versions?: DashboardVersionRow[];
};

export function CiCdSection() {
  const { data, loading, error, reload } = useSettingsSectionStatus<ScriptRow>({
    endpoint: '/api/settings/cicd',
  });

  const summary = (data?.summary || {}) as CicdSummary;
  const extra = (data?.extra || {}) as CicdExtra;

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <SectionHeader
        title="CI/CD"
        description="Scripts, pipeline runs, and deploy health from agentsam_scripts, agentsam_script_runs, cicd_pipeline_runs, agentsam_deployment_health, and dashboard_versions."
        right={
          <button
            type="button"
            onClick={() => reload()}
            disabled={loading}
            className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-muted hover:text-main disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {error ? (
        <div className="text-[11px] text-[var(--color-danger)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 rounded-xl px-3 py-2">
          {error}
        </div>
      ) : null}

      {loading && !data ? <LoadingRow /> : null}

      {data ? (
        <>
          <SummaryGrid
            items={[
              { label: 'Scripts', value: String(summary.total_scripts ?? 0) },
              { label: 'Active', value: String(summary.active_scripts ?? 0) },
              { label: 'Recent runs', value: String(summary.recent_runs ?? 0) },
              {
                label: 'Recent failures',
                value: String(summary.recent_failures ?? 0),
                hint:
                  Number(summary.recent_successes ?? 0) > 0
                    ? `${summary.recent_successes} ok`
                    : undefined,
              },
              {
                label: 'Latest version',
                value: summary.latest_dashboard_version || '—',
              },
              {
                label: 'Last deploy',
                value: summary.latest_deployed_at ? <RelTime value={summary.latest_deployed_at} /> : '—',
              },
            ]}
          />

          <WarningStrip warnings={data.warnings} />

          <ActionRow actions={data.actions} />

          <section className="flex flex-col gap-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted">
              Scripts
            </div>
            <DataTable<ScriptRow>
              emptyMessage="No scripts in agentsam_scripts."
              rows={(data.rows || []) as ScriptRow[]}
              columns={[
                { key: 'name', label: 'Name', widthClass: 'minmax(0, 1.5fr)' },
                { key: 'language', label: 'Language', widthClass: 'minmax(0, 0.6fr)' },
                { key: 'kind', label: 'Kind', widthClass: 'minmax(0, 0.6fr)' },
                {
                  key: 'is_active',
                  label: 'Active',
                  widthClass: 'minmax(0, 0.4fr)',
                  render: (row) => (Number(row.is_active) === 1 ? 'yes' : 'no'),
                },
                {
                  key: 'last_run_at',
                  label: 'Last run',
                  widthClass: 'minmax(0, 0.7fr)',
                  render: (row) => <RelTime value={row.last_run_at ?? null} />,
                },
              ]}
            />
          </section>

          <section className="flex flex-col gap-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted">
              Recent script runs
            </div>
            {(extra.recent_runs || []).length === 0 ? (
              <EmptyState message="No recent rows in agentsam_script_runs." />
            ) : (
              <DataTable<RunRow>
                emptyMessage="No runs."
                rows={extra.recent_runs || []}
                columns={[
                  {
                    key: 'started_at',
                    label: 'Started',
                    widthClass: 'minmax(0, 0.8fr)',
                    render: (row) => <RelTime value={row.started_at ?? null} />,
                  },
                  { key: 'script_id', label: 'Script', widthClass: 'minmax(0, 1fr)' },
                  {
                    key: 'status',
                    label: 'Status',
                    widthClass: 'minmax(0, 0.6fr)',
                    render: (row) => String(row.status || '—'),
                  },
                  {
                    key: 'exit_code',
                    label: 'Exit',
                    widthClass: 'minmax(0, 0.4fr)',
                    render: (row) => (row.exit_code == null ? '—' : String(row.exit_code)),
                  },
                  {
                    key: 'duration_ms',
                    label: 'Duration',
                    widthClass: 'minmax(0, 0.6fr)',
                    render: (row) => (row.duration_ms != null ? `${row.duration_ms}ms` : '—'),
                  },
                  {
                    key: 'triggered_by',
                    label: 'By',
                    widthClass: 'minmax(0, 0.6fr)',
                  },
                ]}
              />
            )}
          </section>

          <section className="flex flex-col gap-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted">
              Pipeline runs (cicd_pipeline_runs)
            </div>
            {(extra.cicd_pipeline_runs || []).length === 0 ? (
              <EmptyState message="No pipeline rows yet." />
            ) : (
              <DataTable
                emptyMessage="No runs."
                rows={extra.cicd_pipeline_runs || []}
                columns={[
                  {
                    key: 'completed_at',
                    label: 'When',
                    widthClass: 'minmax(0, 0.8fr)',
                    render: (row) => (
                      <RelTime value={(row as { completed_at?: unknown; triggered_at?: unknown }).completed_at as string | number | null ?? (row as { triggered_at?: unknown }).triggered_at as string | number | null} />
                    ),
                  },
                  { key: 'env', label: 'Env', widthClass: 'minmax(0, 0.5fr)' },
                  { key: 'status', label: 'Status', widthClass: 'minmax(0, 0.6fr)' },
                  { key: 'branch', label: 'Branch', widthClass: 'minmax(0, 0.6fr)' },
                  { key: 'commit_hash', label: 'Commit', widthClass: 'minmax(0, 1fr)' },
                ]}
              />
            )}
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted">
                Deployment health
              </div>
              {(extra.deployment_health || []).length === 0 ? (
                <EmptyState message="No agentsam_deployment_health rows." />
              ) : (
                <DataTable<DeployRow>
                  emptyMessage="No health checks."
                  rows={extra.deployment_health || []}
                  columns={[
                    { key: 'environment', label: 'Env' },
                    { key: 'status', label: 'Status' },
                    {
                      key: 'last_checked_at',
                      label: 'Checked',
                      render: (row) => <RelTime value={row.last_checked_at ?? null} />,
                    },
                    {
                      key: 'latency_ms',
                      label: 'Latency',
                      render: (row) => (row.latency_ms != null ? `${row.latency_ms}ms` : '—'),
                    },
                  ]}
                />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted">
                Dashboard versions
              </div>
              {(extra.dashboard_versions || []).length === 0 ? (
                <EmptyState message="No rows in dashboard_versions." />
              ) : (
                <DataTable<DashboardVersionRow>
                  emptyMessage="No deploys."
                  rows={extra.dashboard_versions || []}
                  columns={[
                    { key: 'version', label: 'Version' },
                    {
                      key: 'deployed_at',
                      label: 'Deployed',
                      render: (row) => <RelTime value={row.deployed_at ?? null} />,
                    },
                    { key: 'git_sha', label: 'SHA' },
                    { key: 'deployed_by', label: 'By' },
                  ]}
                />
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
