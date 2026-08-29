import React, { useMemo, useState } from 'react';
import { ExternalLink, GitBranch } from 'lucide-react';
import type { GitRepo } from '../types';
import { StatusDot } from '../settingsUi';
import { useSettingsSectionStatus } from '../hooks/useSettingsSectionStatus';
import {
  ActionRow,
  DataTable,
  EmptyState,
  LoadingRow,
  ProviderCard,
  RelTime,
  SectionHeader,
  SummaryGrid,
  WarningStrip,
} from '../components/SectionPrimitives';

export type GitHubSectionProps = {
  repos: GitRepo[];
  workspaceId?: string | null;
};

type ConnectionRow = {
  id?: string;
  provider_key?: string;
  status?: string;
  account_label?: string | null;
  resource_label?: string | null;
  last_synced_at?: string | number | null;
  updated_at?: string | number | null;
};

type IndexJobRow = {
  id?: string;
  repo_full_name?: string;
  status?: string;
  started_at?: string | number | null;
  finished_at?: string | number | null;
  indexed_files?: number;
  indexed_file_count?: number;
};

type AuditRow = {
  id?: string;
  provider_key?: string;
  event_type?: string;
  severity?: string;
  created_at?: string | number | null;
};

type GithubSummary = {
  connection_status?: string;
  connection_count?: number;
  oauth_token_count?: number;
  latest_index_job_status?: string | null;
  latest_index_job_at?: string | number | null;
};

type GithubExtra = {
  oauth_tokens?: Array<{
    provider?: string;
    account_label?: string | null;
    scope?: string | null;
    updated_at?: string | number | null;
    expires_at?: string | number | null;
  }>;
  code_index_jobs?: IndexJobRow[];
  audit_log?: AuditRow[];
};

function repoInitials(fullName: string): string {
  const name = String(fullName || '').split('/').pop() || fullName || '?';
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, '');
  if (cleaned.length >= 2) return cleaned.slice(0, 2).toUpperCase();
  return (name.slice(0, 2) || '?').toUpperCase();
}

