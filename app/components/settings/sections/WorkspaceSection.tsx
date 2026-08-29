import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ExternalLink,
  Github,
  Globe,
  Loader2,
  RefreshCw,
  Shield,
} from 'lucide-react';
import type { SettingsPanelModel } from '../hooks/useSettingsData';
import {
  findConnectedItem,
  isIntegrationConnected,
  connectedSubtitle,
  useWorkspaceSnapshot,
  type KeyRow,
  type OpSettings,
} from '../hooks/useWorkspaceSnapshot';
import { fetchConnectTiles, type ConnectTile } from '../../../client-api/connectTiles';
import { IntegrationIconTile } from '../components/IntegrationIconTile';
import { CfStackWizard, CfStackSummary, type CfStackConfig } from './CfStackWizard';
import { WorkspaceActiveSwitcher } from '../components/WorkspaceActiveSwitcher';
import { initialsFromDisplayName, relativeTime, formatEmbedSpendLine } from '../settingsUi';

export type WorkspaceSectionProps = { data: SettingsPanelModel; workspaceId?: string | null };

function Panel({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 space-y-3 ${className}`}
    >
      <h3 className="text-[10px] font-black uppercase tracking-widest text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-[12px] py-1.5 border-b border-[var(--border-subtle)]/60 last:border-0">
      <span className="text-muted shrink-0 min-w-[100px]">{label}</span>
      <span className="text-main text-right break-all">{children}</span>
    </div>
  );
}

function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted'; children: React.ReactNode }) {
  const cls =
    tone === 'ok'
      ? 'text-[var(--accent-success)] border-[var(--accent-success)]/30 bg-[var(--accent-success)]/10'
      : tone === 'warn'
        ? 'text-[var(--accent-warning)] border-[var(--accent-warning)]/30 bg-[var(--accent-warning)]/10'
        : tone === 'bad'
          ? 'text-[var(--accent-danger)] border-[var(--accent-danger)]/30 bg-[var(--accent-danger)]/10'
          : 'text-muted border-[var(--border-subtle)] bg-[var(--bg-hover)]';
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {children}
    </span>
  );
}

function deployCommand(op: OpSettings): string {
  return (
    op.deploy_stack_command?.trim() ||
    op.deploy_command?.trim() ||
    'npm run deploy:full'
  );
}

function workerName(ws: Record<string, unknown> | null, op: OpSettings): string {
  return (
    op.cf_worker_name?.trim() ||
    (ws?.worker_name != null ? String(ws.worker_name) : '') ||
    (ws?.slug != null ? String(ws.slug) : '') ||
    '—'
  );
}

function productionDomain(ws: Record<string, unknown> | null, op: OpSettings): string {
  const deployUrl = ws?.deploy_url != null ? String(ws.deploy_url).trim() : '';
  if (deployUrl) {
    try {
      return new URL(deployUrl.startsWith('http') ? deployUrl : `https://${deployUrl}`).hostname;
    } catch {
      return deployUrl.replace(/^https?:\/\//, '').split('/')[0];
    }
  }
  const slug = String(ws?.slug || ws?.workspace_slug || '').trim();
  return slug ? `${slug}.inneranimalmedia.com` : 'inneranimalmedia.com';
}

const WATCH_SECRETS: { id: string; label: string; hint?: string }[] = [
  { id: 'openai', label: 'OPENAI_API_KEY' },
  { id: 'anthropic', label: 'ANTHROPIC_API_KEY' },
  { id: 'supabase', label: 'SUPABASE_URL', hint: 'Supabase project URL' },
  { id: 'supabase', label: 'SUPABASE_SERVICE_ROLE_KEY', hint: 'Supabase service role' },
  { id: 'resend', label: 'RESEND_API_KEY', hint: 'Required for email sending' },
  { id: 'cloudflare', label: 'CLOUDFLARE_API_TOKEN' },
];