export function GitHubSection({ repos, workspaceId }: GitHubSectionProps) {
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [reindexBusy, setReindexBusy] = useState(false);
  const [reindexMsg, setReindexMsg] = useState<string | null>(null);
  const { data: section, loading, error, reload } = useSettingsSectionStatus<ConnectionRow>({
    endpoint: '/api/settings/github',
    workspaceId,
  });
  const summary = (section?.summary || {}) as GithubSummary;
  const extra = (section?.extra || {}) as GithubExtra;
  const provider = section?.providers?.[0];

  const selected = useMemo(
    () => repos.find((r) => r.repo_full_name === selectedRepo) || null,
    [repos, selectedRepo],
  );

  const onAction = (key: string) => {
    if (key === 'connect_github') {
      window.location.href = '/api/integrations/github/connect';
      return;
    }
    if (key === 'reindex_codebase') {
      void triggerReindex();
    }
  };

  const triggerReindex = async () => {
    const repo = selected?.repo_full_name || selectedRepo;
    if (!repo) {
      setReindexMsg('Select a repository card first.');
      return;
    }
    const ws = workspaceId?.trim();
    if (!ws) {
      setReindexMsg('workspace_id required — open Settings from an active workspace.');
      return;
    }
    setReindexBusy(true);
    setReindexMsg(null);
    try {
      const res = await fetch('/api/settings/github/reindex', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_full_name: repo,
          branch: selected?.default_branch || 'main',
          workspace_id: ws,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        run_id?: string;
        ok?: boolean;
      };
      if (!res.ok) {
        throw new Error(data.error || res.statusText || 'Re-index failed');
      }
      setReindexMsg(
        data.message ||
          `Queued full index for ${repo}${data.run_id ? ` · ${data.run_id}` : ''}`,
      );
      await reload();
    } catch (e: unknown) {
      setReindexMsg(e instanceof Error ? e.message : 'Re-index failed');
    } finally {
      setReindexBusy(false);
    }
  };

  const actions = useMemo(() => {
    const base = section?.actions || [];
    return base.map((a) => {
      if (a.key !== 'reindex_codebase') return a;
      if (!a.enabled) return a;
      if (reindexBusy) {
        return { ...a, enabled: false, reasonDisabled: 'Queuing full index…' };
      }
      if (!selectedRepo) {
        return {
          ...a,
          enabled: false,
          reasonDisabled: 'Select a repository card below, then re-index.',
        };
      }
      if (!workspaceId?.trim()) {
        return {
          ...a,
          enabled: false,
          reasonDisabled: 'Active workspace required.',
        };
      }
      return {
        ...a,
        label: `Re-index ${selectedRepo.split('/').pop() || selectedRepo}`,
      };
    });
  }, [section?.actions, reindexBusy, selectedRepo, workspaceId]);

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <SectionHeader
        title="GitHub"
        description="OAuth connection, repositories available to index, codebase index history, and recent audit events. API keys belong under Keys & Secrets."
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
      {loading && !section ? <LoadingRow /> : null}

      {section ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {provider ? <ProviderCard p={provider} /> : null}
            <SummaryGrid
              items={[
                { label: 'Connections', value: String(summary.connection_count ?? 0) },
                { label: 'OAuth tokens', value: String(summary.oauth_token_count ?? 0) },
                {
                  label: 'Last index',
                  value: summary.latest_index_job_status || '—',
                  hint: summary.latest_index_job_at ? undefined : 'no jobs yet',
                },
              ]}
            />
          </div>
          <WarningStrip warnings={section.warnings} />
          <ActionRow actions={actions} onAction={onAction} />
          {reindexMsg ? <p className="text-[10px] text-muted -mt-2">{reindexMsg}</p> : null}
        </>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="text-[10px] font-black uppercase tracking-widest text-muted">
            Repositories (from GitHub API)
          </div>
          <div className="text-[10px] text-muted">
            {selectedRepo
              ? `Selected: ${selectedRepo}`
              : 'Select a repo card, then Re-index codebase'}
          </div>
        </div>
        {repos.length === 0 ? (
          <EmptyState message="No repos returned from /api/integrations/github/repos." />
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))' }}
          >
            {repos.map((r) => {
              const active = r.repo_full_name === selectedRepo;
              const label = r.repo_full_name.split('/').pop() || r.repo_full_name;
              return (
                <div
                  key={r.id}
                  className="group relative flex flex-col rounded-xl overflow-hidden text-left transition-colors"
                  style={{
                    background: 'var(--bg-app)',
                    border: active
                      ? '1.5px solid var(--solar-cyan)'
                      : '1px solid var(--border-subtle)',
                  }}
                >
                  <button
                    type="button"
                    className="flex flex-col flex-1 text-left min-h-0"
                    onClick={() => setSelectedRepo(r.repo_full_name)}
                    aria-pressed={active}
                  >
                    <div
                      className="relative flex items-center justify-center"
                      style={{
                        height: 96,
                        background: 'var(--bg-panel)',
                        borderBottom: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center text-[16px] font-semibold"
                        style={{
                          background: 'var(--bg-hover)',
                          color: 'var(--solar-cyan)',
                        }}
                      >
                        {repoInitials(r.repo_full_name)}
                      </div>
                    </div>
                    <div className="px-2.5 py-2 flex flex-col gap-0.5 min-w-0">
                      <div className="text-[12px] font-semibold text-main truncate" title={r.repo_full_name}>
                        {label}
                      </div>
                      <div className="text-[10px] text-muted truncate" title={r.repo_full_name}>
                        {r.repo_full_name}
                      </div>
                      <div className="text-[10px] text-muted font-mono flex items-center gap-1">
                        <GitBranch size={10} className="shrink-0 opacity-70" />
                        <span className="truncate">{r.default_branch || 'main'}</span>
                      </div>
                    </div>
                  </button>
                  <div className="px-2.5 pb-2 flex items-center justify-between">
                    <StatusDot on={!!r.is_active} />
                    <a
                      href={r.repo_url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 hover:bg-[var(--bg-hover)] rounded text-muted hover:text-[var(--solar-cyan)] transition-colors"
                      onClick={(e) => e.stopPropagation()}
                      title="Open on GitHub"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {section ? (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted">
              Code index jobs
            </div>
            {(extra.code_index_jobs || []).length === 0 ? (
              <EmptyState message="No agentsam_code_index_job rows." />
            ) : (
              <DataTable<IndexJobRow>
                emptyMessage="No jobs."
                rows={extra.code_index_jobs || []}
                columns={[
                  { key: 'repo_full_name', label: 'Repo' },
                  { key: 'status', label: 'Status' },
                  {
                    key: 'finished_at',
                    label: 'Finished',
                    render: (row) => (
                      <RelTime value={row.finished_at ?? row.started_at ?? null} />
                    ),
                  },
                  {
                    key: 'indexed_files',
                    label: 'Files',
                    render: (row) => {
                      const n = row.indexed_files ?? row.indexed_file_count;
                      return n != null ? String(n) : '—';
                    },
                  },
                ]}
              />
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted">
              Audit events (integration_audit_log)
            </div>
            {(extra.audit_log || []).length === 0 ? (
              <EmptyState message="No GitHub-related audit rows." />
            ) : (
              <DataTable<AuditRow>
                emptyMessage="No events."
                rows={extra.audit_log || []}
                columns={[
                  {
                    key: 'created_at',
                    label: 'When',
                    render: (row) => <RelTime value={row.created_at ?? null} />,
                  },
                  { key: 'event_type', label: 'Event' },
                  { key: 'severity', label: 'Severity' },
                ]}
              />
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