function secretRows(keys: KeyRow[]) {
  const byProvider = new Map<string, KeyRow>();
  for (const k of keys) {
    const p = String(k.provider || k.secret_name || k.label || '').toLowerCase();
    if (p && !byProvider.has(p)) byProvider.set(p, k);
  }

  return WATCH_SECRETS.map((w) => {
    const hit =
      keys.find((k) => String(k.label || '').toUpperCase() === w.label) ||
      keys.find((k) => String(k.secret_name || '').toUpperCase() === w.label) ||
      byProvider.get(w.id);
    const set = Boolean(hit && String(hit.status || 'active').toLowerCase() !== 'revoked');
    return { ...w, set, row: hit };
  });
}

export function WorkspaceSection({ data, workspaceId }: WorkspaceSectionProps) {
  const navigate = useNavigate();
  const wsId = workspaceId?.trim() || '';
  const { loading, error, snapshot, reload, runHealthCheck, healthChecking } = useWorkspaceSnapshot(wsId);
  const [cfWizardOpen, setCfWizardOpen] = useState(false);
  const [connectTiles, setConnectTiles] = useState<ConnectTile[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchConnectTiles('workspace');
      if (!cancelled && res.ok) setConnectTiles(res.tiles || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [wsId]);

  const ws = snapshot.workspace;
  const op = snapshot.opSettings;
  const cfConfig = op as CfStackConfig;

  const displayName = String(ws?.display_name || ws?.name || ws?.slug || 'Workspace');
  const repo =
    snapshot.git?.repo_full_name ||
    snapshot.git?.repo ||
    String(ws?.github_repo || op.github_repo || '').trim() ||
    null;
  const branch = snapshot.git?.branch || 'main';
  const healthOverall = String(snapshot.health?.overall || '').toLowerCase();
  const healthTone: 'ok' | 'warn' | 'bad' | 'muted' =
    healthOverall === 'healthy' ? 'ok' : healthOverall === 'degraded' ? 'warn' : healthOverall === 'down' ? 'bad' : 'muted';

  const githubOk = isIntegrationConnected(snapshot.connected, 'github') && Boolean(repo);
  const cfOk = isIntegrationConnected(snapshot.connected, 'cloudflare_oauth');
  const secrets = useMemo(() => secretRows(snapshot.keys), [snapshot.keys]);
  const secretsSet = secrets.filter((s) => s.set).length;

  const snapshotLine = [
    healthOverall === 'healthy' ? 'Healthy' : healthOverall ? healthOverall : 'Status unknown',
    cfOk ? 'Cloudflare connected' : 'Cloudflare not linked',
    githubOk ? 'GitHub repo connected' : 'Repo not linked',
  ].join(' · ');

  if (loading && !ws) {
    return <div className="text-[12px] text-muted py-8">Loading workspace…</div>;
  }

  if (error && !ws) {
    const isConnectivity =
      /connection|retry|load workspaces|verify session/i.test(error) || !wsId;
    return (
      <div className="flex flex-col gap-3 py-8 max-w-md">
        <div className="text-[12px] text-[var(--accent-danger)]">{error}</div>
        {isConnectivity ? (
          <button
            type="button"
            className="self-start text-[12px] px-3 py-1.5 rounded border border-[var(--border)] text-[var(--text-heading)] hover:bg-[var(--bg-elevated)]"
            onClick={() => void reload()}
          >
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  const resolvedWorkspaceId =
    (typeof ws?.id === "string" && ws.id.trim()) ||
    (typeof ws?.workspace_id === "string" && String(ws.workspace_id).trim()) ||
    wsId ||
    "—";

  return (
    <div className="flex flex-col gap-5 max-w-5xl pb-8">
      <div>
        <h2 className="text-[13px] font-bold text-[var(--text-heading)] uppercase tracking-widest">
          Workspace
        </h2>
        <p className="text-[11px] text-muted mt-1">
          Project connections, deploy target, and infrastructure at a glance.
        </p>
      </div>

      <WorkspaceActiveSwitcher />

      {/* 1 · Project snapshot */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-gradient-to-br from-[var(--bg-panel)] to-[var(--bg-app)] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="text-[22px] font-semibold text-[var(--text-heading)] tracking-tight">
              {displayName}
            </div>
            <div className="text-[12px] text-muted">{snapshotLine}</div>
            <div className="flex flex-wrap gap-2 pt-2">
              <StatusPill tone={healthTone}>
                {healthOverall === 'healthy' ? 'Live' : healthOverall || 'Unknown'}
              </StatusPill>
              {githubOk ? <StatusPill tone="ok">Repo linked</StatusPill> : <StatusPill tone="muted">No repo</StatusPill>}
              {cfOk ? <StatusPill tone="ok">Cloudflare</StatusPill> : <StatusPill tone="warn">CF OAuth needed</StatusPill>}
              <StatusPill tone={secretsSet >= 3 ? 'ok' : 'warn'}>
                {secretsSet} secrets configured
              </StatusPill>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              className="text-[11px] px-3 py-2 rounded-lg bg-[var(--solar-blue)] text-[var(--toggle-knob)]"
              onClick={() => window.open(`https://${productionDomain(ws, op)}`, '_blank', 'noopener,noreferrer')}
            >
              Open site
            </button>
            {repo ? (
              <button
                type="button"
                className="text-[11px] px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-main hover:bg-[var(--bg-hover)]"
                onClick={() => window.open(`https://github.com/${repo}`, '_blank', 'noopener,noreferrer')}
              >
                Open repo
              </button>
            ) : null}
            <button
              type="button"
              disabled={healthChecking}
              className="text-[11px] px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-main hover:bg-[var(--bg-hover)] inline-flex items-center gap-1.5 disabled:opacity-50"
              onClick={() => void runHealthCheck()}
            >
              {healthChecking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Health check
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-0 rounded-xl border border-[var(--border-subtle)]/80 bg-[var(--bg-app)]/50 px-4 py-2">
          <Row label="Domain">{productionDomain(ws, op)}</Row>
          <Row label="Repo">{repo || '—'}</Row>
          <Row label="Branch">{branch}</Row>
          <Row label="Deploy">{workerName(ws, op)} · Cloudflare Workers</Row>
          <Row label="Last deploy">
            {snapshot.lastDeploy.at ? (
              <>
                {relativeTime(snapshot.lastDeploy.at)}
                {snapshot.lastDeploy.git_sha
                  ? ` · ${String(snapshot.lastDeploy.git_sha).slice(0, 7)}`
                  : ''}
              </>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Workspace ID">
            <code className="text-[10px] font-mono">{resolvedWorkspaceId}</code>
          </Row>
        </div>
      </div>

      {/* 2 · Connected services */}
      <Panel title="Connected services">
        <div className="iam-app-icon-grid max-w-4xl">
          {connectTiles.map((tile) => {
            const item = findConnectedItem(snapshot.connected, tile.provider_key);
            const connected = tile.connected || isIntegrationConnected(snapshot.connected, tile.provider_key);
            const subtitle = connected
              ? tile.provider_key === 'github' && repo
                ? `${branch}${snapshot.git?.behind_by ? ` · ${snapshot.git.behind_by} behind` : ''}`
                : tile.account_display || connectedSubtitle(item)
              : 'Not connected';
            return (
              <IntegrationIconTile
                key={tile.provider_key}
                title={tile.title}
                iconSlug={item?.catalog?.icon_slug || tile.icon_slug}
                subtitle={subtitle}
                status={
                  tile.issue === 'error'
                    ? 'error'
                    : tile.issue === 'warning'
                      ? 'warning'
                      : connected
                        ? null
                        : tile.provider_key === 'cloudflare_oauth' &&
                            !(
                              cfConfig.cf_stack_configured_at ||
                              cfConfig.cf_d1_database_id ||
                              cfConfig.cf_worker_name ||
                              cfConfig.cf_account_id
                            )
                          ? 'warning'
                          : 'error'
                }
                onClick={() => {
                  if (connected) navigate(tile.settings_path);
                  else window.location.href = tile.connect_url;
                }}
              />
            );
          })}
        </div>
        <button
          type="button"
          className="text-[11px] text-[var(--solar-blue)] hover:underline"
          onClick={() => navigate('/dashboard/settings/integrations')}
        >
          Manage integrations →
        </button>
      </Panel>

      {/* Cloudflare stack (operational — not themes) */}
      {cfOk ? (
        <Panel title="Cloudflare stack">
          {cfConfig.cf_stack_configured_at ||
          cfConfig.cf_d1_database_id ||
          cfConfig.cf_worker_name ||
          cfConfig.cf_account_id ? (
            <>
              <p className="text-[11px] text-muted">
                Account-wide — same Cloudflare stack across all your workspaces.
              </p>
              <CfStackSummary config={cfConfig} />
              <button
                type="button"
                className="text-[11px] px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-main w-fit"
                onClick={() => setCfWizardOpen(true)}
              >
                Reconfigure D1 / Worker / Tunnel
              </button>
            </>
          ) : (
            <>
              <p className="text-[11px] text-muted">
                OAuth is connected. Configure D1, Worker, and Tunnel once for your account.
              </p>
              <button
                type="button"
                className="text-[11px] px-3 py-2 rounded-lg bg-[var(--solar-blue)] text-[var(--toggle-knob)] w-fit"
                onClick={() => setCfWizardOpen(true)}
              >
                Configure Cloudflare stack →
              </button>
            </>
          )}
        </Panel>
      ) : null}

      {/* Code index — live AST counts; Re-Index re-embeds symbols + stamps last_sync */}
      <Panel title="Code index">
        <p className="text-[11px] text-muted -mt-1">
          Chunk RAG + AST graph for Agent Sam. Retrieve is for pre-edit lookups (~2–3s) — not hot intent routing.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
          <div className="rounded-lg border border-[var(--border-subtle)]/80 px-2.5 py-2">
            <div className="text-[10px] text-muted uppercase tracking-wider">Files</div>
            <div className="text-main font-semibold tabular-nums">
              {snapshot.codeIndex?.ast && 'files' in snapshot.codeIndex.ast
                ? String((snapshot.codeIndex.ast as { files?: number }).files ?? '—')
                : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)]/80 px-2.5 py-2">
            <div className="text-[10px] text-muted uppercase tracking-wider">AST nodes</div>
            <div className="text-main font-semibold tabular-nums">
              {snapshot.codeIndex?.ast && 'nodes' in snapshot.codeIndex.ast
                ? String(snapshot.codeIndex.ast.nodes ?? '—')
                : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)]/80 px-2.5 py-2">
            <div className="text-[10px] text-muted uppercase tracking-wider">Edges</div>
            <div className="text-main font-semibold tabular-nums">
              {snapshot.codeIndex?.ast && 'edges' in snapshot.codeIndex.ast
                ? String(snapshot.codeIndex.ast.edges ?? '—')
                : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)]/80 px-2.5 py-2">
            <div className="text-[10px] text-muted uppercase tracking-wider">Symbols</div>
            <div className="text-main font-semibold tabular-nums">
              {snapshot.codeIndex?.ast && 'symbols' in snapshot.codeIndex.ast
                ? String(snapshot.codeIndex.ast.symbols ?? '—')
                : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)]/80 px-2.5 py-2">
            <div className="text-[10px] text-muted uppercase tracking-wider">Linked chunks</div>
            <div className="text-main font-semibold tabular-nums">
              {snapshot.codeIndex?.ast &&
              'total_chunks' in snapshot.codeIndex.ast &&
              Number((snapshot.codeIndex.ast as { total_chunks?: number }).total_chunks ?? -1) === 0
                ? 'none'
                : snapshot.codeIndex?.ast && 'linked_chunks' in snapshot.codeIndex.ast
                  ? `${String(snapshot.codeIndex.ast.linked_chunks ?? '—')}/${String(
                      (snapshot.codeIndex.ast as { total_chunks?: number }).total_chunks ?? '—',
                    )}`
                  : '—'}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div
              className={`w-11 h-11 rounded-full shrink-0 grid place-items-center relative ${
                data.reindexPhase === 'ok'
                  ? 'bg-emerald-500/20 text-emerald-600'
                  : data.reindexPhase === 'error'
                    ? 'bg-red-500/20 text-red-600'
                    : data.reindexPhase === 'running'
                      ? 'text-[var(--solar-blue)]'
                      : 'bg-[var(--border-subtle)]/40 text-muted'
              }`}
              style={
                data.reindexPhase === 'running' || (data.reindexPct > 0 && data.reindexPct < 100)
                  ? {
                      background: `conic-gradient(var(--solar-blue) ${data.reindexPct}%, rgba(148,163,184,0.25) 0)`,
                    }
                  : undefined
              }
              aria-label={data.reindexMsg || 'Code index status'}
            >
              <span className="absolute inset-[4px] rounded-full bg-[var(--panel-bg,var(--bg-elevated,#fff))] grid place-items-center text-[10px] font-semibold tabular-nums">
                {data.reindexPhase === 'running'
                  ? `${Math.max(1, data.reindexPct)}%`
                  : data.reindexPhase === 'ok'
                    ? '✓'
                    : data.reindexPhase === 'error'
                      ? '!'
                      : '•'}
              </span>
            </div>
            <div className="text-[10px] text-muted min-w-0">
              {(() => {
                const ast = snapshot.codeIndex?.ast as
                  | { last_synced_at?: string | number | null; nodes?: number }
                  | undefined;
                const job =
                  snapshot.codeIndex?.chunkJob ||
                  (data.workspaceData?.indexJob as Record<string, unknown> | undefined);
                const astWhen = ast?.last_synced_at;
                const jobId = job?.id ? String(job.id) : '';
                const status = job ? String(job.status || '—') : '—';
                const cost = snapshot.codeIndex?.embedCost as
                  | {
                      cost_usd_30d?: number;
                      cost_usd_today?: number;
                      embed_events_30d?: number;
                      embed_events_today?: number;
                      cost_usd_this_run?: number | null;
                      embed_events_this_run?: number | null;
                      active_full_run?: boolean;
                      this_run_id?: string | null;
                    }
                  | undefined;
                const err = job?.last_error ? String(job.last_error).slice(0, 120) : '';
                return (
                  <>
                    AST last sync:{' '}
                    <span className="text-main">
                      {astWhen ? relativeTime(astWhen as string | number) : '—'}
                    </span>
                    {jobId ? (
                      <>
                        {' '}
                        · job <span className="text-main">{jobId}</span> ({status})
                      </>
                    ) : null}
                    {cost != null ? (
                      <>
                        {' '}
                        ·{' '}
                        <span
                          title={
                            cost.this_run_id || cost.cost_usd_this_run != null
                              ? 'Embed spend for the latest full-index run (usage events for that run_id)'
                              : 'OpenAI embedding spend for this workspace over the last 30 days'
                          }
                        >
                          {formatEmbedSpendLine(cost)}
                        </span>
                      </>
                    ) : null}
                    {data.reindexMsg ? (
                      <div
                        className={
                          data.reindexPhase === 'error'
                            ? 'text-[var(--accent-warning)] mt-0.5'
                            : data.reindexPhase === 'ok'
                              ? 'text-emerald-600 mt-0.5'
                              : 'text-[var(--solar-blue)] mt-0.5'
                        }
                      >
                        {data.reindexMsg}
                      </div>
                    ) : null}
                    {err ? <div className="text-[var(--accent-warning)] mt-0.5">{err}</div> : null}
                  </>
                );
              })()}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            {data.reindexBusy === 'ast' ? (
              <button
                type="button"
                onClick={() => void data.cancelWorkspaceReindex()}
                className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--accent-warning)]/40 text-[var(--accent-warning)] hover:bg-[var(--accent-warning)]/10"
              >
                Cancel
              </button>
            ) : null}
            <button
              type="button"
              disabled={data.reindexBusy != null}
              onClick={() => void data.postWorkspaceReindex('ast')}
              className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-muted hover:text-main disabled:opacity-50"
            >
              {data.reindexBusy === 'ast' ? `Re-Indexing… ${data.reindexPct}%` : 'Re-Index AST'}
            </button>
            <button
              type="button"
              disabled={data.reindexBusy != null}
              onClick={() => void data.postWorkspaceReindex('chunks')}
              className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-muted hover:text-main disabled:opacity-50"
            >
              {data.reindexBusy === 'chunks' ? 'Queuing…' : 'Re-index chunks'}
            </button>
          </div>
        </div>
        <p className="text-[10px] text-muted">
          Re-Index AST re-embeds symbols from the live graph and stamps last sync (costs → usage events). Full
          graph re-walk for new files remains CLI (`--target platform` / `--workspace-id`). Per-project control
          lives on the project page rail. Job history →{' '}
          <button
            type="button"
            className="text-[var(--solar-blue)] hover:underline"
            onClick={() => navigate('/dashboard/settings/github')}
          >
            GitHub settings
          </button>
          .
        </p>
      </Panel>

      {/* 3 · Repo + deploy */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Repository">
          <Row label="Owner">{repo ? repo.split('/')[0] : '—'}</Row>
          <Row label="Repo">{repo ? repo.split('/')[1] || repo : '—'}</Row>
          <Row label="Branch">{branch}</Row>
          <Row label="Last commit">
            {snapshot.git?.checkpoint_sha
              ? String(snapshot.git.checkpoint_sha).slice(0, 7)
              : snapshot.lastDeploy.git_sha
                ? String(snapshot.lastDeploy.git_sha).slice(0, 7)
                : '—'}
          </Row>
          <Row label="Sync">
            {snapshot.git?.status === 'live' ? 'Synced with GitHub' : String(snapshot.git?.status || '—')}
          </Row>
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-muted hover:text-main inline-flex items-center gap-1"
              onClick={() => navigate('/dashboard/settings/github')}
            >
              <Github size={13} /> GitHub settings
            </button>
            {repo ? (
              <button
                type="button"
                className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-muted hover:text-main inline-flex items-center gap-1"
                onClick={() => window.open(`https://github.com/${repo}`, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink size={13} /> Open repo
              </button>
            ) : null}
          </div>
        </Panel>

        <Panel title="Deployment">
          <Row label="Provider">Cloudflare Workers</Row>
          <Row label="Worker">{workerName(ws, op)}</Row>
          <Row label="Environment">production</Row>
          <Row label="Command">
            <code className="text-[10px] font-mono">{deployCommand(op)}</code>
          </Row>
          <Row label="Last deploy">
            {snapshot.lastDeploy.at ? (
              <>
                {relativeTime(snapshot.lastDeploy.at)}
                {snapshot.lastDeploy.git_sha
                  ? ` · ${String(snapshot.lastDeploy.git_sha).slice(0, 7)}`
                  : ''}
              </>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Result">
            <StatusPill tone={String(snapshot.lastDeploy.status || '').toLowerCase().includes('fail') ? 'bad' : 'ok'}>
              {snapshot.lastDeploy.status || '—'}
            </StatusPill>
          </Row>
          <button
            type="button"
            className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-muted hover:text-main mt-1"
            onClick={() => navigate('/dashboard/settings/cicd')}
          >
            CI/CD details →
          </button>
        </Panel>
      </div>

      {/* 4 · Secrets + domains */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Worker secrets">
          <p className="text-[10px] text-muted -mt-1">Status only — values never shown here.</p>
          <ul className="space-y-2">
            {secrets.map((s) => (
              <li
                key={s.label}
                className="flex items-center justify-between gap-3 py-2 border-b border-[var(--border-subtle)]/50 last:border-0"
              >
                <div className="min-w-0">
                  <div className="text-[12px] font-mono text-main">{s.label}</div>
                  {s.hint && !s.set ? (
                    <div className="text-[10px] text-muted">{s.hint}</div>
                  ) : s.row?.updated_at ? (
                    <div className="text-[10px] text-muted">
                      {relativeTime(s.row.updated_at)}
                    </div>
                  ) : null}
                </div>
                <StatusPill tone={s.set ? 'ok' : 'bad'}>{s.set ? 'Set' : 'Missing'}</StatusPill>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-muted hover:text-main inline-flex items-center gap-1"
            onClick={() => navigate('/dashboard/settings/keys')}
          >
            <Shield size={13} /> Keys &amp; secrets
          </button>
        </Panel>

        <Panel title="Domains &amp; data">
          <div className="space-y-3">
            <div>
              <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Domains</div>
              <Row label={productionDomain(ws, op)}>Active</Row>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Routes</div>
              <Row label="/api/*">Worker</Row>
              <Row label="/dashboard/*">App shell</Row>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Storage</div>
              <Row label="D1">
                {op.cf_d1_database_name || op.cf_d1_database_id ? 'Connected' : 'Not configured'}
              </Row>
              <Row label="R2">
                {snapshot.health?.services?.find((s) => s.service === 'r2')?.status === 'healthy'
                  ? 'Connected'
                  : 'Unknown'}
              </Row>
              <Row label="Supabase">
                {isIntegrationConnected(snapshot.connected, 'supabase_oauth') ? 'Connected' : 'Not connected'}
              </Row>
            </div>
          </div>
          <button
            type="button"
            className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-muted hover:text-main inline-flex items-center gap-1"
            onClick={() => navigate('/dashboard/settings/network')}
          >
            <Globe size={13} /> Network settings
          </button>
        </Panel>
      </div>

      {/* Team (compact) */}
      {snapshot.members.length > 0 ? (
        <Panel title="Team">
          <ul className="space-y-2">
            {snapshot.members
              .filter((m) => String(m.status || 'active') !== 'removed')
              .slice(0, 8)
              .map((m) => (
                <li key={String(m.member_id || m.user_id)} className="flex items-center gap-3 py-1">
                  <div className="w-8 h-8 rounded-full bg-[var(--bg-app)] border border-[var(--border-subtle)] flex items-center justify-center text-[10px] font-bold text-[var(--solar-cyan)]">
                    {initialsFromDisplayName(String(m.display_name || m.email || '?'))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-main truncate">
                      {String(m.display_name || m.email || '—')}
                    </div>
                    <div className="text-[10px] text-muted">{String(m.role || 'member')}</div>
                  </div>
                </li>
              ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="Recent activity">
        {snapshot.activity.length === 0 ? (
          <p className="text-[11px] text-muted">No workspace audit events yet.</p>
        ) : (
          <ul className="space-y-2">
            {snapshot.activity.slice(0, 8).map((ev, i) => (
              <li key={i} className="text-[11px] text-main flex justify-between gap-2">
                <span>{String(ev.action || 'event').replace(/\./g, ' · ')}</span>
                <span className="text-muted shrink-0">{relativeTime(ev.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <CfStackWizard
        open={cfWizardOpen}
        workspaceId={wsId || undefined}
        onClose={() => setCfWizardOpen(false)}
        onComplete={() => void reload()}
      />
    </div>
  );
}
